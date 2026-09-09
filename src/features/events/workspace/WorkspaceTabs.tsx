import { useEffect, useRef } from "react";
import { type WorkspaceTab } from "../eventWorkspace.model";

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
   * Keep the selected tab visible inside the horizontally scrolling strip.
   * Twelve peer tabs overflow every phone; without this, deep links like
   * ?tab=الفريق (fired from the command center) can land on a tab scrolled
   * off-screen, and plain tab taps leave the strip where it was.
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

  return (
    <div className="flex gap-2 overflow-x-auto border-b" role="tablist">
      {tabs.map((name) => (
        <button
          key={name}
          ref={
            tab === name
              ? (el) => {
                  activeTabRef.current = el;
                }
              : undefined
          }
          role="tab"
          aria-selected={tab === name}
          onClick={() => onChange(name)}
          className={`min-h-12 whitespace-nowrap border-b-2 px-4 text-base font-bold ${
            tab === name
              ? "border-brand-700 text-brand-800"
              : "border-transparent text-slate-500"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
