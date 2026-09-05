export type NavTarget =
  | "/home"
  | "/dashboard"
  | "/events"
  | "/calendar"
  | "/operations"
  | "/quotes"
  | "/procurement"
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

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "الرئيسية",
    items: [
      { to: "/home", label: "لوحة المتابعة" },
      { to: "/dashboard", label: "لوحة الإدارة", financial: true },
      { to: "/search", label: "البحث" },
    ],
  },
  {
    label: "المناسبات",
    items: [
      { to: "/events", label: "كل المناسبات" },
      { to: "/calendar", label: "التقويم" },
      { to: "/operations", label: "لوحة التشغيل" },
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
    label: "التشغيل والمخزن",
    items: [
      { to: "/catalog", label: "دليل الخدمات والمواد" },
      { to: "/consumables", label: "مخزون المواد" },
    ],
  },
  {
    label: "المشتريات",
    items: [
      // Every procurement read model is hidden from non-cost roles and every
      // S5 command requires OWNER/MANAGER, so this surface is cost-role-only.
      { to: "/procurement", label: "الموردون وأوامر الشراء", financial: true },
    ],
  },
  {
    label: "الفريق",
    // The staff page is a payroll surface (server-gated by payroll.read).
    items: [{ to: "/staff", label: "المضيفون والحضور", payroll: true }],
  },
  {
    label: "الإدارة والتحليل",
    items: [
      { to: "/reports", label: "التقارير", financial: true },
      { to: "/accounting", label: "المحاسبة", financial: true },
      { to: "/integrity", label: "مركز السلامة", financial: true },
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

export function isActivePath(pathname: string, target: NavTarget): boolean {
  return target === "/home"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);
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
