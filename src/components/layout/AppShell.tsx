import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileNav } from "./MobileNav";
import { OfflineBanner } from "./OfflineBanner";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { visibleNavGroups } from "./navConfig";

export function AppShell({ children }: { children: ReactNode }) {
  const {
    currentOrganization,
    canManageCommercial,
    canIssueQuotation,
    canReadCost,
    canReadPayroll,
    logout,
  } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const orgName =
    currentOrganization?.display_name ??
    currentOrganization?.name ??
    "إدارة الضيافة";
  const groups = visibleNavGroups(
    canManageCommercial,
    canIssueQuotation,
    canReadCost,
    canReadPayroll,
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-700 focus:px-4 focus:py-3 focus:text-base focus:font-bold focus:text-white"
      >
        تجاوز إلى المحتوى
      </a>
      <OfflineBanner />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white sm:h-11 sm:w-11 sm:text-lg">
              ض
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                {orgName}
              </p>
              <p className="hidden text-sm text-slate-500 sm:block">
                عمليات الضيافة والمناسبات
              </p>
            </div>
          </div>

          {/* Multi-organization users only; renders nothing for a single org. */}
          <div className="ms-auto flex items-center gap-2">
            <OrganizationSwitcher />
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="تسجيل الخروج"
              title="تسجيل الخروج"
              className="flex h-11 flex-none items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="h-5 w-5" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px] items-start">
        <DesktopSidebar groups={groups} pathname={pathname} />

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-3 py-4 pb-28 outline-none sm:px-4 sm:py-6 md:px-6 md:pb-6 lg:px-8"
        >
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      <MobileNav groups={groups} pathname={pathname} orgName={orgName} />
    </div>
  );
}
