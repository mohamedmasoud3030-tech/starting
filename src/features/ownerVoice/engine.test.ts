import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OwnerVoiceEngine,
  OWNER_VOICE_RATE_VALUES,
  pickArabicVoice,
  type SpeechSynthesisVoiceLike,
} from "./engine";
import {
  AR_EG_VOICE,
  AR_OM_VOICE,
  AR_SA_VOICE,
  EN_US_VOICE,
  FakeUtterance,
  FakeSpeechSynthesis,
  createTestEngine,
} from "./testDoubles";

afterEach(() => {
  vi.useRealTimers();
});

describe("OwnerVoiceEngine", () => {
  it("reports unsupported and never speaks when speechSynthesis is missing", () => {
    const engine = new OwnerVoiceEngine({
      synth: null,
      utteranceFactory: () => new FakeUtterance(),
    });
    expect(engine.getSnapshot().supported).toBe(false);
    expect(engine.speak("مرحباً")).toBe(false);
    expect(engine.replay()).toBe(false);
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(() => engine.stop()).not.toThrow();
    engine.dispose();
  });

  it("ignores empty text without speaking", () => {
    const { synth, engine } = createTestEngine();
    expect(engine.speak("   ")).toBe(false);
    expect(synth.utterances).toHaveLength(0);
  });

  it("speaks the summary with the Arabic locale and tracks the end event", () => {
    const { synth, engine } = createTestEngine();
    expect(engine.speak("عندك اليوم مناسبتان.")).toBe(true);
    expect(engine.getSnapshot().speaking).toBe(true);
    expect(engine.getSnapshot().lastText).toBe("عندك اليوم مناسبتان.");
    expect(synth.utterances).toHaveLength(1);
    const utterance = synth.utterances[0]!;
    expect(utterance.text).toBe("عندك اليوم مناسبتان.");
    expect(utterance.lang).toBe("ar-OM");
    expect(utterance.rate).toBe(1);
    expect(utterance.voice).toBeNull();
    utterance.finish();
    expect(engine.getSnapshot().speaking).toBe(false);
  });

  it("prefers Omani Arabic, then Gulf Arabic, then any Arabic voice", () => {
    const mixed: SpeechSynthesisVoiceLike[] = [
      EN_US_VOICE,
      AR_EG_VOICE,
      AR_SA_VOICE,
      AR_OM_VOICE,
    ];
    expect(pickArabicVoice(mixed)?.lang).toBe("ar-OM");

    const gulf = [EN_US_VOICE, AR_EG_VOICE, AR_SA_VOICE];
    expect(pickArabicVoice(gulf)?.lang).toBe("ar-SA");

    const generic = [EN_US_VOICE, AR_EG_VOICE];
    expect(pickArabicVoice(generic)?.lang).toBe("ar-EG");

    const none = [EN_US_VOICE];
    expect(pickArabicVoice(none)).toBeNull();
    expect(pickArabicVoice([])).toBeNull();
  });

  it("is deterministic when several voices share a tier", () => {
    const duplicate = [AR_OM_VOICE, { ...AR_OM_VOICE, name: "Aisha" }];
    const first = pickArabicVoice(duplicate);
    const second = pickArabicVoice([...duplicate].reverse());
    expect(first?.name).toBe(second?.name);
  });

  it("uses the picked Arabic voice on the utterance", () => {
    const { synth, engine } = createTestEngine([AR_SA_VOICE]);
    engine.speak("نص تجريبي");
    const utterance = synth.utterances[0]!;
    expect(utterance.voice).toBe(AR_SA_VOICE);
    expect(utterance.lang).toBe("ar-SA");
  });

  it("does not fail when no Arabic voice exists (falls back to default voice)", () => {
    const { synth, engine } = createTestEngine([EN_US_VOICE]);
    expect(engine.speak("نص عربي")).toBe(true);
    const utterance = synth.utterances[0]!;
    expect(utterance.voice).toBeNull();
    expect(utterance.lang).toBe("ar-OM");
  });

  it("stop cancels speech but keeps the text for replay", () => {
    const { synth, engine } = createTestEngine();
    engine.speak("نص أول");
    engine.stop();
    expect(synth.cancelCount).toBeGreaterThan(0);
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(engine.getSnapshot().lastText).toBe("نص أول");
    expect(engine.replay()).toBe(true);
    expect(synth.utterances[1]?.text).toBe("نص أول");
    expect(engine.getSnapshot().speaking).toBe(true);
  });

  it("never overlaps narrations on rapid repeated presses", () => {
    const { synth, engine } = createTestEngine();
    engine.speak("نص واحد");
    engine.speak("نص ثانٍ"); // cancels the first before starting
    expect(synth.cancelCount).toBe(2);
    expect(synth.utterances).toHaveLength(2);
    // A stale error from the FIRST utterance must not reset the second one.
    synth.utterances[0]!.fail();
    expect(engine.getSnapshot().speaking).toBe(true);
    synth.utterances[1]!.finish();
    expect(engine.getSnapshot().speaking).toBe(false);
  });

  it("applies the chosen speed preset to the next utterance", () => {
    const { synth, engine } = createTestEngine();
    engine.setRate("fast");
    expect(engine.getSnapshot().rate).toBe("fast");
    engine.speak("نص");
    expect(synth.utterances[0]!.rate).toBe(OWNER_VOICE_RATE_VALUES.fast);
    engine.setRate("slow");
    engine.speak("نص آخر");
    expect(synth.utterances[1]!.rate).toBe(OWNER_VOICE_RATE_VALUES.slow);
  });

  it("resumes long utterances periodically (Chrome pause workaround)", () => {
    vi.useFakeTimers();
    const synth = new FakeSpeechSynthesis();
    const engine = new OwnerVoiceEngine({
      synth,
      utteranceFactory: () => new FakeUtterance(),
    });
    engine.speak("نص طويل");
    expect(synth.resumeCount).toBe(0);
    vi.advanceTimersByTime(10_100);
    expect(synth.resumeCount).toBeGreaterThan(0);
    engine.stop();
    const afterStop = synth.resumeCount;
    vi.advanceTimersByTime(30_000);
    expect(synth.resumeCount).toBe(afterStop);
    engine.dispose();
  });

  it("re-picks an Arabic voice after voices load asynchronously", () => {
    const synth = new FakeSpeechSynthesis([]);
    const engine = new OwnerVoiceEngine({
      synth,
      utteranceFactory: () => new FakeUtterance(),
    });
    expect(engine.getSnapshot().voice).toBeNull();
    synth.voices = [AR_OM_VOICE];
    synth.fireVoicesChanged();
    expect(engine.getSnapshot().voice?.lang).toBe("ar-OM");
    engine.dispose();
  });

  it("stops speech on dispose", () => {
    const { synth, engine } = createTestEngine();
    engine.speak("نص");
    engine.dispose();
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(synth.cancelCount).toBeGreaterThan(0);
  });
});
