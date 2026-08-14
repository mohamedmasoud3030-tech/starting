export type AppRole =
  | "OWNER"
  | "MANAGER"
  | "SUPERVISOR"
  | "WAREHOUSE"
  | "ACCOUNTANT";

export type CatalogItemType =
  | "SERVICE"
  | "REUSABLE_EQUIPMENT"
  | "CONSUMABLE"
  | "STAFF"
  | "CATERING"
  | "TRANSPORT"
  | "ADDON"
  | "OTHER";

export type PricingMethod =
  | "FIXED"
  | "PER_EVENT"
  | "PER_GUEST"
  | "PER_UNIT"
  | "PER_HOUR"
  | "PER_DAY"
  | "MANUAL";

export type CustomerType = "INDIVIDUAL" | "COMPANY" | "GOVERNMENT";

export type LifecycleStatus = "ACTIVE" | "INACTIVE";

export type EventType =
  | "WEDDING"
  | "FUNERAL"
  | "MAJLIS"
  | "MEETING"
  | "IFTAR"
  | "LUNCH"
  | "DINNER"
  | "CORPORATE"
  | "OTHER";

export type EventStatus =
  | "DRAFT"
  | "QUOTED"
  | "CONFIRMED"
  | "PREPARING"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "RETURNING"
  | "CLOSED"
  | "CANCELLED";

export type QuotationStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "REJECTED"
  | "SUPERSEDED";

export type StaffType =
  | "HOST"
  | "HOSTESS"
  | "SUPERVISOR"
  | "DRIVER"
  | "WAREHOUSE"
  | "OTHER";

export type CompensationMethod = "PER_EVENT" | "PER_HOUR" | "PER_DAY" | "MANUAL";

export type AssignmentStatus = "ASSIGNED" | "RELEASED" | "CANCELLED";

export type ReservationStatus = "ACTIVE" | "RELEASED" | "CANCELLED";

export type ReadinessState =
  | "READY"
  | "PRICING_MISSING"
  | "STAFF_MISSING"
  | "EQUIPMENT_SHORTAGE"
  | "MULTIPLE_ISSUES"
  | "NOT_CONFIRMED";

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

export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  FIXED: "سعر ثابت",
  PER_EVENT: "لكل مناسبة",
  PER_GUEST: "لكل ضيف",
  PER_UNIT: "لكل وحدة",
  PER_HOUR: "لكل ساعة",
  PER_DAY: "لكل يوم",
  MANUAL: "يدوي",
};

export const PRICING_METHOD_HELP: Record<PricingMethod, string> = {
  FIXED: "سعر واحد للمناسبة، لا يتأثر بالكمية",
  PER_EVENT: "سعر الوحدة × الكمية (عادةً 1)",
  PER_GUEST: "سعر الوحدة × عدد الضيوف × الكمية",
  PER_UNIT: "سعر الوحدة × الكمية",
  PER_HOUR: "سعر الساعة × عدد الساعات",
  PER_DAY: "سعر اليوم × عدد الأيام",
  MANUAL: "سعر الوحدة × الكمية يُحدد يدوياً",
};

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

export const ROLE_LABELS: Record<AppRole, string> = {
  OWNER: "المالك",
  MANAGER: "المدير",
  SUPERVISOR: "المشرف",
  WAREHOUSE: "المخزن",
  ACCOUNTANT: "المحاسب",
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: "فرد",
  COMPANY: "شركة",
  GOVERNMENT: "جهة حكومية",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WEDDING: "عرس",
  FUNERAL: "عزاء",
  MAJLIS: "مجلس",
  MEETING: "اجتماع",
  IFTAR: "إفطار",
  LUNCH: "غداء",
  DINNER: "عشاء",
  CORPORATE: "فعالية شركات",
  OTHER: "أخرى",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "مسودة",
  QUOTED: "عُرض سعر",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التحضير",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "قائمة الآن",
  RETURNING: "في طريق العودة",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "مسودة",
  ISSUED: "صادر",
  ACCEPTED: "مقبول",
  REJECTED: "مرفوض",
  SUPERSEDED: "استُبدل",
};

