import { useState } from "react";
import { RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OwnerVoiceEngine, OwnerVoiceRate } from "./engine";
import { useOwnerVoice } from "./useOwnerVoice";

/**
 * The single, very obvious "اسمع الصفحة" control.
 *
 * - One large, high-contrast, icon + Arabic-text button near the page heading.
 * - While speaking the action becomes "إيقاف القراءة"; after stopping it
 *   becomes "إعادة القراءة".
 * - A tiny three-option speed control (أبطأ / عادي / أسرع) is the only
 *   setting exposed on the main UI — no complex voice settings here.
 * - `summary === null` (or empty) renders nothing: screens without a useful
 *   voice summary never show a fake button.
 *
 * Accessibility notes:
 * - Deliberately NO aria-live region: the summary is already spoken aloud,
 *   and announcing it again would conflict with system screen readers.
 * - The control is fully keyboard reachable and uses the app's focus-visible
 *   outline; state is conveyed by label + icon + text, never color alone.
 */
export interface OwnerVoiceButtonProps {
  /** Deterministic spoken summary for this screen. null/"" hides the button. */
  summary: string | null;
  /** Injectable engine (tests). Defaults to the browser engine. */
  engine?: OwnerVoiceEngine;
  className?: string;
}

const RATE_OPTIONS: ReadonlyArray<{ value: OwnerVoiceRate; label: string }> = [
  { value: "slow", label: "أبطأ" },
  { value: "normal", label: "عادي" },
  { value: "fast", label: "أسرع" },
];

export function OwnerVoiceButton({
  summary,
  engine,
  className,
}: OwnerVoiceButtonProps) {
  const voice = useOwnerVoice(engine);
  // The summary this button has already read once, so the idle action can
  // switch to "إعادة القراءة" after the first listen.
  const [spokenFor, setSpokenFor] = useState<string | null>(null);

  const canSpeak = summary !== null && summary.trim() !== "";
  const isCurrentSummary = spokenFor === summary;

  if (!canSpeak) return null;

  const unsupported = !voice.supported;
  const label = unsupported
    ? "القراءة الصوتية غير مدعومة"
    : voice.speaking
      ? "إيقاف القراءة"
      : isCurrentSummary
        ? "إعادة القراءة"
        : "اسمع الصفحة";
  const Icon = unsupported
    ? VolumeX
    : voice.speaking
      ? Square
      : isCurrentSummary
        ? RotateCcw
        : Volume2;

  function onMainPress() {
    if (unsupported || !canSpeak) return;
    if (voice.speaking) {
      voice.stop();
      return;
    }
    // Both the first read and "إعادة القراءة" restart the CURRENT summary,
    // so a re-read always reflects the latest screen data.
    setSpokenFor(summary);
    voice.speak(summary);
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-2", className)}>
      <button
        type="button"
        onClick={onMainPress}
        disabled={unsupported}
        aria-disabled={unsupported}
        title={
          unsupported
            ? "القراءة الصوتية غير مدعومة في هذا المتصفح"
            : undefined
        }
        className={cn(
          "inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-xl px-6 text-lg font-black shadow-md transition-colors sm:w-auto",
          unsupported
            ? "cursor-not-allowed border border-slate-400 bg-slate-200 text-slate-700 shadow-none"
            : voice.speaking
              ? "border-2 border-red-900 bg-red-600 text-white hover:bg-red-700"
              : "border-2 border-brand-900 bg-brand-700 text-white hover:bg-brand-800",
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
        {label}
      </button>

      {!unsupported && (
        <div
          role="group"
          aria-label="سرعة القراءة"
          className="flex items-center justify-center gap-1"
        >
          {RATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={voice.rate === option.value}
              onClick={() => voice.setRate(option.value)}
              className={cn(
                "min-h-9 rounded-lg px-3 text-sm font-bold transition-colors",
                voice.rate === option.value
                  ? "bg-brand-800 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
