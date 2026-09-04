/**
 * Assistant speech engine — the single place the assistant touches
 * `speechSynthesis`. Built to read replies aloud in a warm, human Arabic
 * voice:
 *
 *  - Prefers a known-feminine Arabic voice (so the persona reads female),
 *    then Omani Arabic, then any Arabic voice.
 *  - Gentle pace (`rate 0.96`) and natural pitch — no robotic lift.
 *  - Nothing speaks on its own; `speak()` is only ever called by an explicit
 *    user action.
 */

export type AssistantSpeakerStatus = "idle" | "speaking";

export interface AssistantSpeechState {
  supported: boolean;
  status: AssistantSpeakerStatus;
  lastText: string | null;
}

/** Narrow structural types so tests can inject faithful fakes. */
export interface AssistantVoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}
export interface AssistantUtteranceLike {
  text: string;
  lang: string;
  voice: AssistantVoiceLike | null;
  rate: number;
  pitch: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}
export interface AssistantSynthLike {
  speak(utterance: AssistantUtteranceLike): void;
  cancel(): void;
  getVoices(): AssistantVoiceLike[];
}

const ARABIC_LOCALE = "ar-OM";
/** Slightly under 1: every word lands naturally, reads calm, not robotic. */
const SPEECH_RATE = 0.96;
/** Neutral pitch keeps a natural neural voice human-sounding. */
const SPEECH_PITCH = 1.0;

/** Known feminine Arabic catalogue names (Microsoft/Azure/Edge/Apple/Google). */
const FEMALE_ARABIC_VOICE_NAMES: ReadonlyArray<string> = [
  "zariyah",
  "hala",
  "hoda",
  "amira",
  "laysa",
  "lina",
  "lena",
  "laila",
  "layla",
  "salma",
  "fatima",
  "mariam",
  "maryam",
  "noura",
  "nora",
  "amal",
  "raheel",
  "reem",
  "sana",
  "آمنة",
  "لينا",
  "نورة",
  "مريم",
  "سلمى",
  "ليلى",
];

/** Deterministic language preference: Omani Arabic > Gulf > any Arabic. */
function arabicTier(lang: string): number {
  const normalized = (lang ?? "").toLowerCase().replace("_", "-");
  if (normalized === "ar-om") return 3;
  if (/^ar-(sa|ae|bh|qa|kw|ye)$/.test(normalized)) return 2;
  if (normalized === "ar" || normalized.startsWith("ar-")) return 1;
  return 0;
}

function isLikelyFeminine(name: string): boolean {
  const candidate = (name ?? "").toLowerCase();
  return (
    /female|feminine|أنثى|امرأة/.test(candidate) ||
    FEMALE_ARABIC_VOICE_NAMES.some((n) => candidate.includes(n))
  );
}

/** Pick the best Arabic voice, preferring a known-feminine one. */
export function pickAssistantArabicVoice(
  voices: AssistantVoiceLike[],
): AssistantVoiceLike | null {
  const arabic = voices
    .map((voice) => ({ voice, tier: arabicTier(voice.lang) }))
    .filter((c) => c.tier > 0);
  if (arabic.length === 0) return null;
  const sorted = [...arabic].sort((a, b) => {
    // Feminine wins over locale on purpose: a feminine ar-EG must beat a
    // masculine ar-OM, otherwise a device with only a male Omani voice would
    // silently speak as a man.
    const aF = isLikelyFeminine(a.voice.name) ? 1 : 0;
    const bF = isLikelyFeminine(b.voice.name) ? 1 : 0;
    if (aF !== bF) return bF - aF;
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.voice.name.localeCompare(b.voice.name);
  });
  return sorted[0]?.voice ?? null;
}

export interface AssistantSpeechEngineOptions {
  /** Auto-detect when omitted; `null` = unsupported; injected fake = used. */
  synth?: AssistantSynthLike | null;
  utteranceFactory?: (text: string) => AssistantUtteranceLike;
}

function resolveSynth(synth?: AssistantSynthLike | null): AssistantSynthLike | null {
  if (synth !== undefined) return synth;
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const candidate = window.speechSynthesis;
  return typeof candidate.speak === "function"
    ? (candidate as unknown as AssistantSynthLike)
    : null;
}

function defaultUtteranceFactory(text: string): AssistantUtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as AssistantUtteranceLike;
}

export class AssistantSpeechEngine {
  private readonly synth: AssistantSynthLike | null;
  private readonly utteranceFactory: (text: string) => AssistantUtteranceLike;
  private state: AssistantSpeechState;
  private current: AssistantUtteranceLike | null = null;
  private listeners = new Set<() => void>();

  constructor(options: AssistantSpeechEngineOptions = {}) {
    this.synth = resolveSynth(options.synth);
    this.utteranceFactory = options.utteranceFactory ?? defaultUtteranceFactory;
    this.state = { supported: this.synth !== null, status: "idle", lastText: null };
  }

  private update(patch: Partial<AssistantSpeechState>): void {
    const hasChanged = Object.entries(patch).some(
      ([key, value]) => this.state[key as keyof AssistantSpeechState] !== value,
    );
    if (!hasChanged) return;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  getSnapshot(): AssistantSpeechState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Speak `text` through the best Arabic (preferring feminine) voice. */
  speak(text: string): boolean {
    const trimmed = (text ?? "").trim();
    if (!this.synth || !trimmed) return false;

    this.cancel();
    const voice = pickAssistantArabicVoice(this.synth.getVoices());
    const utterance = this.utteranceFactory(trimmed);
    utterance.lang = ARABIC_LOCALE;
    utterance.voice = voice;
    utterance.rate = SPEECH_RATE;
    utterance.pitch = SPEECH_PITCH;
    utterance.onstart = () => this.update({ status: "speaking" });
    utterance.onend = () => this.update({ status: "idle" });
    utterance.onerror = () => this.update({ status: "idle" });
    this.current = utterance;
    this.update({ lastText: trimmed, status: "speaking" });

    try {
      this.synth.speak(utterance);
      return true;
    } catch {
      this.update({ status: "idle" });
      return false;
    }
  }

  cancel(): void {
    if (!this.synth) return;
    try {
      if (this.synth.cancel) this.synth.cancel();
    } finally {
      this.clearCurrent();
    }
  }

  private clearCurrent(): void {
    if (this.current) {
      this.current.onstart = null;
      this.current.onend = null;
      this.current.onerror = null;
      this.current = null;
    }
    this.update({ status: "idle" });
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }
}
