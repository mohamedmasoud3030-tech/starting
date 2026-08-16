import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Home, MoreHorizontal, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isActivePath,
  MOBILE_PRIMARY_TARGETS,
  type NavGroup,
  type NavItem,
} from "./navConfig";

const MOBILE_PRIMARY_ICONS: Partial<
  Record<NavItem["to"], typeof Home | typeof CalendarDays | typeof Users>
> = {
  "/home": Home,
  "/events": CalendarDays,
  "/customers": Users,
};

/** Mobile (md-) navigation: slide-up drawer + fixed bottom quick bar. */
export function MobileNav({
  groups,
  pathname,
  orgName,
}: {
  groups: ReadonlyArray<NavGroup>;
  pathname: string;
  orgName: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleItems = groups.flatMap((group) => group.items);
  const mobilePrimary = MOBILE_PRIMARY_TARGETS.map((target) =>
    visibleItems.find((item) => item.to === target),
  ).filter((item): item is NavItem => Boolean(item));
  const primaryTargets = new Set(mobilePrimary.map((item) => item.to));
  const secondaryActive = visibleItems.some(
    (item) =>
      !primaryTargets.has(item.to) && isActivePath(pathname, item.to),
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <>
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/20 md:hidden"
          />
          <nav
            className="fixed inset-x-3 z-50 max-h-[70dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl md:hidden"
            style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
            aria-label="التنقل على الجوال"
          >
            <div className="mb-3 flex items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {orgName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="إغلاق القائمة"
                className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-slate-200 text-slate-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.label}>
                  <p className="mb-1 px-2 text-xs font-bold text-slate-400">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {group.items.map((item) => {
                      const active = isActivePath(pathname, item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex min-h-12 items-center rounded-xl px-3 py-3 text-sm font-bold",
                            active
                              ? "bg-brand-50 text-brand-800"
                              : "text-slate-700 hover:bg-slate-100",
                          )}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </nav>
        </>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-1.5 backdrop-blur md:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="التنقل السريع على الجوال"
      >
        {/*
          Column count follows the number of primary targets actually visible
          to the role (+1 for "المزيد"). It was hardcoded to 4 while only 3
          targets are configured, leaving a dead column and off-centre bar.
        */}
        <div
          className="mx-auto grid max-w-lg gap-1"
          style={{
            gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))`,
          }}
        >
          {mobilePrimary.map((item) => {
            const active = isActivePath(pathname, item.to);
            const Icon = MOBILE_PRIMARY_ICONS[item.to];
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold",
                  active ? "bg-brand-50 text-brand-800" : "text-slate-500",
                )}
              >
                {Icon && <Icon className="h-5 w-5" />}
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold",
              menuOpen || secondaryActive
                ? "bg-brand-50 text-brand-800"
                : "text-slate-500",
            )}
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>المزيد</span>
          </button>
        </div>
      </nav>
    </>
  );
}
