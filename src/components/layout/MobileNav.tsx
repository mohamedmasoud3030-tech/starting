import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/app/authContext";
import { cn } from "@/lib/utils";
import {
  isActivePath,
  MOBILE_PRIMARY_TARGETS,
  type NavGroup,
  type NavItem,
} from "./navConfig";

/** Short labels for the bottom bar — full labels stay in the drawer/sidebar. */
const MOBILE_SHORT_LABELS: Partial<Record<NavItem["to"], string>> = {
  "/home": "اليوم",
  "/events": "المناسبات",
  "/customers": "العملاء",
  "/staff": "المضيفون",
  "/accounting": "الفلوس",
};

const NAV_ICONS: Partial<Record<NavItem["to"], typeof Home>> = {
  "/calendar": CalendarRange,
  "/packages": Package,
  "/quotes": FileText,
  "/catalog": Boxes,
  "/consumables": Warehouse,
  "/procurement": Truck,
  "/procurement/restaurants": Store,
  "/operations": ClipboardList,
  "/dashboard": LayoutDashboard,
  "/reports": BarChart3,
  "/integrity": ShieldCheck,
  "/search": Search,
  "/settings": Settings,
  "/customers": Users,
};

const MOBILE_PRIMARY_ICONS: Partial<Record<NavItem["to"], typeof Home>> = {
  "/home": Home,
  "/events": CalendarDays,
  "/customers": Users,
  "/staff": UserCheck,
  "/accounting": Wallet,
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
  const { logout } = useAuth();
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
            style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
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
              {groups.map((group) => {
                const items = group.items.filter((item) => !primaryTargets.has(item.to));
                if (!items.length) return null;
                return (
                  <section key={group.label}>
                    <p className="mb-1 px-2 text-xs font-bold text-slate-400">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {items.map((item) => {
                        const active = isActivePath(pathname, item.to);
                        const Icon = NAV_ICONS[item.to];
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            className={cn(
                              "flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold",
                              active
                                ? "bg-brand-50 text-brand-800"
                                : "text-slate-700 hover:bg-slate-100",
                            )}
                          >
                            {Icon && (
                              <Icon
                                className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand-700" : "text-slate-400")}
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
                className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-bold text-red-700 hover:bg-red-100"
              >
                <LogOut className="h-[18px] w-[18px]" />
                <span>تسجيل الخروج</span>
              </button>
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
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-bold",
                  active ? "bg-brand-50 text-brand-800" : "text-slate-500",
                )}
              >
                {Icon && <Icon className="h-5 w-5" />}
                <span>{MOBILE_SHORT_LABELS[item.to] ?? item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-bold",
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
