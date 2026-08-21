import { groupForTab, visibleTabGroups, type WorkspaceTab } from "../eventWorkspace.model";

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
  const groups = visibleTabGroups(tabs);
  const activeGroupId = groupForTab(tab);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];

  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="أقسام المناسبة">
        {groups.map((group) => {
          const selected = group.id === activeGroupId;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                const first = group.tabs[0];
                if (first) onChange(first);
              }}
              className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold ${
                selected ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {group.label}
            </button>
          );
        })}
      </div>
      {activeGroup && activeGroup.tabs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b" role="tablist" aria-label={activeGroup.label}>
          {activeGroup.tabs.map((name) => (
            <button
              key={name}
              type="button"
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
      )}
    </div>
  );
}
