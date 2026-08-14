import {
  OwnerVoiceEngine,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
  type SpeechSynthesisVoiceLike,
} from "./engine";

/** Deterministic fake voices for voice-preference tests. */
export const AR_OM_VOICE: SpeechSynthesisVoiceLike = {
  name: "Salim",
  lang: "ar-OM",
  localService: false,
  default: false,
};
export const AR_SA_VOICE: SpeechSynthesisVoiceLike = {
  name: "Khalid",
  lang: "ar-SA",
  localService: false,
  default: false,
};
export const AR_EG_VOICE: SpeechSynthesisVoiceLike = {
  name: "Hoda",
  lang: "ar-EG",
  localService: false,
  default: false,
};
export const EN_US_VOICE: SpeechSynthesisVoiceLike = {
  name: "Google US English",
  lang: "en-US",
  localService: false,
  default: false,
};

export class FakeUtterance implements SpeechSynthesisUtteranceLike {
  text = "";
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: ((event?: { error?: string }) => void) | null = null;

  /** Simulate the platform finishing the utterance. */
  finish(): void {
    this.onend?.();
  }

  /** Simulate the platform erroring/interrupting the utterance. */
  fail(): void {
    this.onerror?.({ error: "interrupted" });
  }
}

export class FakeSpeechSynthesis implements SpeechSynthesisLike {
  utterances: FakeUtterance[] = [];
  cancelCount = 0;
  resumeCount = 0;
  voices: SpeechSynthesisVoiceLike[];
  private listeners = new Set<() => void>();

  constructor(voices: SpeechSynthesisVoiceLike[] = []) {
    this.voices = voices;
  }

  speak(utterance: SpeechSynthesisUtteranceLike): void {
    this.utterances.push(utterance as FakeUtterance);
  }

  cancel(): void {
    this.cancelCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }

  getVoices(): SpeechSynthesisVoiceLike[] {
    return this.voices;
  }

  addEventListener(_type: "voiceschanged", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "voiceschanged", listener: () => void): void {
    this.listeners.delete(listener);
  }

  fireVoicesChanged(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Engine wired to fake speech synthesis (never touches real audio). */
export function createTestEngine(
  voices: SpeechSynthesisVoiceLike[] = [],
): { synth: FakeSpeechSynthesis; engine: OwnerVoiceEngine } {
  const synth = new FakeSpeechSynthesis(voices);
  const engine = new OwnerVoiceEngine({
    synth,
    utteranceFactory: () => new FakeUtterance(),
  });
  return { synth, engine };
}
