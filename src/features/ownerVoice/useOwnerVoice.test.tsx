import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OwnerVoiceEngine } from "./engine";
import { useOwnerVoice } from "./useOwnerVoice";
import { FakeUtterance, createTestEngine } from "./testDoubles";

describe("useOwnerVoice", () => {
  it("never speaks automatically on mount", () => {
    const { engine, synth } = createTestEngine();
    renderHook(() => useOwnerVoice(engine));
    expect(synth.utterances).toHaveLength(0);
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(engine.getSnapshot().lastText).toBeNull();
  });

  it("exposes speak/stop/replay and live speaking state", () => {
    const { engine, synth } = createTestEngine();
    const { result } = renderHook(() => useOwnerVoice(engine));

    expect(result.current.supported).toBe(true);
    expect(result.current.speaking).toBe(false);

    act(() => {
      result.current.speak("ملخص الشاشة");
    });
    expect(result.current.speaking).toBe(true);
    expect(synth.utterances[0]?.text).toBe("ملخص الشاشة");

    act(() => {
      result.current.stop();
    });
    expect(result.current.speaking).toBe(false);
    expect(result.current.lastText).toBe("ملخص الشاشة");

    act(() => {
      result.current.replay();
    });
    expect(result.current.speaking).toBe(true);
    expect(synth.utterances).toHaveLength(2);

    act(() => {
      result.current.setRate("fast");
    });
    expect(result.current.rate).toBe("fast");
  });

  it("stops speech when the owning component unmounts", () => {
    const { engine, synth } = createTestEngine();
    const { result, unmount } = renderHook(() => useOwnerVoice(engine));
    act(() => {
      result.current.speak("نص");
    });
    expect(engine.getSnapshot().speaking).toBe(true);
    unmount();
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(synth.cancelCount).toBeGreaterThan(0);
  });

  it("reports unsupported browsers without speaking", () => {
    const engine = new OwnerVoiceEngine({
      synth: null,
      utteranceFactory: () => new FakeUtterance(),
    });
    const { result } = renderHook(() => useOwnerVoice(engine));
    expect(result.current.supported).toBe(false);
    expect(result.current.speaking).toBe(false);
    let spoke = true;
    act(() => {
      spoke = result.current.speak("نص");
    });
    expect(spoke).toBe(false);
    expect(engine.getSnapshot().speaking).toBe(false);
  });
});
