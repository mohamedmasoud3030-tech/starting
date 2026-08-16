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
  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 flex-none overflow-y-auto border-l border-slate-200 bg-white px-3 py-5 md:block">
      <nav className="space-y-5" aria-label="التنقل الرئيسي">
        {groups.map((group) => (
          <section key={group.label}>
            <p className="mb-1.5 px-3 text-xs font-bold tracking-wide text-slate-400">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-bold transition-colors",
                      active
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
