import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { isActivePath, type NavGroup } from "./navConfig";

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
      return (
        <Link
          key={item.to}
          to={item.to}
          className={cn(
            "flex items-center rounded-xl px-3 font-bold transition-colors",
            big ? "min-h-12 py-3 text-base" : "min-h-11 py-2.5 text-sm",
            active
              ? "bg-brand-50 text-brand-800"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
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
          <details open={secondaryActive} className="group/more rounded-xl border border-slate-100">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-bold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
              المزيد
              <span className="text-xs transition-transform group-open/more:rotate-180">▼</span>
            </summary>
            <div className="space-y-4 px-1 pb-3 pt-1">
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
