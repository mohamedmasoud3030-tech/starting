import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Bot, Send, Volume2, VolumeX, X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { ROLE_LABELS } from "@/lib/domain";
import { useAssistantVoice } from "./use-assistant-voice";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_NAME,
  ASSISTANT_PRODUCT,
  ASSISTANT_ROLE,
  ASSISTANT_SCOPE,
  buildAssistantAttribution,
} from "./assistant-identity";
import { useAssistant } from "./use-assistant";
import type { AssistantChatMessage } from "./assistant-types";

/**
 * Floating operations assistant for the hospitality platform.
 *
 * - Renders nothing unless the operator is signed in and inside an active
 *   organization (server gates remain authoritative; this is presentational).
 * - Gathers a fresh read-only context snapshot on every send, so figures
 *   reflect the current organization and role.
 * - Reads assistant replies aloud through the existing Owner Voice engine
 *   (explicit button only — nothing speaks on its own).
 */
export function AssistantLauncher() {
  const {
    user,
    currentOrganization,
    currentRole,
    canReadCost,
    canReadPayroll,
    canManageCommercial,
  } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [open, setOpen] = useState(false);

  const assistant = useAssistant({
    orgId: currentOrganization?.id ?? "",
    orgName: currentOrganization?.name ?? "",
    roleLabel: currentRole ? ROLE_LABELS[currentRole] : "",
    capabilities: {
      canReadCost,
      canReadPayroll,
      canManageCommercial,
    },
    surface: pathname,
  });

  const voice = useAssistantVoice();

  // Stop narration when the panel closes so audio never trails the user.
  useEffect(() => {
    if (!open) voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!user || !currentOrganization || currentOrganization.id.length === 0) {
    return null;
  }

  const handleSpeak = (content: string) => {
    if (voice.speaking) {
      voice.stop();
    } else {
      voice.speak(content);
    }
  };

  return (
    <>
      {open ? (
        <AssistantPanel
          messages={assistant.messages}
          loading={assistant.loading}
          error={assistant.error}
          spokenSpeaking={voice.speaking}
          onSpeak={handleSpeak}
          onSend={assistant.sendPrompt}
          onClose={() => setOpen(false)}
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
  spokenSpeaking,
  onSpeak,
  onSend,
  onClose,
}: {
  messages: AssistantChatMessage[];
  loading: boolean;
  error: string | null;
  spokenSpeaking: boolean;
  onSpeak: (content: string) => void;
  onSend: (prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");

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
      className="fixed bottom-40 end-4 z-50 flex max-h-[70dvh] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:bottom-24 md:end-7"
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
            <p className="text-sm leading-relaxed text-slate-700">{ASSISTANT_SCOPE}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Volume2 className="h-3.5 w-3.5" />
              دعم {ASSISTANT_PRODUCT}
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
                speaking={message.role === "assistant" && spokenSpeaking}
              />
            ))}
          </div>
        )}

        {loading ? (
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600 [animation-delay:120ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-brand-600 [animation-delay:240ms]" />
            <span className="ms-1">لينا تكتب…</span>
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

      {/* Input */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-slate-100 px-3 py-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="اسأل لينا…"
          disabled={loading}
          aria-label="الرسالة"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          aria-label="إرسال"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brand-700 text-white disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>

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
    <div
      className={cn(
        "flex items-start gap-2",
        isAssistant ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isAssistant
            ? "bg-slate-100 text-slate-800"
            : "bg-brand-700 text-white",
        )}
      >
        {message.content}
      </div>
      {onSpeak && isAssistant ? (
        <button
          type="button"
          onClick={onSpeak}
          aria-label={speaking ? "إيقاف القراءة" : "قراءة الرد"}
          className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-700"
        >
          {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  );
}
