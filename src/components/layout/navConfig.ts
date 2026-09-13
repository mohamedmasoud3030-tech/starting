export type NavTarget =
  | "/home"
  | "/dashboard"
  | "/events"
  | "/calendar"
  | "/operations"
  | "/quotes"
  | "/procurement"
  | "/procurement/restaurants"
  | "/consumables"
  | "/catalog"
  | "/packages"
  | "/customers"
  | "/staff"
  | "/reports"
  | "/accounting"
  | "/integrity"
  | "/search"
  | "/settings";

export type NavItem = {
  to: NavTarget;
  label: string;
  /** Requires quotation.manage or quotation.issue (commercial workflow). */
  commercial?: boolean;
  /** Requires cost.visibility (financial figures). */
  financial?: boolean;
  /** Requires payroll.read (the staff/payroll surface). */
  payroll?: boolean;
};

export type NavGroup = {
  label: string;
  items: ReadonlyArray<NavItem>;
  /**
   * Secondary groups are collapsed under «المزيد» by default. The owner's
   * daily path (today / events / customers / team / money) stays in view;
   * expert screens remain one tap away without competing for attention.
   */
  secondary?: boolean;
};

/**
 * Primary navigation, ordered for the office owner's mental model and grouped
 * to avoid page clutter:
 *
 * 1. اليوم            — the daily landing alone, so it is never lost among
 *                       management screens.
 * 2. المناسبات         — the operational core (browse / schedule / operations).
 * 3. المبيعات والعملاء  — sales pipeline and contacts.
 * 4. المخزون والتوريد   — what the office stocks and buys (catalog, stock,
 *                       suppliers/orders, contracted restaurants).
 * 5. الفريق            — team & HR.
 * 6. الإدارة والتحليل   — management/financial dashboards, reports and search.
 * 7. النظام           — organization settings.
 *
 * The "لوحة" naming clash (المتابعة/الإدارة/التشغيل) was removed so a 50+
 * operator can tell the daily landing (اليوم) from the management dashboard
 * (لوحة الإدارة) at a glance. Every target and capability flag is unchanged —
 * only labels and grouping differ, so active-state detection, mobile primaries
 * and role filtering all keep working.
 */
export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "اليوم",
    items: [{ to: "/home", label: "اليوم" }],
  },
  {
    label: "المناسبات",
    items: [
      { to: "/events", label: "المناسبات" },
      { to: "/calendar", label: "التقويم" },
    ],
  },
  {
    label: "العملاء",
    items: [{ to: "/customers", label: "العملاء" }],
  },
  {
    label: "الفريق",
    // The staff page is a payroll + HR surface (server-gated by payroll.read):
    // hosts, attendance, advances and payouts.
    items: [{ to: "/staff", label: "المضيفون والحضور", payroll: true }],
  },
  {
    label: "الفلوس",
    items: [{ to: "/accounting", label: "الفلوس والمستحقات", financial: true }],
  },
  // ------------------------------------------------------------ «المزيد»
  {
    label: "العروض والعدة",
    secondary: true,
    items: [
      { to: "/packages", label: "العروض الستة" },
      { to: "/quotes", label: "عروض أسعار مخصصة", commercial: true },
      { to: "/catalog", label: "دليل العدة والمواد" },
      { to: "/consumables", label: "المخزن" },
      // Every procurement read model is hidden from non-cost roles and every
      // S5 command requires OWNER/MANAGER, so these are cost-role-only items.
      { to: "/procurement", label: "الموردون والشراء", financial: true },
      { to: "/procurement/restaurants", label: "المطاعم المتعاقدة", financial: true },
    ],
  },
  {
    label: "الإدارة",
    secondary: true,
    items: [
      { to: "/operations", label: "جدول التشغيل" },
      { to: "/dashboard", label: "لوحة الإدارة", financial: true },
      { to: "/reports", label: "التقارير", financial: true },
      { to: "/integrity", label: "مركز السلامة", financial: true },
      { to: "/search", label: "البحث" },
      { to: "/settings", label: "الإعدادات" },
    ],
  },
];

/** The four always-visible mobile bottom-bar targets (role permitting). */
export const MOBILE_PRIMARY_TARGETS: ReadonlyArray<NavTarget> = [
  "/home",
  "/events",
  "/staff",
  "/accounting",
];

/** All navigation targets (flat) — used to resolve nested active states. */
const ALL_NAV_TARGETS: ReadonlyArray<NavTarget> = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.to),
);

/**
 * True when this target should read as the active page. When the app lives on
 * a child page that is itself in the navigation (e.g. /procurement/restaurants
 * under /procurement), only the deepest matching item lights up.
 */
export function isActivePath(pathname: string, target: NavTarget): boolean {
  const matchesExactly = pathname === target;
  const matchesDeeperTarget = ALL_NAV_TARGETS.some(
    (other) =>
      other !== target &&
      other.startsWith(`${target}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
  if (matchesDeeperTarget) return matchesExactly;
  return target === "/home" ? matchesExactly : matchesExactly || pathname.startsWith(`${target}/`);
}

/**
 * Filters the static navigation by the caller's effective capabilities.
 * Pure: the caller supplies the capability-backed booleans from `useAuth`.
 * Hiding a nav item is presentation only — the server stays authoritative.
 */
export function visibleNavGroups(
  canManageCommercial: boolean,
  canIssueQuotation: boolean,
  canReadCost: boolean,
  canReadPayroll: boolean,
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.commercial || canManageCommercial || canIssueQuotation) &&
        (!item.financial || canReadCost) &&
        (!item.payroll || canReadPayroll),
    ),
  })).filter((group) => group.items.length > 0);
}

import {
  BarChart3,
  Boxes,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Home,
  Package,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  UserCheck,
  Users,
  Utensils,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/** One icon per destination, shared by the desktop sidebar and the mobile bars. */
export const NAV_ICONS: Partial<Record<NavTarget, LucideIcon>> = {
  "/home": Home,
  "/events": CalendarDays,
  "/calendar": CalendarRange,
  "/customers": Users,
  "/staff": UserCheck,
  "/accounting": Wallet,
  "/packages": Package,
  "/quotes": Tags,
  "/catalog": Boxes,
  "/consumables": Warehouse,
  "/procurement": ShoppingCart,
  "/procurement/restaurants": Utensils,
  "/operations": ClipboardList,
  "/dashboard": BarChart3,
  "/reports": FileText,
  "/integrity": ShieldCheck,
  "/search": Search,
  "/settings": Settings,
};
