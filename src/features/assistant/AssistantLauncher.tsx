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

/** First word of the owner's name (e.g. "يعقوب الخصيبي" → "يعقوب"). */
function friendlyFirstName(fullName: string | null | undefined): string | null {
  const cleaned = (fullName ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const first = cleaned.split(" ")[0];
  return first && first.length > 0 ? first : null;
}

/** Spoken + shown greeting when «لينا» is opened for the first time. */
function buildWelcomeText(firstName: string | null): string {
  const intro = "يا هلا! أنا «لينا»، مساعدتك الشخصية في نظام الضيافة والمناسبات.";
  if (!firstName) {
    return `${intro} اسألني عن المناسبات أو الحجوزات، أو كلّمني بصوتك، وأنا معك خطوة بخطوة.`;
  }
  return `يا هلا ${firstName}! أنا «لينا»، مساعدتك الشخصية. اسألني عن مناسباتك أو حجوزات المطاعم، أو كلّمني بصوتك، وأنا معك خطوة بخطوة.`;
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
        element.onplay = () => setAudioSpeaking(true);
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
        element.src = url;
        element.load();
        element.play().then(
          () => finish(true),
          () => {
            // Autoplay policy / decode failure on mobile.
            setAudioSpeaking(false);
            finish(false);
          },
        );
      });
    },
    [],
  );

  const stopAudio = useCallback(() => {
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
      // Browser-local feminine Arabic voice (unlimited, works offline).
      // Diagnostics: the owner reports silence on some devices — knowing
      // whether the reply fell back to the device engine is the first clue.
      console.info(
        "[لينا] cloud voice unavailable → device speech engine. supported=",
        voice.supported,
      );
      const started = voice.speak(trimmed);
      if (!started) {
        // Autoplay/lock or no speech engine yet — retry on the next tap
        // inside a user gesture where the browser allows audio.
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
      const el = audioElRef.current;
      el?.pause();
      voice.stop();
      setAudioSpeaking(false);

      const cache = cloudClipCacheRef.current;
      const cached = cache.get(trimmed);

      // 1) Replay from the in-session cache — instant, free.
      if (cached) {
        const played = await playCloudClip(cached.audioB64, cached.mimeType);
        if (played) {
          pendingSpeakRef.current = null;
          return;
        }
        // Cached clip failed to decode/play → local voice.
        speakLocally(trimmed);
        return;
      }

      // 2) Feminine cloud voice — unless today's provider quota is spent.
      const cloudAllowed = Date.now() >= cloudBlockedUntilRef.current;
      if (cloudAllowed) {
        const outcome = await synthesizeSpeech(trimmed);
        if (outcome.kind === "ok") {
          cache.set(trimmed, { audioB64: outcome.audioB64, mimeType: outcome.mimeType });
          if (cache.size > 5) {
            const oldest = cache.keys().next().value as string | undefined;
            if (oldest) cache.delete(oldest);
          }
          const played = await playCloudClip(outcome.audioB64, outcome.mimeType);
          if (played) {
            pendingSpeakRef.current = null;
            return;
          }
          speakLocally(trimmed);
          return;
        }
        if (outcome.kind === "quota") {
          // Whole-day budget spent: don't keep probing the provider.
          cloudBlockedUntilRef.current = Date.now() + 60 * 60 * 1000;
        }
        // kind === "failed" → transient, allow a quick retry next time.
      }

      // 3) Browser-local feminine Arabic voice as the resilient fallback.
      speakLocally(trimmed);
    },
    [voice, playCloudClip, speakLocally],
  );

  // A pending voice reply is retried on the next user tap (user gesture),
  // which lifts the autoplay restriction on mobile browsers.
  useEffect(() => {
    if (!open || !pendingSpeakRef.current) return;
    const onPointer = () => {
      const pending = pendingSpeakRef.current?.text;
      if (pending) {
        pendingSpeakRef.current = null;
        void speakText(pending);
      }
    };
    window.addEventListener("pointerdown", onPointer, { once: true });
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, speakText, pendingSpeakRef]);

  const speaking = voice.speaking || audioSpeaking;

  // Read each new assistant reply aloud when auto-speak is on.
  useEffect(() => {
    if (!open || !autoSpeak) return;
    const last = assistant.messages[assistant.messages.length - 1];
    if (last?.role === "assistant" && assistant.messages.length > spokenAssistantCount.current) {
      spokenAssistantCount.current = assistant.messages.length;
      void speakText(last.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.messages, open, autoSpeak]);

  // Warm spoken welcome the first time the panel opens (the open tap is a
  // user gesture, so audio is allowed on mobile). It addresses the owner by
  // name and reads naturally — the assistant's very first "hello" is human.
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

  // Silence everything when the panel closes.
  useEffect(() => {
    if (!open) {
      stopAudio();
      if (voiceInput.status !== "idle") voiceInput.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      {/* Persistent (attached) audio element: required for reliable playback
          of the cloud voice on mobile WebKit/Blink. */}
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
        />
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? `إغلاق مساعد ${ASSISTANT_NAME}` : `فتح مساعد ${ASSISTANT_NAME}`}
        className={cn(
          "fixed bottom-24 end-4 z-50 flex h-14 w-14 flex-none items-center justify-center rounded-full shadow-lg md:bottom-7 md:end-7 md:h-16 md:w-16",
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
      className="fixed bottom-40 end-4 z-50 flex max-h-[70dvh] w-[min(27rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:bottom-24 md:end-7"
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 bg-brand-700 px-4 py-3 text-white">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{ASSISTANT_NAME}</p>
          <p className="truncate text-xs text-white/80">{ASSISTANT_ROLE}</p>
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
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <MessageBubble
                key={index}
                message={message}
                onSpeak={
                  message.role === "assistant" ? () => onSpeak(message.content) : undefined
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
