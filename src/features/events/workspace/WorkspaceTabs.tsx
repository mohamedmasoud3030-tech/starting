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
  return (
    <div className="flex gap-2 overflow-x-auto border-b" role="tablist">
      {tabs.map((name) => (
        <button
          key={name}
          role="tab"
          aria-selected={tab === name}
          onClick={() => onChange(name)}
          className={`min-h-12 whitespace-nowrap border-b-2 px-4 font-bold ${
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
