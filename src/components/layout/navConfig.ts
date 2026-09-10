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
    items: [{ to: "/home", label: "لوحة اليوم" }],
  },
  {
    label: "المناسبات",
    items: [
      { to: "/events", label: "المناسبات" },
      { to: "/calendar", label: "التقويم" },
      { to: "/operations", label: "جدول التشغيل" },
    ],
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
    label: "المخزون والتوريد",
    items: [
      { to: "/catalog", label: "دليل الخدمات والمواد" },
      { to: "/consumables", label: "مخزون المواد" },
      // Every procurement read model is hidden from non-cost roles and every
      // S5 command requires OWNER/MANAGER, so these are cost-role-only items
      // shown inside the supply group.
      { to: "/procurement", label: "الموردون وأوامر الشراء", financial: true },
      {
        to: "/procurement/restaurants",
        label: "المطاعم المتعاقدة",
        financial: true,
      },
    ],
  },
  {
    label: "الفريق",
    // The staff page is a payroll + HR surface (server-gated by payroll.read).
    // The page serves the team inside the events lifecycle (hosts are assigned,
    // attend and are settled per event) plus the per-member HR file. The label
    // keeps the operational identity first: «الفريق والموارد البشرية».
    items: [{ to: "/staff", label: "الفريق والموارد البشرية", payroll: true }],
  },
  {
    label: "الإدارة والتحليل",
    items: [
      { to: "/dashboard", label: "لوحة الإدارة", financial: true },
      { to: "/reports", label: "التقارير", financial: true },
      { to: "/accounting", label: "المحاسبة", financial: true },
      { to: "/integrity", label: "مركز السلامة", financial: true },
      { to: "/search", label: "البحث" },
    ],
  },
  {
    label: "النظام",
    items: [{ to: "/settings", label: "إعدادات المنشأة" }],
  },
];

/** The four always-visible mobile bottom-bar targets (role permitting). */
export const MOBILE_PRIMARY_TARGETS: ReadonlyArray<NavTarget> = [
  "/home",
  "/events",
  "/customers",
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
