import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { NAV_ICONS, isActivePath, type NavGroup } from "./navConfig";

/** Desktop (md+) left sidebar navigation. */
export function DesktopSidebar({
  groups,
  pathname,
}: {
  groups: ReadonlyArray<NavGroup>;
  pathname: string;
}) {
  const primary = groups.filter((g) => !g.secondary);
  const secondary = groups.filter((g) => g.secondary);
  const secondaryActive = secondary.some((g) => g.items.some((i) => isActivePath(pathname, i.to)));

  const renderItems = (group: NavGroup, big: boolean) =>
    group.items.map((item) => {
      const active = isActivePath(pathname, item.to);
      const Icon = NAV_ICONS[item.to];
      return (
        <Link
          key={item.to}
          to={item.to}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 rounded-xl px-3 font-bold transition-colors",
            big ? "min-h-12 py-3 text-base" : "min-h-10 py-2 text-sm",
            active
              ? "bg-brand-700 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {Icon && (
            <Icon
              className={cn("shrink-0", big ? "h-5 w-5" : "h-4 w-4", active ? "text-white" : "text-slate-400")}
              aria-hidden="true"
            />
          )}
          {item.label}
        </Link>
      );
    });

  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 flex-none overflow-y-auto border-l border-slate-200 bg-white px-3 py-5 md:block">
      <nav className="space-y-5" aria-label="التنقل الرئيسي">
        {/* The owner's daily path — always visible, one label per group. */}
        <div className="space-y-1">
          {primary.map((group) => (
            <div key={group.label}>{renderItems(group, true)}</div>
          ))}
        </div>

        {secondary.length > 0 && (
          <details open={secondaryActive} className="group/more border-t border-slate-100 pt-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-xl px-3 text-xs font-bold tracking-wide text-slate-400 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
              المزيد
              <span className="text-[10px] transition-transform group-open/more:rotate-180">▼</span>
            </summary>
            <div className="space-y-4 pb-3 pt-2">
              {secondary.map((group) => (
                <section key={group.label}>
                  <p className="mb-1.5 px-3 text-xs font-bold tracking-wide text-slate-400">
                    {group.label}
                  </p>
                  <div className="space-y-1">{renderItems(group, false)}</div>
                </section>
              ))}
            </div>
          </details>
        )}
      </nav>
    </aside>
  );
}
