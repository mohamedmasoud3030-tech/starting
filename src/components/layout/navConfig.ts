export type NavTarget =
  | "/home"
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
    label: "الرئيسية",
    items: [{ to: "/home", label: "لوحة المتابعة" }],
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
    items: [{ to: "/staff", label: "المضيفون والحضور", financial: true }],
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
