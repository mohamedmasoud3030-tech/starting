import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/domain";
import { Badge } from "@/components/ui/Badge";

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

const NAV_ITEMS: ReadonlyArray<{
  to: NavTarget;
  label: string;
  commercial?: boolean;
  financial?: boolean;
}> = [
  { to: "/home", label: "الرئيسية" },
  { to: "/events", label: "المناسبات" },
  { to: "/quotes", label: "عروض الأسعار", commercial: true },
  { to: "/procurement", label: "المشتريات" },
  { to: "/consumables", label: "المواد الاستهلاكية" },
  { to: "/catalog", label: "الكتالوج" },
  { to: "/packages", label: "الباقات" },
  { to: "/customers", label: "العملاء" },
  { to: "/staff", label: "المضيفون", financial: true },
];

function isActivePath(pathname: string, target: NavTarget) {
  return target === "/home"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
    profile,
    currentOrganization,
    currentRole,
    logout,
    canManageCommercial,
    canReadCost,
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const fullName = profile?.full_name || user?.email?.split("@")[0] || "مستخدم";
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (!item.commercial || canManageCommercial) &&
      (!item.financial || canReadCost),
  );
  const mobilePrimary = ["/home", "/events", "/customers"]
    .map((target) => visibleItems.find((item) => item.to === target))
    .filter((item): item is (typeof visibleItems)[number] => Boolean(item));

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white sm:h-11 sm:w-11 sm:text-lg">
              ض
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                {currentOrganization?.name ?? "إدارة الضيافة"}
              </p>
              <p className="hidden text-sm text-slate-500 sm:block">
                عمليات الضيافة والمناسبات
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
            {visibleItems.map((item) => {
              const active = isActivePath(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "rounded-xl px-4 py-2.5 text-base font-bold transition-colors",
                    active
                      ? "bg-brand-50 text-brand-800"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 py-1 pr-3 pl-1 md:flex">
              <div className="leading-tight">
                <p className="text-sm font-bold text-slate-800">{fullName}</p>
                {currentRole && (
                  <Badge tone="brand" className="text-xs">
                    {ROLE_LABELS[currentRole]}
                  </Badge>
                )}
              </div>
              <button
                onClick={() => void logout()}
                aria-label="تسجيل الخروج"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>

            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
              aria-expanded={menuOpen}
              className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-slate-700 md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/20 md:hidden"
          />
          <nav
            className="fixed inset-x-3 z-50 max-h-[65dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl md:hidden"
            style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
            aria-label="التنقل على الجوال"
          >
            <div className="mb-2 flex items-center justify-between px-2 py-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{fullName}</p>
                {currentRole && (
                  <p className="text-xs text-slate-500">{ROLE_LABELS[currentRole]}</p>
                )}
              </div>
              <span className="text-xs font-bold text-slate-400">كل الأقسام</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {visibleItems.map((item) => {
                const active = isActivePath(pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
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
            <button
              onClick={() => void logout()}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-5 w-5" />
              تسجيل الخروج
            </button>
          </nav>
        </>
      )}

      <main className="mx-auto max-w-6xl px-3 py-4 pb-28 sm:px-4 sm:py-6 md:pb-6">
        {children}
      </main>

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
                onClick={() => setMenuOpen(false)}
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
              menuOpen ? "bg-brand-50 text-brand-800" : "text-slate-500",
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
