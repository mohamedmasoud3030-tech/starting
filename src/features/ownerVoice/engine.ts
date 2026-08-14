/**
 * Owner Voice — browser-native speech synthesis engine.
 *
 * This is the ONLY place in the app that touches `speechSynthesis`. Pages and
 * components must go through this engine (via `useOwnerVoice`) so that voice
 * behavior stays centralized, testable, and permission-safe.
 *
 * Guarantees:
 *  - No automatic speech: nothing here speaks unless `speak()` is called by
 *    an explicit user action.
 *  - No overlapping narrations: `speak()` always cancels the current
 *    utterance first, so rapid repeated presses can never play two
 *    summaries at once.
 *  - Unsupported browsers degrade gracefully (`supported === false`).
 *  - No Arabic voice available → we still speak with the `ar-OM` locale and
 *    the platform default voice; the app never fails because of it.
 */

/** Simple, owner-facing speed presets (no complex voice settings in the UI). */
export type OwnerVoiceRate = "slow" | "normal" | "fast";

export const OWNER_VOICE_RATE_VALUES: Record<OwnerVoiceRate, number> = {
  slow: 0.8,
  normal: 1,
  fast: 1.25,
};

export const OWNER_VOICE_DEFAULT_RATE: OwnerVoiceRate = "normal";

/** Spoken locale used when no Arabic voice exists on the device. */
export const OWNER_VOICE_ARABIC_LOCALE = "ar-OM";

/** Chrome pauses long utterances (~15s); resume periodically while speaking. */
const OWNER_VOICE_PACER_MS = 10_000;

/**
 * Narrow structural interfaces for the browser SpeechSynthesis API so tests
 * can inject faithful fakes without depending on real audio playback.
 */
export interface SpeechSynthesisVoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoiceLike | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoiceLike[];
  pause?(): void;
  resume?(): void;
  onvoiceschanged?: (() => void) | null;
  addEventListener?(type: "voiceschanged", listener: () => void): void;
  removeEventListener?(type: "voiceschanged", listener: () => void): void;
}

export interface OwnerVoiceState {
  /** Whether the current browser exposes a usable speechSynthesis API. */
  supported: boolean;
  /** True while an utterance is playing (set optimistically on speak). */
  speaking: boolean;
  /** The last text spoken, retained so `replay()` can repeat it. */
  lastText: string | null;
  rate: OwnerVoiceRate;
  /** Voices currently reported by the platform (may load asynchronously). */
  voices: SpeechSynthesisVoiceLike[];
  /** The voice chosen for Arabic speech (auto-picked or manually selected). */
  voice: SpeechSynthesisVoiceLike | null;
}

export interface OwnerVoiceEngineOptions {
  /** Injectable engine; defaults to window.speechSynthesis. null = unsupported. */
  synth?: SpeechSynthesisLike | null;
  /** Injectable utterance factory; defaults to `new SpeechSynthesisUtterance`. */
  utteranceFactory?: (text: string) => SpeechSynthesisUtteranceLike;
  /** Injectable timers (tests use fake timers). */
  setIntervalFn?: (handler: () => void, timeout?: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
}

/** Gulf Arabic script languages preferred after Omani Arabic itself. */
const GULF_ARABIC_LANGS = new Set([
  "ar-sa",
  "ar-ae",
  "ar-bh",
  "ar-qa",
  "ar-kw",
  "ar-ye",
  "ar-om",
]);

/** 3 = Omani Arabic, 2 = Gulf Arabic, 1 = any Arabic, 0 = not Arabic. */
function arabicVoiceTier(lang: string): number {
  const normalized = lang.toLowerCase().replace("_", "-");
  if (normalized === "ar-om") return 3;
  if (GULF_ARABIC_LANGS.has(normalized)) return 2;
  if (normalized === "ar" || normalized.startsWith("ar-")) return 1;
  return 0;
}

/**
 * Deterministically pick the best Arabic voice: Omani Arabic first, then
 * Gulf Arabic, then any other Arabic voice. Returns null when no Arabic
 * voice exists (callers fall back to the platform default voice).
 */
export function pickArabicVoice(
  voices: SpeechSynthesisVoiceLike[],
): SpeechSynthesisVoiceLike | null {
  const candidates = voices
    .map((voice) => ({ voice, tier: arabicVoiceTier(voice.lang) }))
    .filter((c) => c.tier > 0);
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier;
      const langOrder = a.voice.lang.localeCompare(b.voice.lang);
      if (langOrder !== 0) return langOrder;
      return a.voice.name.localeCompare(b.voice.name);
    })[0]?.voice ?? null
  );
}

function resolveBrowserSpeechSynthesis(): SpeechSynthesisLike | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const synth = window.speechSynthesis;
  if (typeof synth.speak !== "function") return null;
  // The native interface is structurally compatible; the cast keeps our
  // narrow, mockable types authoritative.
  return synth as unknown as SpeechSynthesisLike;
}

function createNativeUtterance(
  text: string,
): SpeechSynthesisUtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as SpeechSynthesisUtteranceLike;
}

export class OwnerVoiceEngine {
  private readonly synth: SpeechSynthesisLike | null;
  private readonly utteranceFactory: (text: string) => SpeechSynthesisUtteranceLike;
  private readonly setIntervalFn: (handler: () => void, timeout?: number) => unknown;
  private readonly clearIntervalFn: (id: unknown) => void;

  private state: OwnerVoiceState;
  private current: SpeechSynthesisUtteranceLike | null = null;
  private listeners = new Set<() => void>();
  private pacerId: unknown = null;

