import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  groupWorkspaceTabs,
  type WorkspaceTab,
} from "../eventWorkspace.model";

/**
 * Event workspace tab selector.
 *
 * The workspace's 13 tabs were a single long peer wall — hard for the owner
 * persona to scan. This renders them as a small set of labeled buckets
 * (summary pinned first, then التشغيل والتحضير / المالية / السجل) purely for
 * orientation. Every tab keeps its canonical Arabic name, its role visibility
 * (the caller passes the already-filtered `tabs`) and its `onChange(tab)`, so
 * the workspace, deep links (?tab=…) and the command center all keep working
 * unchanged.
 */
export function WorkspaceTabs({
  tab,
  tabs,
  onChange,
}: {
  tab: WorkspaceTab;
  /** Only the tabs the current role can actually use. */
  tabs: ReadonlyArray<WorkspaceTab>;
  onChange: (tab: WorkspaceTab) => void;
}) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Keep the selected tab visible when the layout wraps; without this, deep
   * links like ?tab=الفريق (fired from the command center) could land on a
   * tab scrolled/wrapped out of the visible area.
   */
  useEffect(() => {
    const el = activeTabRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [tab]);

  const hasSummary = tabs.includes("ملخص");
  const buckets = groupWorkspaceTabs(tabs.filter((t) => t !== "ملخص"));

  return (
    <div
      role="tablist"
      aria-label="أقسام مركز المناسبة"
      className="flex flex-wrap items-center gap-2"
    >
      {hasSummary && (
        <TabButton
          name="ملخص"
          active={tab === "ملخص"}
          onSelect={() => onChange("ملخص")}
          setActiveRef={tab === "ملخص" ? (el) => (activeTabRef.current = el) : undefined}
        />
      )}

      {buckets.map((bucket) => (
        <div
          key={bucket.id}
          role="group"
          aria-label={bucket.label}
          className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-50 px-1.5 py-1"
        >
          <span className="px-1.5 text-xs font-bold tracking-wide text-slate-400">
            {bucket.label}
          </span>
          {bucket.tabs.map((name) => (
            <TabButton
              key={name}
              name={name}
              active={tab === name}
              onSelect={() => onChange(name)}
              setActiveRef={tab === name ? (el) => (activeTabRef.current = el) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TabButton({
  name,
  active,
  onSelect,
  setActiveRef,
}: {
  name: string;
  active: boolean;
  onSelect: () => void;
  setActiveRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={setActiveRef}
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "min-h-11 whitespace-nowrap rounded-xl px-3 text-sm font-bold transition-colors",
        active
          ? "bg-brand-700 text-white"
          : "text-slate-600 hover:bg-white hover:text-slate-900",
      )}
    >
      {name}
    </button>
  );
}