export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  HOST: "مضيف",
  HOSTESS: "مضيفة",
  SUPERVISOR: "مشرف",
  DRIVER: "سائق",
  WAREHOUSE: "عامل مخزن",
  OTHER: "أخرى",
};

export const COMPENSATION_LABELS: Record<CompensationMethod, string> = {
  PER_EVENT: "لكل مناسبة",
  PER_HOUR: "لكل ساعة",
  PER_DAY: "لكل يوم",
  MANUAL: "يدوي",
};

export const READINESS_LABELS: Record<ReadinessState, string> = {
  READY: "المناسبة جاهزة",
  PRICING_MISSING: "ينقص عرض سعر مقبول",
  STAFF_MISSING: "ينقص طاقم",
  EQUIPMENT_SHORTAGE: "نقص في المعدات",
  MULTIPLE_ISSUES: "عدة نواقص",
  NOT_CONFIRMED: "لم تُؤكد بعد",
};

export const COMMERCIAL_ROLES: AppRole[] = ["OWNER", "MANAGER"];
export const COST_READER_ROLES: AppRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
export const CUSTOMER_WRITE_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "SUPERVISOR",
];
export const EVENT_WRITE_ROLES: AppRole[] = ["OWNER", "MANAGER", "SUPERVISOR"];
export const EVENT_CANCEL_ROLES: AppRole[] = ["OWNER", "MANAGER"];
export const STAFF_DIRECTORY_ROLES: AppRole[] = ["OWNER", "MANAGER"];
export const STAFF_ASSIGN_ROLES: AppRole[] = ["OWNER", "MANAGER", "SUPERVISOR"];
export const EQUIPMENT_CAPACITY_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "WAREHOUSE",
];
export const EQUIPMENT_RESERVE_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "SUPERVISOR",
  "WAREHOUSE",
];

export function canManageCommercialFor(role: AppRole | null): boolean {
  return role !== null && COMMERCIAL_ROLES.includes(role);
}
export function canReadCostFor(role: AppRole | null): boolean {
  return role !== null && COST_READER_ROLES.includes(role);
}
export function canWriteCustomersFor(role: AppRole | null): boolean {
  return role !== null && CUSTOMER_WRITE_ROLES.includes(role);
}
export function canWriteEventsFor(role: AppRole | null): boolean {
  return role !== null && EVENT_WRITE_ROLES.includes(role);
}
export function canCancelEventsFor(role: AppRole | null): boolean {
  return role !== null && EVENT_CANCEL_ROLES.includes(role);
}
export function canManageStaffDirectoryFor(role: AppRole | null): boolean {
  return role !== null && STAFF_DIRECTORY_ROLES.includes(role);
}
export function canAssignStaffFor(role: AppRole | null): boolean {
  return role !== null && STAFF_ASSIGN_ROLES.includes(role);
}
export function canManageEquipmentCapacityFor(role: AppRole | null): boolean {
  return role !== null && EQUIPMENT_CAPACITY_ROLES.includes(role);
}
export function canReserveEquipmentFor(role: AppRole | null): boolean {
  return role !== null && EQUIPMENT_RESERVE_ROLES.includes(role);
}

/** Forward operational transitions. Cancellation is separate. */
export const ALLOWED_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["QUOTED"],
  QUOTED: ["CONFIRMED"],
  CONFIRMED: ["PREPARING"],
  PREPARING: ["DISPATCHED"],
  DISPATCHED: ["IN_PROGRESS"],
  IN_PROGRESS: ["RETURNING"],
  RETURNING: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export const CANCELLABLE_STATUSES: EventStatus[] = [
  "DRAFT",
  "QUOTED",
  "CONFIRMED",
  "PREPARING",
];

export function nextOperationalStatus(
  status: EventStatus,
): EventStatus | null {
  const next = ALLOWED_TRANSITIONS[status];
  return next[0] ?? null;
}
