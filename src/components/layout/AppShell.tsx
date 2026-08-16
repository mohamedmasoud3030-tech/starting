import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  Home,
  MoreHorizontal,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { cn } from "@/lib/utils";

type NavTarget =
  | "/home"
  | "/events"
  | "/quotes"
  | "/procurement"
  | "/consumables"
  | "/catalog"
  | "/packages"
  | "/customers"
  | "/staff";

type NavItem = {
  to: NavTarget;
  label: string;
  commercial?: boolean;
  financial?: boolean;
};

type NavGroup = {
  label: string;
  items: ReadonlyArray<NavItem>;
};

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "الرئيسية",
    items: [{ to: "/home", label: "لوحة المتابعة" }],
  },
  {
    label: "المناسبات",
    items: [{ to: "/events", label: "كل المناسبات" }],
  },
  {
    label: "المبيعات والعملاء",
    items: [
      { to: "/quotes", label: "عروض الأسعار", commercial: true },
      { to: "/customers", label: "العملاء" },
      { to: "/packages", label: "الباقات" },
    ],
  },
  {
    label: "التشغيل والمخزن",
    items: [
      { to: "/catalog", label: "دليل الخدمات والمواد" },
      { to: "/consumables", label: "مخزون المواد" },
    ],
  },
  {
    label: "المشتريات",
    items: [{ to: "/procurement", label: "الموردون وأوامر الشراء" }],
  },
  {
    label: "الفريق",
    items: [{ to: "/staff", label: "المضيفون والحضور", financial: true }],
  },
];

function isActivePath(pathname: string, target: NavTarget) {
  return target === "/home"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    currentOrganization,
    canManageCommercial,
    canReadCost,
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.commercial || canManageCommercial) &&
        (!item.financial || canReadCost),
    ),
  })).filter((group) => group.items.length > 0);
  const visibleItems = visibleGroups.flatMap((group) => group.items);

  const mobilePrimary = ["/home", "/events", "/customers"]
    .map((target) => visibleItems.find((item) => item.to === target))
    .filter((item): item is NavItem => Boolean(item));
  const mobilePrimaryTargets = new Set(mobilePrimary.map((item) => item.to));
  const secondaryActive = visibleItems.some(
    (item) =>
      !mobilePrimaryTargets.has(item.to) && isActivePath(pathname, item.to),
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
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white sm:h-11 sm:w-11 sm:text-lg">
              ض
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                {currentOrganization?.display_name ?? currentOrganization?.name ?? "إدارة الضيافة"}
              </p>
              <p className="hidden text-sm text-slate-500 sm:block">
                عمليات الضيافة والمناسبات
              </p>
            </div>
          </div>

          <div className="hidden rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-800 md:block">
            وضع عرض عام · صلاحيات كاملة
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px] items-start">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 flex-none overflow-y-auto border-l border-slate-200 bg-white px-3 py-5 md:block">
          <nav className="space-y-5" aria-label="التنقل الرئيسي">
            {visibleGroups.map((group) => (
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

        <main className="min-w-0 flex-1 px-3 py-4 pb-28 sm:px-4 sm:py-6 md:px-6 md:pb-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

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
                  وضع عرض عام
                </p>
                <p className="text-xs text-slate-500">صلاحيات كاملة</p>
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
              {visibleGroups.map((group) => (
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
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
          {mobilePrimary.map((item) => {
            const active = isActivePath(pathname, item.to);
            const Icon =
              item.to === "/home"
                ? Home
                : item.to === "/events"
                  ? CalendarDays
                  : Users;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold",
                  active ? "bg-brand-50 text-brand-800" : "text-slate-500",
                )}
              >
                <Icon className="h-5 w-5" />
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
    </div>
  );
}
