import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/** Relative URL of the build marker written at deploy time. */
const VERSION_URL = "/version.json";
/** How often an open tab re-checks for a newer build. */
const POLL_MS = 90_000;

/**
 * "يتوفر تحديث جديد" banner.
 *
 * Shows on WHATEVER page the user currently has open the moment a newer build
 * is deployed: the tab compares the version.json marker it captured at load
 * with the marker now served by the alias, and when they differ it offers a
 * one-tap reload. Works without a service worker change.
 */
export function UpdateBanner() {
  const [open, setOpen] = useState(false);
  const baseVersionRef = useRef<string | null>(null);

  const check = async () => {
    try {
      const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { version?: string } | null;
      const version = String(data?.version ?? "");
      if (!version) return;
      if (baseVersionRef.current === null) {
        // First successful read while the page is alive = the running build.
        baseVersionRef.current = version;
        return;
      }
      if (version !== baseVersionRef.current) {
        setOpen(true);
      }
    } catch {
      // Offline / transient — the next poll will try again.
    }
  };

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-3 print:hidden"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <RefreshCw className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 leading-snug">
          <p className="text-sm font-extrabold text-slate-900">
            يتوفر تحديث جديد
          </p>
          <p className="text-sm text-slate-600">
            اضغط «تحديث الآن» للحصول على آخر إصدار.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex-none rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800"
        >
          تحديث الآن
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="إغلاق"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
