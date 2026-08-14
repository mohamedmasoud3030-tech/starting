import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/domain";
import { Badge } from "@/components/ui/Badge";

const NAV_ITEMS = [
  { to: "/home", label: "الرئيسية" },
  { to: "/events", label: "المناسبات" },
  { to: "/catalog", label: "الكتالوج" },
  { to: "/packages", label: "الباقات" },
  { to: "/customers", label: "العملاء" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, currentOrganization, currentRole, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const fullName =
    profile?.full_name || user?.email?.split("@")[0] || "مستخدم";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-lg font-bold text-white">
              ض
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-slate-900">
                {currentOrganization?.name ?? "إدارة الضيافة"}
              </p>
              <p className="text-sm text-slate-500">عمليات الضيافة والمناسبات</p>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.to;
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
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>

            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="القائمة"
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 text-slate-700 md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav
            className="border-t border-slate-200 bg-white px-4 py-3 md:hidden"
            aria-label="التنقل على الجوال"
          >
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "block rounded-xl px-4 py-3 text-base font-bold",
                    active
                      ? "bg-brand-50 text-brand-800"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={() => void logout()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-5 w-5" />
              تسجيل الخروج
            </button>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
