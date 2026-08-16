export type NavTarget =
  | "/home"
  | "/events"
  | "/quotes"
  | "/procurement"
  | "/consumables"
  | "/catalog"
  | "/packages"
  | "/customers"
  | "/staff";

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