  private readonly handleVoicesChanged = (): void => {
    this.refreshVoices();
  };

  constructor(options: OwnerVoiceEngineOptions = {}) {
    this.synth = options.synth ?? resolveBrowserSpeechSynthesis();
    this.utteranceFactory =
      options.utteranceFactory ?? createNativeUtterance;
    this.setIntervalFn =
      options.setIntervalFn ?? ((handler, timeout) => globalThis.setInterval(handler, timeout));
    this.clearIntervalFn =
      options.clearIntervalFn ?? ((id) => globalThis.clearInterval(id as number));

    const voices = this.safeGetVoices();
    this.state = {
      supported: this.synth !== null && typeof this.synth.speak === "function",
      speaking: false,
      lastText: null,
      rate: OWNER_VOICE_DEFAULT_RATE,
      voices,
      voice: pickArabicVoice(voices),
    };
    this.attachVoicesChanged();
  }

  // ------------------------------------------------------------------ state

  /** Referentially stable snapshot for useSyncExternalStore. */
  getSnapshot(): OwnerVoiceState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private update(patch: Partial<OwnerVoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  // ---------------------------------------------------------------- actions

  /**
   * Speak a summary. Cancels any current narration first (never overlaps),
   * then plays the text. Returns true when speech actually started.
   */
  speak(text: string): boolean {
    const trimmed = text.trim();
    if (!this.state.supported || trimmed === "" || !this.synth) return false;

    try {
      this.synth.cancel();
    } catch {
      // Ignore platform quirks; the new utterance still starts below.
    }
    this.stopPacer();

    const utterance = this.utteranceFactory(trimmed);
    utterance.text = trimmed;
    utterance.lang = this.state.voice?.lang ?? OWNER_VOICE_ARABIC_LOCALE;
    utterance.voice = this.state.voice;
    utterance.rate = OWNER_VOICE_RATE_VALUES[this.state.rate];
    utterance.onend = () => {
      if (this.current === utterance) this.finish();
    };
    utterance.onerror = () => {
      if (this.current === utterance) this.finish();
    };

    this.current = utterance;
    this.update({ speaking: true, lastText: trimmed });
    try {
      this.synth.speak(utterance);
    } catch {
      this.finish();
      return false;
    }
    this.startPacer();
    return true;
  }

  /** Stop any current narration; the last text is kept for replay(). */
  stop(): void {
    // Clear `current` BEFORE cancel: the pending onerror("canceled") from the
    // platform must not reset a newer narration's state.
    this.current = null;
    this.stopPacer();
    try {
      this.synth?.cancel();
    } catch {
      // Ignore platform quirks.
    }
    if (this.state.speaking) this.update({ speaking: false });
  }

  /** Re-read the last spoken text from the beginning. */
  replay(): boolean {
    if (!this.state.lastText) return false;
    return this.speak(this.state.lastText);
  }

  /** Apply a speed preset (takes effect from the next utterance). */
  setRate(rate: OwnerVoiceRate): void {
    if (rate === this.state.rate) return;
    this.update({ rate });
  }

  /** Optional manual voice selection (not exposed on the main UI). */
  selectVoice(voice: SpeechSynthesisVoiceLike | null): void {
    this.update({ voice });
  }

  /** Release the engine: stop speech, drop listeners, clear timers. */
  dispose(): void {
    this.stop();
    const synth = this.synth;
    if (synth) {
      try {
        if (typeof synth.removeEventListener === "function") {
          synth.removeEventListener("voiceschanged", this.handleVoicesChanged);
        } else if (synth.onvoiceschanged === this.handleVoicesChanged) {
          synth.onvoiceschanged = null;
        }
      } catch {
        // Ignore platform quirks.
      }
    }
    this.listeners.clear();
  }

  // -------------------------------------------------------------- internals

  private finish(): void {
    this.current = null;
    this.stopPacer();
    if (this.state.speaking) this.update({ speaking: false });
  }

  private safeGetVoices(): SpeechSynthesisVoiceLike[] {
    try {
      return this.synth?.getVoices() ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Chrome/Safari load voices asynchronously: re-pick after voiceschanged so
   * an Omani/Gulf Arabic voice is preferred as soon as it exists.
   */
  private refreshVoices(): void {
    const voices = this.safeGetVoices();
    if (voices.length === 0) return;
    const selected = this.state.voice;
    const stillPresent = selected
      ? voices.some(
          (v) => v.name === selected.name && v.lang === selected.lang,
        )
      : false;
    this.update({
      voices,
      voice: stillPresent ? selected : pickArabicVoice(voices),
    });
  }

  private attachVoicesChanged(): void {
    const synth = this.synth;
    if (!synth) return;
    try {
      if (typeof synth.addEventListener === "function") {
        synth.addEventListener("voiceschanged", this.handleVoicesChanged);
      } else if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = this.handleVoicesChanged;
      }
    } catch {
      // Ignore platform quirks.
    }
  }

  /**
   * Chrome pauses long utterances (~15s). While speaking, nudge `resume()`
   * on a slow interval so owner summaries (15–35s) play through.
   */
  private startPacer(): void {
    if (this.pacerId !== null) return;
    const synth = this.synth;
    if (!synth || typeof synth.resume !== "function") return;
    this.pacerId = this.setIntervalFn(() => {
      try {
        synth.resume?.();
      } catch {
        // Ignore platform quirks.
      }
    }, OWNER_VOICE_PACER_MS);
  }

  private stopPacer(): void {
    if (this.pacerId !== null) {
      this.clearIntervalFn(this.pacerId);
      this.pacerId = null;
    }
  }
}
