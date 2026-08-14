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

/** Roles permitted to manage commercial configuration (catalog & packages). */
export const COMMERCIAL_ROLES: AppRole[] = ["OWNER", "MANAGER"];

/** Roles permitted to READ sensitive commercial cost data (cost/internal notes). */
export const COST_READER_ROLES: AppRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];

/** Roles permitted to write customers (create/update/delete). */
export const CUSTOMER_WRITE_ROLES: AppRole[] = ["OWNER", "MANAGER", "SUPERVISOR"];
