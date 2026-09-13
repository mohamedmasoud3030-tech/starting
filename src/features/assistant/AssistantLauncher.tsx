import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Bot, Mic, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { ROLE_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { synthesizeSpeech } from "./assistant-api";
import { useAssistant } from "./use-assistant";
import { useAssistantVoice } from "./use-assistant-voice";
import { useVoiceInput } from "./use-voice-input";
import type { AssistantChatMessage } from "./assistant-types";
import {
  ASSISTANT_NAME,
  ASSISTANT_ROLE,
  ASSISTANT_SCOPE,
  buildAssistantAttribution,
} from "./assistant-identity";

function base64ToAudioUrl(audioB64: string, mimeType: string): string {
  const binary = atob(audioB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * A 1-sample silent WAV. Playing it *inside* a user gesture "unlocks" the
 * <audio> element on iOS Safari / Android Chrome, so a clip that arrives
 * seconds later (after the cloud round-trip) is still allowed to play.
 * Without this, autoplay policy rejects every reply after the first.
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

let synthWarmed = false;

function unlockAudioElement(el: HTMLAudioElement | null): void {
  if (!el) return;
  try {
    el.muted = false;
    el.volume = 1;
    el.src = SILENT_WAV;
    el.load();
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* noop */
  }
  // Warm the device speech engine too (Safari needs one speak() in a
  // gesture) — once per page, so later taps never interrupt a live read.
  if (synthWarmed) return;
  synthWarmed = true;
  try {
    const synth = window.speechSynthesis;
    if (synth) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    }
  } catch {
    /* noop */
  }
}

/** First word of the owner's name (e.g. "يعقوب الخصيبي" → "يعقوب"). */
function friendlyFirstName(fullName: string | null | undefined): string | null {
  const cleaned = (fullName ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const first = cleaned.split(" ")[0];
  return first && first.length > 0 ? first : null;
}

/** Polite salutation: «يا أستاذ يعقوب» — once, not repeated. */
function buildSalutation(firstName: string | null): string {
  return firstName ? `أستاذ ${firstName}` : "أستاذ";
}

/** Spoken + shown greeting when «لينا» is opened for the first time. */
function buildWelcomeText(firstName: string | null): string {
  if (!firstName) {
    return "يا هلا! أنا لينا، جاهزة أساعدك في مناسباتك وحجوزاتك.";
  }
  return `يا هلا ${buildSalutation(firstName)}! أنا لينا، جاهزة أساعدك في مناسباتك وحجوزاتك.`;
}

/** Make a reply read naturally when spoken aloud: strip markdown/list marks,
 *  guillemets, Latin event codes and stray punctuation that make TTS pause
 *  oddly or "cut" mid-sentence. */
function toSpokenText(text: string): string {
  return text
    .replace(/[«»""“”‘’*_`#]/g, "")
    .replace(/EV-\d{4}-\d+/gi, "")
    .replace(/^[\s]*[-•▪]\s*/gm, "")
    .replace(/^\s*\d+[\.\)]\s*/gm, "")
    .replace(/—/g, "، ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

/**
 * Feature flag: hide assistant when VITE_ENABLE_ASSISTANT=false
 * Default is enabled (true) to preserve existing behavior.
 */
function isAssistantEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_ASSISTANT;
  if (raw === undefined || raw === null || raw === "") return true;
  return String(raw).toLowerCase() !== "false";
}

/**
 * «لينا» — floating voice-enabled operations assistant.
 *
 * Renders only inside an active organization. Every assistant reply is read
 * aloud automatically (feminine cloud voice when configured, browser voice
 * otherwise) and can be toggled off; the mic button turns the manager's
 * voice message into a prompt.
 */
export function AssistantLauncher() {
  const {
    user,
    profile,
    currentOrganization,
    currentRole,
    canReadCost,
    canReadPayroll,
    canManageCommercial,
  } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [open, setOpen] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [audioSpeaking, setAudioSpeaking] = useState(false);
  /** A reply is waiting for a tap because the browser blocked autoplay. */
  const [tapToHear, setTapToHear] = useState(false);
  const voice = useAssistantVoice();
  const voiceInput = useVoiceInput();

  /** The owner's first name (profile.full_name) — «لينا» calls them by it. */
  const ownerFirstName = friendlyFirstName(profile?.full_name);

  const assistant = useAssistant({
    orgId: currentOrganization?.id ?? "",
    orgName: currentOrganization?.name ?? "",
    roleLabel: currentRole ? ROLE_LABELS[currentRole] : "",
    userName: profile?.full_name ?? null,
    capabilities: {
      canReadCost,
      canReadPayroll,
      canManageCommercial,
    },
    surface: pathname,
  });

  const spokenAssistantCount = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingSpeakRef = useRef<{ text: string } | null>(null);
  /**
   * Monotonic token: every `speakText` call bumps it. Any in-flight call whose
   * token is stale (a newer speak/stop happened while awaiting the cloud) must
   * abort instead of starting a second voice — this is what previously let the
   * device (male) voice talk over the cloud (لينا) voice.
   */
  const speakGenerationRef = useRef(0);
  /** Small LRU of cloud clips by exact reply text — replays never re-bill
   *  the provider quota and start instantly. */
  const cloudClipCacheRef = useRef<Map<string, { audioB64: string; mimeType: string }>>(new Map());
  /** When the cloud voice quota is spent, stop calling it until this time. */
  const cloudBlockedUntilRef = useRef(0);

  const playCloudClip = useCallback(
    (audioB64: string, mimeType: string): Promise<boolean> => {
      const element = audioElRef.current;
      if (!element) return Promise.resolve(false);
      return new Promise((resolve) => {
        if (element.currentSrc) {
          try {
            URL.revokeObjectURL(element.currentSrc);
          } catch {
            /* noop */
          }
        }
        const url = base64ToAudioUrl(audioB64, mimeType);
        const finish = (ok: boolean) => {
          element.onplay = null;
          element.onended = null;
          element.onerror = null;
          resolve(ok);
        };
        element.onplay = () => {
          setAudioSpeaking(true);
          setTapToHear(false);
          resolve(true);
        };
        element.onended = () => {
          setAudioSpeaking(false);
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* noop */
          }
          finish(true);
        };
        element.onerror = () => {
          setAudioSpeaking(false);
          finish(false);
        };
        element.muted = false;
        element.volume = 1;
        element.src = url;
        element.load();
        element.play().catch((err: unknown) => {
          // Autoplay policy (NotAllowedError) / decode failure on mobile.
          console.info("[لينا] audio.play() rejected:", (err as Error)?.name ?? err);
          setAudioSpeaking(false);
          finish(false);
        });
      });
    },
    [],
  );

  const stopAudio = useCallback(() => {
    speakGenerationRef.current += 1;
    pendingSpeakRef.current = null;
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.onended = null;
      el.onerror = null;
      if (el.src) {
        try {
          URL.revokeObjectURL(el.currentSrc || el.src);
        } catch {
          /* noop */
        }
      }
      el.removeAttribute("src");
    }
    setAudioSpeaking(false);
    voice.stop();
  }, [voice]);

  const speakLocally = useCallback(
    (trimmed: string): boolean => {
      // لينا is a female persona: if the device only offers a masculine
      // Arabic voice, stay silent (the text is still shown) rather than
      // letting a male voice speak in her place.
      if (!voice.hasFeminineVoice && voice.hasMasculineVoice) {
        console.info(
          "[لينا] cloud voice unavailable and only a masculine device voice → text only.",
        );
        return false;
      }
      console.info(
        "[لينا] cloud voice unavailable → device speech engine. supported=",
        voice.supported,
      );
      // Never let the device voice overlap a cloud clip.
      audioElRef.current?.pause();
      setAudioSpeaking(false);
      const started = voice.speak(trimmed);
      if (!started) {
        pendingSpeakRef.current = { text: trimmed };
      }
      return started;
    },
    [voice],
  );

  const speakText = useCallback(
    async (text: string) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      const spoken = toSpokenText(trimmed) || trimmed;
      const generation = ++speakGenerationRef.current;
      const isStale = () => speakGenerationRef.current !== generation;
      const el = audioElRef.current;
      el?.pause();
      voice.stop();
      setAudioSpeaking(false);

      const cache = cloudClipCacheRef.current;
      const cached = cache.get(trimmed);

      if (cached) {
        // Make sure the device voice is silent before the cloud clip starts.
        // No `await` before play(): when this runs inside a tap (▶ on a
        // message, or the retry tap) Safari only honours play() synchronously.
        voice.stop();
        const played = await playCloudClip(cached.audioB64, cached.mimeType);
        if (isStale()) return;
        if (played) {
          pendingSpeakRef.current = null;
          return;
        }
        // Playback blocked (autoplay policy): keep the reply so the next tap
        // replays it, then try the device voice.
        pendingSpeakRef.current = { text: trimmed };
        if (!speakLocally(spoken)) setTapToHear(true);
        return;
      }

      const cloudAllowed = Date.now() >= cloudBlockedUntilRef.current;
      if (cloudAllowed) {
        const outcome = await synthesizeSpeech(spoken);
        if (outcome.kind === "ok") {
          cache.set(trimmed, { audioB64: outcome.audioB64, mimeType: outcome.mimeType });
          if (cache.size > 5) {
            const oldest = cache.keys().next().value as string | undefined;
            if (oldest) cache.delete(oldest);
          }
        }
        // A newer speak/stop happened while we waited → do NOT start a second
        // voice on top of it.
        if (isStale()) return;
        if (outcome.kind === "ok") {
          voice.stop();
          const played = await playCloudClip(outcome.audioB64, outcome.mimeType);
          if (isStale()) return;
          if (played) {
            pendingSpeakRef.current = null;
            return;
          }
          pendingSpeakRef.current = { text: trimmed };
          if (!speakLocally(spoken)) setTapToHear(true);
          return;
        }
        if (outcome.kind === "quota") {
          cloudBlockedUntilRef.current = Date.now() + 60 * 60 * 1000;
        }
      }

      if (isStale()) return;
      speakLocally(spoken);
    },
    [voice, playCloudClip, speakLocally],
  );

  useEffect(() => {
    if (!open) return;
    // Any tap while the panel is open re-arms audio and replays a reply that
    // was blocked by the autoplay policy.
    const onPointer = () => {
      // Only arm when nothing is playing — re-loading the element mid-clip
      // would cut لينا off.
      const el = audioElRef.current;
      const idle = !el || el.paused || el.ended;
      if (idle) unlockAudioElement(el);
      const pending = pendingSpeakRef.current?.text;
      if (pending) {
        pendingSpeakRef.current = null;
        setTapToHear(false);
        void speakText(pending);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, speakText]);

  const speaking = voice.speaking || audioSpeaking;

  useEffect(() => {
    if (!open || !autoSpeak) return;
    const last = assistant.messages[assistant.messages.length - 1];
    if (last?.role === "assistant" && assistant.messages.length > spokenAssistantCount.current) {
      spokenAssistantCount.current = assistant.messages.length;
      void speakText(last.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.messages, open, autoSpeak]);

  const welcomeSaidRef = useRef(false);
  useEffect(() => {
    if (!open || !autoSpeak || assistant.messages.length !== 0) return;
    if (welcomeSaidRef.current) return;
    welcomeSaidRef.current = true;
    const timer = window.setTimeout(() => {
      void speakText(buildWelcomeText(ownerFirstName));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open, autoSpeak, assistant.messages.length, ownerFirstName, speakText]);

  useEffect(() => {
    if (!open) {
      stopAudio();
      if (voiceInput.status !== "idle") voiceInput.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!isAssistantEnabled()) {
    return null;
  }

  if (!user || !currentOrganization || currentOrganization.id.length === 0) {
    return null;
  }

  const toggleMic = () => {
    if (voiceInput.status !== "idle") {
      voiceInput.stop();
      return;
    }
    voiceInput.start((text) => {
      if (text.trim() && !assistant.loading) void assistant.sendPrompt(text);
    });
  };

  return (
    <>
      <audio ref={audioElRef} className="hidden" preload="auto" aria-hidden="true" />
      {open ? (
        <AssistantPanel
          messages={assistant.messages}
          loading={assistant.loading}
          error={assistant.error ?? voiceInput.error}
          autoSpeak={autoSpeak}
          onToggleAutoSpeak={() => setAutoSpeak((v) => !v)}
          micStatus={voiceInput.status}
          micSupported={voiceInput.supported}
          onMic={toggleMic}
          onSpeak={speakText}
          onStopSpeaking={stopAudio}
          speaking={speaking}
          onSend={assistant.sendPrompt}
          onClose={() => setOpen(false)}
          welcomeText={buildWelcomeText(ownerFirstName)}
          isDegraded={assistant.isDegraded}
          lastSource={assistant.lastSource}
          tapToHear={tapToHear}
        />
      ) : null}

      <button
        type="button"
        onClick={() => {
          // Must run synchronously inside the tap: this is the only moment
          // mobile browsers let us arm audio playback.
          if (!open) unlockAudioElement(audioElRef.current);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-label={open ? `إغلاق مساعد ${ASSISTANT_NAME}` : `فتح مساعد ${ASSISTANT_NAME}`}
        className={cn(
          "fixed bottom-[4.75rem] end-3 z-30 flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full shadow-lg md:bottom-7 md:end-7 md:h-14 md:w-14",
          open
            ? "bg-slate-900 text-white hover:bg-slate-800"
            : "bg-brand-700 text-white hover:bg-brand-800",
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>
    </>
  );
}

const SUGGESTIONS: ReadonlyArray<string> = [
  "ما أهم ما أهتم به اليوم؟",
  "كم المستحقات المتبقية؟",
  "أي المناسبات تحتاج تجهيزاً؟",
  "ما التنبيهات التي تستحق الانتباه؟",
];

function AssistantPanel({
  messages,
  loading,
  error,
  autoSpeak,
  onToggleAutoSpeak,
  micStatus,
  micSupported,
  onMic,
  onSpeak,
  onStopSpeaking,
  speaking,
  onSend,
  onClose,
  welcomeText,
  isDegraded,
  tapToHear,
  lastSource,
}: {
  messages: AssistantChatMessage[];
  loading: boolean;
  error: string | null;
  autoSpeak: boolean;
  onToggleAutoSpeak: () => void;
  micStatus: string;
  micSupported: boolean;
  onMic: () => void;
  onSpeak: (content: string) => void;
  onStopSpeaking: () => void;
  speaking: boolean;
  onSend: (prompt: string) => Promise<void>;
  onClose: () => void;
  welcomeText: string;
  isDegraded: boolean;
  tapToHear: boolean;
  lastSource: string | null;
}) {
  const [draft, setDraft] = useState("");
  const micActive = micStatus !== "idle";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || loading) return;
    setDraft("");
    void onSend(prompt);
  };

  const isEmpty = messages.length === 0;

  return (
    <aside
      role="dialog"
      aria-label={`مساعد ${ASSISTANT_NAME}`}
      className="fixed bottom-[8.5rem] end-3 z-50 flex max-h-[70dvh] w-[min(27rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:bottom-24 md:end-7"
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 bg-brand-700 px-4 py-3 text-white">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{ASSISTANT_NAME}</p>
          <p className="truncate text-xs text-white/80">{ASSISTANT_ROLE}</p>
          {isDegraded ? (
            <p className="mt-1 inline-flex rounded bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              وضع تجريبي — ردود عامة {lastSource ? `(${lastSource})` : ""}
            </p>
          ) : lastSource === "model" ? (
            <p className="mt-1 inline-flex rounded bg-emerald-400 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
              متصل مباشر ببيانات النظام
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleAutoSpeak}
          title={autoSpeak ? "إيقاف القراءة التلقائية" : "تفعيل القراءة التلقائية"}
          aria-pressed={autoSpeak}
          aria-label={autoSpeak ? "إيقاف القراءة التلقائية" : "تفعيل القراءة التلقائية"}
          className={cn(
            "flex h-9 w-9 flex-none items-center justify-center rounded-lg hover:bg-white/10",
            autoSpeak ? "text-white" : "text-white/50",
          )}
        >
          {autoSpeak ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isEmpty ? (
          <div className="space-y-3">
            <p className="text-[15px] font-extrabold leading-relaxed text-brand-800">
              {welcomeText}
            </p>
            <p className="text-sm leading-relaxed text-slate-600">{ASSISTANT_SCOPE}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Mic className="h-3.5 w-3.5" />
              اضغط الميكروفون وتكلم، أو اكتب سؤالك — سأجيبك بصوتي.
            </p>
            {isDegraded ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                تنبيه: المساعد يعمل في وضع تجريبي لأن مفتاح الذكاء الاصطناعي غير مهيأ. الردود ستكون عامة من أرقام لوحتك فقط، والصوت سيكون من جهازك.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <MessageBubble
                key={index}
                message={message}
                onSpeak={
                  message.role === "assistant"
                    ? () => {
                        onSpeak(message.content);
                      }
                    : undefined
                }
                speaking={message.role === "assistant" && speaking}
              />
            ))}
          </div>
        )}

        {loading ? (
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600 [animation-delay:120ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600 [animation-delay:240ms]" />
            <span className="ms-1">{ASSISTANT_NAME} تكتب…</span>
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {tapToHear ? (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-bold text-brand-800" role="status">
            المتصفح منع تشغيل الصوت تلقائياً — اضغط في أي مكان لسماع الرد.
          </p>
        ) : null}

        {isEmpty && !loading ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void onSend(suggestion)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Input + mic */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-slate-100 px-3 py-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={micActive ? "أنا أستمع إليك…" : `اسأل ${ASSISTANT_NAME} أو اضغط الميكروفون…`}
          disabled={loading || micActive}
          aria-label="الرسالة"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
        />
        {micSupported ? (
          <button
            type="button"
            onClick={onMic}
            disabled={loading}
            title={micActive ? "إنهاء التسجيل" : "تحدث إلى لينا"}
            aria-label={micActive ? "إنهاء التسجيل الصوتي" : "إرسال رسالة صوتية"}
            className={cn(
              "flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors",
              micActive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border border-slate-200 text-slate-500 hover:border-brand-400 hover:text-brand-700",
            )}
          >
            {micActive ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={loading || !draft.trim() || micActive}
          aria-label="إرسال"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brand-700 text-white disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>

      {speaking ? (
        <button
          type="button"
          onClick={onStopSpeaking}
          className="flex items-center justify-center gap-2 border-t border-slate-100 px-4 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
        >
          <Square className="h-3 w-3" />
          إيقاف القراءة
        </button>
      ) : null}

      {/* Attribution */}
      <p
        data-ai-attribution
        className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-400"
      >
        {buildAssistantAttribution()}
      </p>
    </aside>
  );
}

function MessageBubble({
  message,
  onSpeak,
  speaking,
}: {
  message: AssistantChatMessage;
  onSpeak?: () => void;
  speaking?: boolean;
}) {
  const isAssistant = message.role === "assistant";
  return (
    <div className={cn("flex items-start gap-2", isAssistant ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isAssistant ? "bg-slate-100 text-slate-800" : "bg-brand-700 text-white",
        )}
      >
        {message.content}
      </div>
      {onSpeak && isAssistant ? (
        <button
          type="button"
          onClick={onSpeak}
          aria-label={speaking ? "إعادة قراءة الرد" : "قراءة الرد"}
          className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-700"
        >
          <Volume2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
