import { describe, expect, it } from "vitest";
import {
  AssistantSpeechEngine,
  pickAssistantArabicVoice,
  type AssistantSynthLike,
  type AssistantUtteranceLike,
  type AssistantVoiceLike,
} from "./assistant-speech";

function fakeSynth(voices: AssistantVoiceLike[]): {
  synth: AssistantSynthLike;
  spoken: AssistantUtteranceLike[];
} {
  const spoken: AssistantUtteranceLike[] = [];
  const synth: AssistantSynthLike = {
    speak: (u) => spoken.push(u),
    cancel: () => undefined,
    getVoices: () => voices,
  };
  return { synth, spoken };
}

describe("pickAssistantArabicVoice", () => {
  it("prefers a known feminine Arabic voice over a masculine Omani one", () => {
    const chosen = pickAssistantArabicVoice([
      { name: "Microsoft Hamdan - Arabic (Oman)", lang: "ar-OM", localService: true },
      { name: "Microsoft Zariyah - Arabic (Saudi Arabia)", lang: "ar-SA", localService: false },
    ]);
    expect(chosen?.name).toContain("Zariyah");
  });

  it("prefers Omani Arabic when no feminine voice is present", () => {
    const chosen = pickAssistantArabicVoice([
      { name: "Google US English", lang: "en-US", localService: true },
      { name: "Omani Arabic (Local)", lang: "ar-OM", localService: true },
    ]);
    expect(chosen?.lang).toBe("ar-OM");
  });

  it("returns null when there is no Arabic voice", () => {
    expect(
      pickAssistantArabicVoice([{ name: "Google US English", lang: "en-US", localService: true }]),
    ).toBeNull();
  });
});

describe("AssistantSpeechEngine", () => {
  it("speaks with the Arabic locale, a gentle rate and natural pitch", () => {
    const { synth, spoken } = fakeSynth([
      { name: "Omani Arabic (Local)", lang: "ar-OM", localService: true },
    ]);
    const engine = new AssistantSpeechEngine({
      synth,
      utteranceFactory: (text) =>
        ({
          text,
          lang: "",
          voice: null,
          rate: 1,
          pitch: 1,
          onstart: null,
          onend: null,
          onerror: null,
        }) as AssistantUtteranceLike,
    });

    expect(engine.speak("أهلاً")).toBe(true);
    const utterance = spoken[0] as AssistantUtteranceLike;
    expect(utterance.lang).toBe("ar-OM");
    expect(utterance.rate).toBe(0.96);
    expect(utterance.pitch).toBe(1);
  });

  it("does not speak empty text and reports supported only with a synthesis", () => {
    const engine = new AssistantSpeechEngine({ synth: null });
    expect(engine.getSnapshot().supported).toBe(false);
    expect(engine.speak("   ")).toBe(false);
  });
});
