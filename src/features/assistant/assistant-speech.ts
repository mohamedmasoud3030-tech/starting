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
  /** Whether the best available device voice is a known feminine Arabic voice. */
  hasFeminineVoice: boolean;
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
  addEventListener?(type: "voiceschanged", listener: () => void): void;
  removeEventListener?(type: "voiceschanged", listener: () => void): void;
}

const ARABIC_LOCALE = "ar-OM-u-nu-latn";
/** Slightly under 1: every word lands naturally, reads calm, not robotic. */
const SPEECH_RATE = 0.96;
/**
 * When no feminine Arabic voice exists on the device (common on Android with
 * a single Omani/male voice), a small lift keeps the read lighter; the cloud
 * feminine voice remains the primary, but we never let the fallback sound
 * deeper/more masculine than the device allows.
 */
const NEUTRAL_PITCH = 1.02;
const FEMALE_PITCH = 1.0;

/** Known feminine Arabic catalogue names (Microsoft/Azure/Edge/Apple/Google). */
const FEMALE_ARABIC_VOICE_NAMES: ReadonlyArray<string> = [
  "zariyah",
  "hala",
  "hoda",
  "huda",
  "amira",
  "laysa",
  "lina",
  "lena",
  "laila",
  "layla",
  "salma",
  "fatima",
  "fatemah",
  "mariam",
  "maryam",
  "noura",
  "nora",
  "noora",
  "amal",
  "asma",
  "asmaa",
  "aisha",
  "aiesha",
  "nadia",
  "rana",
  "rania",
  "dina",
  "ghada",
  "heba",
  "huda",
  "lubna",
  "manal",
  "muna",
  "munira",
  "nesma",
  "rawan",
  "reem",
  "sana",
  "shatha",
  "samira",
  "yasmin",
  "yasmeen",
  "آمنة",
  "لينا",
  "نورة",
  "مريم",
  "سلمى",
  "ليلى",
  "هدى",
  "لمى",
];

/** Known masculine Arabic catalogue names — never chosen when a female or an
 *  ungendered default exists. */
const MALE_ARABIC_VOICE_NAMES: ReadonlyArray<string> = [
  "hamdan",
  "bilal",
  "omar",
  "umair",
  "khaled",
  "khalid",
  "mohamed",
  "mohammad",
  "mazen",
  "hassan",
  "hussein",
  "husain",
  "tarek",
  "tarik",
  "fahad",
  "fahd",
  "abdullah",
  "majed",
  "youssef",
  "yousef",
  "zein",
  "raouf",
  "مازن",
  "حمدان",
  "محمد",
  "خالد",
  "حسن",
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

function isLikelyMasculine(name: string): boolean {
  const candidate = (name ?? "").toLowerCase();
  return MALE_ARABIC_VOICE_NAMES.some((n) => candidate.includes(n));
}

/** Pick the best Arabic voice: feminine first, ungendered default second,
 *  masculine only as a last resort. */
export function pickAssistantArabicVoice(
  voices: AssistantVoiceLike[],
): AssistantVoiceLike | null {
  const arabic = voices
    .map((voice) => ({
      voice,
      tier: arabicTier(voice.lang),
      female: isLikelyFeminine(voice.name),
      male: isLikelyMasculine(voice.name),
    }))
    .filter((c) => c.tier > 0);
  if (arabic.length === 0) return null;
  const sorted = [...arabic].sort((a, b) => {
    // Feminine beats locale; masculine never beats feminine or an ungendered
    // default. Only when every Arabic voice is explicitly male do we use one.
    if (a.female !== b.female) return a.female ? -1 : 1;
    if (a.male !== b.male) return a.male ? 1 : -1;
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
  private voiceCache: AssistantVoiceLike[] = [];
  private readonly onVoicesChanged: () => void;

  constructor(options: AssistantSpeechEngineOptions = {}) {
    this.synth = resolveSynth(options.synth);
    this.utteranceFactory = options.utteranceFactory ?? defaultUtteranceFactory;
    this.state = {
      supported: this.synth !== null,
      status: "idle",
      lastText: null,
      hasFeminineVoice: false,
    };
    this.onVoicesChanged = () => {
      this.refreshVoices();
    };
    // Voices load asynchronously on many engines (voiceschanged) — listen so a
    // feminine Arabic voice is used the moment it becomes available.
    this.synth?.addEventListener?.("voiceschanged", this.onVoicesChanged);
    this.refreshVoices();
  }

  private refreshVoices(): void {
    if (!this.synth) return;
    try {
      const voices = this.synth.getVoices() ?? [];
      const changed =
        voices.length !== this.voiceCache.length ||
        voices.some((v, i) => this.voiceCache[i]?.name !== v.name);
      this.voiceCache = voices;
      if (changed) {
        const best = pickAssistantArabicVoice(voices);
        this.update({ hasFeminineVoice: best ? isLikelyFeminine(best.name) : false });
        for (const listener of [...this.listeners]) listener();
      }
    } catch {
      this.voiceCache = [];
    }
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
    this.refreshVoices();
    const voice = pickAssistantArabicVoice(this.voiceCache);
    const feminine = voice ? isLikelyFeminine(voice.name) : false;
    const masculine = voice ? isLikelyMasculine(voice.name) : false;
    const utterance = this.utteranceFactory(trimmed);
    utterance.lang = voice?.lang ?? ARABIC_LOCALE;
    utterance.voice = voice;
    utterance.rate = SPEECH_RATE;
    // Keep the read light: neutral pitch when a female voice is present, a
    // touch higher when only a male/ungendered device voice exists.
    utterance.pitch = feminine ? FEMALE_PITCH : NEUTRAL_PITCH;
    utterance.onstart = () => this.update({ status: "speaking" });
    utterance.onend = () => this.update({ status: "idle" });
    utterance.onerror = () => this.update({ status: "idle" });
    this.current = utterance;
    this.update({ lastText: trimmed, status: "speaking" });

    try {
      this.synth.speak(utterance);
      if (this.state.status === "speaking") {
        // eslint-disable-next-line no-console
        console.info(
          `[لينا] device voice="${voice?.name ?? "browser default"}" lang="${voice?.lang ?? ""}" ` +
            `feminine=${feminine} male=${masculine} pitch=${utterance.pitch}`,
        );
      }
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
    this.synth?.removeEventListener?.("voiceschanged", this.onVoicesChanged);
    this.cancel();
    this.listeners.clear();
  }
}
