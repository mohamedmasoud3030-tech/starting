import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastContext, type ToastApi } from "./toastContext";

/**
 * Application-wide feedback toasts.
 *
 * One `<ToastProvider>` is mounted inside the authenticated app shell (it is
 * NOT available on the pre-auth screens, which keep their inline form errors).
 * Pages/panels call `const toast = useToast()` then `toast.success("…")` /
 * `toast.error("…")` after a mutation so the operator gets a clear "what
 * happened after I acted" signal without a modal blocking their next step.
 *
 * Accessibility: the region is a polite live region for success/info and an
 * assertive one for errors; every toast has a labelled close button and can
 * be dismissed with Escape. Auto-dismiss never removes an error toast while
 * it is hovered/focused (errors stay until acknowledged or 12s elapse).
 */

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** ms before auto-dismiss; `null` keeps it until dismissed. */
  duration: number | null;
}

const MAX_TOASTS = 3;

const TONE_STYLES: Record<
  ToastTone,
  { container: string; icon: typeof CheckCircle2 }
> = {
  success: {
    container: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-900",
    icon: AlertCircle,
  },
  info: {
    container: "border-slate-200 bg-white text-slate-900",
    icon: Info,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    const item: ToastItem = {
      id,
      tone,
      message,
      // Errors linger longer so an operator looking away still sees them.
      duration: tone === "error" ? 12000 : 5000,
    };
    setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), item]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  // One Escape press clears the stack.
  useEffect(() => {
    if (toasts.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const last = toasts[toasts.length - 1];
      if (event.key === "Escape" && last) onDismiss(last.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toasts, onDismiss]);

  return (
    <div
      // `aria-live` is set per-tone below; the wrapper simply positions the
      // stack and keeps it out of the layout flow.
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3 sm:top-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const tone = TONE_STYLES[toast.tone];
  const Icon = tone.icon;

  useEffect(() => {
    if (paused || toast.duration === null) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [paused, toast.duration, toast.id, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border p-3 shadow-lg",
        "animate-[toast-in_180ms_ease-out]",
        tone.container,
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-bold leading-6">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="إغلاق التنبيه"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
