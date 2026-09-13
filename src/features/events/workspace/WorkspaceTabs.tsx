import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  groupWorkspaceTabs,
  type WorkspaceTab,
  type WorkspaceTabGroup,
} from "../eventWorkspace.model";

/** Per-stage completion, derived by the caller from the command center. */
export type StageState = "done" | "current" | "todo";
export type StageStates = Partial<Record<WorkspaceTabGroup["id"], StageState>>;

/**
 * Event workspace stage stepper.
 *
 * Tabs are shown inside the office's numbered stages (العرض والعربون →
 * المضيفون → العدة → يوم المناسبة → الإقفال) with a ✓ once a stage is done.
 * Clicking a stage header opens its first tab; the tabs inside keep their
 * canonical names, role visibility and `onChange(tab)` so deep links and the
 * command center keep working unchanged.
 */
export function WorkspaceTabs({
  tab,
  tabs,
  onChange,
  stageStates = {},
}: {
  tab: WorkspaceTab;
  /** Only the tabs the current role can actually use. */
  tabs: ReadonlyArray<WorkspaceTab>;
  onChange: (tab: WorkspaceTab) => void;
  stageStates?: StageStates;
}) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = activeTabRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [tab]);

  const hasSummary = tabs.includes("ملخص");
  const buckets = groupWorkspaceTabs(tabs.filter((t) => t !== "ملخص"));

  return (
    <div role="tablist" aria-label="مراحل المناسبة" className="space-y-2">
      <div className="flex flex-wrap items-stretch gap-2">
        {hasSummary && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ملخص"}
            ref={tab === "ملخص" ? (el) => { activeTabRef.current = el; } : undefined}
            onClick={() => onChange("ملخص")}
            className={cn(
              "min-h-14 rounded-2xl border px-4 text-base font-black transition-colors",
              tab === "ملخص"
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-300",
            )}
          >
            ملخص
          </button>
        )}

        {buckets.map((bucket) => {
          const activeHere = bucket.tabs.includes(tab);
          const state = stageStates[bucket.id] ?? "todo";
          const single = bucket.tabs.length === 1;
          return (
            <div
              key={bucket.id}
              role="group"
              aria-label={bucket.label}
              className={cn(
                "flex min-h-14 flex-wrap items-center gap-1 rounded-2xl border p-1 transition-colors",
                activeHere
                  ? "border-brand-400 bg-brand-50"
                  : state === "done"
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-slate-200 bg-white",
              )}
            >
              <button
                type="button"
                role={single ? "tab" : undefined}
                aria-selected={single ? activeHere : undefined}
                ref={single && activeHere ? (el) => { activeTabRef.current = el; } : undefined}
                onClick={() => onChange(bucket.tabs[0]!)}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-black",
                  single && activeHere
                    ? "bg-brand-700 text-white"
                    : activeHere
                      ? "text-brand-900"
                      : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                    state === "done"
                      ? "bg-emerald-600 text-white"
                      : single && activeHere
                        ? "bg-white/20 text-white"
                        : activeHere
                          ? "bg-brand-700 text-white"
                          : "bg-slate-100 text-slate-600",
                  )}
                >
                  {state === "done" ? <Check className="h-4 w-4" /> : (bucket.step ?? "·")}
                </span>
                {bucket.label}
              </button>

              {!single &&
                bucket.tabs.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    ref={tab === name ? (el) => { activeTabRef.current = el; } : undefined}
                    onClick={() => onChange(name)}
                    className={cn(
                      "min-h-11 whitespace-nowrap rounded-xl px-3 text-sm font-bold transition-colors",
                      tab === name
                        ? "bg-brand-700 text-white"
                        : "text-slate-600 hover:bg-white hover:text-slate-900",
                    )}
                  >
                    {name}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
