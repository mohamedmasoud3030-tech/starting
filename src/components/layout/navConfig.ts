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
  | "/integrity"
  | "/search"
  | "/settings";

export type NavItem = {
  to: NavTarget;
  label: string;
  commercial?: boolean;
  financial?: boolean;
};

export type NavGroup = {
  label: string;
  items: ReadonlyArray<NavItem>;
};

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "اليوم",
    items: [
      { to: "/home", label: "الرئيسية" },
      { to: "/events", label: "المناسبات" },
      { to: "/customers", label: "العملاء" },
      { to: "/staff", label: "الفريق", financial: true },
    ],
  },
  {
    label: "المبيعات",
    items: [{ to: "/quotes", label: "عروض الأسعار", commercial: true }],
  },
  {
    label: "المالية",
    items: [
      { to: "/reports", label: "التقارير", financial: true },
      { to: "/dashboard", label: "لوحة الإدارة", financial: true },
    ],
  },
  {
    label: "المزيد",
    items: [
      { to: "/search", label: "البحث" },
      { to: "/calendar", label: "التقويم" },
      { to: "/operations", label: "لوحة التشغيل" },
      { to: "/catalog", label: "دليل الخدمات والمواد" },
      { to: "/packages", label: "الباقات" },
      { to: "/consumables", label: "مخزون المواد" },
      { to: "/procurement", label: "الموردون وأوامر الشراء", financial: true },
      { to: "/integrity", label: "مركز السلامة", financial: true },
      { to: "/settings", label: "الإعدادات" },
    ],
  },
];

/** Daily mobile bottom-bar targets (role permitting). */
export const MOBILE_PRIMARY_TARGETS: ReadonlyArray<NavTarget> = [
  "/home",
  "/events",
  "/customers",
  "/staff",
];

export function isActivePath(pathname: string, target: NavTarget): boolean {
  return target === "/home"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);
}

/**
 * Filters the static navigation by the caller's role-derived capabilities.
 * Pure: the caller supplies `canManageCommercial` / `canReadCost`.
 */
export function visibleNavGroups(
  canManageCommercial: boolean,
  canReadCost: boolean,
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.commercial || canManageCommercial) &&
        (!item.financial || canReadCost),
    ),
  })).filter((group) => group.items.length > 0);
}
