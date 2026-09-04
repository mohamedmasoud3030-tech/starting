import type { AppRole } from "@/lib/dbTypes";

/**
 * Delegated business capabilities (migration 0079).
 *
 * The AUTHORITY is the database: `public.has_permission(org, cap)` (role
 * preset via `role_default_capability` + OWNER-set overrides in
 * `org_member_permissions`) is what every RPC/RLS gate checks. These
 * constants exist so the UI can render capability labels and compute a
 * LOADING-ONLY fallback before the authoritative `my_capabilities` report
 * arrives — the server report always wins once loaded.
 *
 * KEEP IN SYNC with `known_capabilities()` in
 * supabase/migrations/20260904000000_0079_owner_delegated_permissions.sql.
 */
export const CAPABILITIES = [
  "customer.manage",
  "quotation.manage",
  "quotation.issue",
  "event.manage",
  "catalog.manage",
  "warehouse.dispatch",
  "warehouse.reconcile",
  "consumable.manage",
  "stock.adjust",
  "attendance.record",
  "procurement.manage",
  "staff.manage",
  "payment.record",
  "payment.void",
  "invoice.manage",
  "finance.manage",
  "cost.visibility",
  "payroll.read",
  "payroll.pay",
  "settings.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Arabic labels for the permission grid and team surface. */
export const CAPABILITY_LABELS_AR: Record<Capability, string> = {
  "customer.manage": "العملاء",
  "quotation.manage": "إدارة عروض الأسعار",
  "quotation.issue": "إصدار عروض الأسعار",
  "event.manage": "إدارة المناسبات",
  "catalog.manage": "الكتالوج والباقات",
  "warehouse.dispatch": "تجهيز المخزن والإرسال",
  "warehouse.reconcile": "تسوية المخزن",
  "consumable.manage": "المستلزمات الاستهلاكية",
  "stock.adjust": "تعديل الأرصدة",
  "attendance.record": "تسجيل الحضور",
  "procurement.manage": "المشتريات",
  "staff.manage": "الفريق والموظفون",
  "payment.record": "تسجيل المدفوعات",
  "payment.void": "إلغاء المدفوعات",
  "invoice.manage": "الفواتير",
  "finance.manage": "العمليات المالية",
  "cost.visibility": "رؤية التكاليف",
  "payroll.read": "قراءة الرواتب",
  "payroll.pay": "دفع الرواتب",
  "settings.manage": "إعدادات المنشأة",
};

/**
 * Mirror of `role_default_capability` (0079): what each preset role grants
 * BEFORE any owner override. Used only for (a) the permission grid's
 * "by role" column and (b) the pre-load UI fallback. The server is the
 * source of truth; never trust this map for authorization.
 */
export const ROLE_DEFAULT_CAPABILITIES: Record<AppRole, Capability[]> = {
  OWNER: [...CAPABILITIES],
  MANAGER: CAPABILITIES.filter((c) => c !== "settings.manage"),
  SUPERVISOR: [
    "customer.manage",
    "event.manage",
    "warehouse.dispatch",
    "consumable.manage",
    "attendance.record",
  ],
  WAREHOUSE: ["warehouse.dispatch", "consumable.manage"],
  ACCOUNTANT: [
    "payment.record",
    "payment.void",
    "invoice.manage",
    "finance.manage",
    "cost.visibility",
    "payroll.read",
    "payroll.pay",
  ],
};

/**
 * Roles an owner may invite (mirrors the CHECK constraint on
 * `org_invitations.role`: OWNER can only ever exist via founding an org).
 */
export const INVITABLE_ROLES: AppRole[] = [
  "MANAGER",
  "SUPERVISOR",
  "WAREHOUSE",
  "ACCOUNTANT",
];

export const APP_ROLE_LABELS_AR: Record<AppRole, string> = {
  OWNER: "المالك",
  MANAGER: "مدير",
  SUPERVISOR: "مشرف",
  WAREHOUSE: "مخزن",
  ACCOUNTANT: "محاسب",
};
