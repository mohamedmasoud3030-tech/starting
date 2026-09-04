import type {
  AppRole,
  CatalogItemType,
  CustomerType,
  PricingMethod,
} from "./dbTypes";

/** Arabic labels for catalog item types. */
export const ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  SERVICE: "خدمة",
  REUSABLE_EQUIPMENT: "معدات قابلة لإعادة الاستخدام",
  CONSUMABLE: "مواد استهلاكية",
  STAFF: "طاقم عمل",
  CATERING: "تموين / طعام",
  TRANSPORT: "نقل",
  ADDON: "إضافة",
  OTHER: "أخرى",
};

/** Arabic labels for pricing methods. */
export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  FIXED: "سعر ثابت",
  PER_EVENT: "لكل مناسبة",
  PER_GUEST: "لكل ضيف",
  PER_UNIT: "لكل وحدة",
  PER_HOUR: "لكل ساعة",
  PER_DAY: "لكل يوم",
  MANUAL: "يدوي (يُحدد عند العرض)",
};

/** Common units (display labels only). */
export const UNIT_OPTIONS = [
  "قطعة",
  "مجموعة",
  "ضيف",
  "ساعة",
  "يوم",
  "مناسبة",
  "كجم",
  "لتر",
  "كرتون",
  "صندوق",
] as const;

/** Arabic labels for app roles. */
export const ROLE_LABELS: Record<AppRole, string> = {
  OWNER: "المالك",
  MANAGER: "المدير",
  SUPERVISOR: "المشرف",
  WAREHOUSE: "المخزن",
  ACCOUNTANT: "المحاسب",
};

/** Arabic labels for customer types. */
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: "فرد",
  COMPANY: "شركة",
  GOVERNMENT: "جهة حكومية",
};

/**
 * Loading-only fallback presets (0079): each array mirrors the server's
 * `role_default_capability` for the named capability, so the UI before the
 * server capability report arrives matches what the database will grant
 * members without owner overrides. They are NOT the authorization — the
 * server capability report is.
 */

/** Role preset for `quotation.manage`. */
export const COMMERCIAL_ROLES: AppRole[] = ["OWNER", "MANAGER"];

/** Role preset for `cost.visibility`. */
export const COST_READER_ROLES: AppRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];

/** Role preset for `customer.manage`. */
export const CUSTOMER_WRITE_ROLES: AppRole[] = ["OWNER", "MANAGER", "SUPERVISOR"];

/** Role preset for `payroll.read` — the payroll read surfaces. */
export const PAYROLL_READ_ROLES: AppRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];

/** Role preset for `payroll.pay` — recording/voiding payouts and advances. */
export const PAYROLL_PAY_ROLES: AppRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];

/** Role preset for `staff.manage` — the staff roster. */
export const STAFF_MANAGE_ROLES: AppRole[] = ["OWNER", "MANAGER"];

/**
 * Roles that may assign / release event staff. The server gate
 * (`assign_event_staff` / `release_staff_assignment`, migration 0015) is a
 * direct `has_org_role(OWNER, MANAGER, SUPERVISOR)` check — deliberately left
 * role-based by 0079, so the UI mirrors the role set rather than a capability
 * the backend does not consult here.
 */
export const STAFF_ASSIGN_ROLES: AppRole[] = ["OWNER", "MANAGER", "SUPERVISOR"];
