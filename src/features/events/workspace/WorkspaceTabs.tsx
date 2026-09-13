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
 * Row 1 — one horizontally scrollable strip of equal chips: «ملخص» then the
 * office's numbered stages (العرض والعربون → المضيفون → العدة → يوم المناسبة
 * → الإقفال → السجل), each with its number or a ✓ once done.
 * Row 2 — the tabs inside the *selected* stage only (hidden when the stage
 * has a single tab). Tab names, role visibility and `onChange(tab)` are
 * unchanged so deep links and the command center keep working.
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
  const activeStageRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = activeStageRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [tab]);

  const hasSummary = tabs.includes("ملخص");
  const buckets = groupWorkspaceTabs(tabs.filter((t) => t !== "ملخص"));
  const activeBucket = buckets.find((b) => b.tabs.includes(tab));

  const chipBase =
    "flex min-h-14 min-w-[6.5rem] flex-none snap-start flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-2 text-sm font-black leading-tight transition-colors sm:min-w-[8rem] sm:text-base";

  return (
    <div className="space-y-2">
      <div
        role="tablist"
        aria-label="مراحل المناسبة"
        className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {hasSummary && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ملخص"}
            ref={tab === "ملخص" ? (el) => { activeStageRef.current = el; } : undefined}
            onClick={() => onChange("ملخص")}
            className={cn(
              chipBase,
              tab === "ملخص"
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-300",
            )}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-current/10 text-xs" aria-hidden="true">
              ☰
            </span>
            ملخص
          </button>
        )}

        {buckets.map((bucket) => {
          const activeHere = bucket.tabs.includes(tab);
          const state = stageStates[bucket.id] ?? "todo";
          return (
            <button
              key={bucket.id}
              type="button"
              role="tab"
              aria-selected={activeHere}
              aria-label={`${bucket.step ? `المرحلة ${bucket.step}: ` : ""}${bucket.label}${state === "done" ? " — مكتملة" : ""}`}
              ref={activeHere ? (el) => { activeStageRef.current = el; } : undefined}
              onClick={() => onChange(activeHere ? tab : bucket.tabs[0]!)}
              className={cn(
                chipBase,
                activeHere
                  ? "border-brand-700 bg-brand-700 text-white"
                  : state === "done"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                  activeHere
                    ? "bg-white text-brand-800"
                    : state === "done"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600",
                )}
                aria-hidden="true"
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : (bucket.step ?? "·")}
              </span>
              {bucket.label}
            </button>
          );
        })}
      </div>

      {activeBucket && activeBucket.tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={`أقسام ${activeBucket.label}`}
          className="flex flex-wrap gap-1 rounded-2xl border border-brand-200 bg-brand-50 p-1"
        >
          {activeBucket.tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => onChange(name)}
              className={cn(
                "min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-bold transition-colors",
                tab === name
                  ? "bg-brand-700 text-white"
                  : "text-brand-900 hover:bg-white",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
