export type ErrorCode =
  | "UNAUTHORIZED"
  | "CROSS_ORG"
  | "INACTIVE_ORGANIZATION"
  | "INACTIVE_MEMBERSHIP"
  | "INACTIVE_CUSTOMER"
  | "INACTIVE_STAFF"
  | "INACTIVE_EQUIPMENT"
  | "INVALID_TIME"
  | "INVALID_GUESTS"
  | "INVALID_QUANTITY"
  | "INVALID_EVENT_TRANSITION"
  | "EVENT_CLOSED"
  | "EVENT_CANCELLED"
  | "EVENT_NOT_EDITABLE"
  | "QUOTE_IMMUTABLE"
  | "QUOTE_NOT_ISSUED"
  | "QUOTE_ALREADY_ACCEPTED"
  | "PRICING_LOCKED"
  | "STAFF_CONFLICT"
  | "EQUIPMENT_SHORTAGE"
  | "NOT_FOUND"
  | "VALIDATION"
  | "IDEMPOTENT_REPLAY";

const ARABIC: Record<ErrorCode, string> = {
  UNAUTHORIZED: "ليست لديك صلاحية لهذه العملية",
  CROSS_ORG: "لا يمكن الوصول إلى بيانات منظمة أخرى",
  INACTIVE_ORGANIZATION: "المنظمة غير نشطة",
  INACTIVE_MEMBERSHIP: "عضويتك غير نشطة",
  INACTIVE_CUSTOMER: "لا يمكن إنشاء مناسبة لعميل غير نشط",
  INACTIVE_STAFF: "لا يمكن إسناد موظف غير نشط",
  INACTIVE_EQUIPMENT: "لا يمكن حجز معدة غير نشطة",
  INVALID_TIME: "وقت النهاية يجب أن يكون بعد وقت البداية",
  INVALID_GUESTS: "عدد الضيوف يجب أن يكون أكبر من صفر",
  INVALID_QUANTITY: "الكمية غير صالحة",
  INVALID_EVENT_TRANSITION: "لا يمكن نقل المناسبة إلى هذه الحالة الآن",
  EVENT_CLOSED: "المناسبة مغلقة ولا يمكن تعديلها",
  EVENT_CANCELLED: "المناسبة ملغاة",
  EVENT_NOT_EDITABLE: "لا يمكن تعديل المناسبة في حالتها الحالية",
  QUOTE_IMMUTABLE: "لا يمكن تعديل عرض سعر صادر. أنشئ مراجعة جديدة",
  QUOTE_NOT_ISSUED: "العرض غير صادر ولا يمكن قبوله",
  QUOTE_ALREADY_ACCEPTED: "تم قبول عرض لهذه المناسبة مسبقاً",
  PRICING_LOCKED: "التسعير مقفل بعد قبول العرض",
  STAFF_CONFLICT: "الموظف مرتبط بمناسبة أخرى في هذا الوقت",
  EQUIPMENT_SHORTAGE: "الكمية المطلوبة غير متاحة في هذا الوقت",
  NOT_FOUND: "العنصر غير موجود",
  VALIDATION: "البيانات غير مكتملة أو غير صحيحة",
  IDEMPOTENT_REPLAY: "تم تنفيذ العملية مسبقاً",
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? ARABIC[code]);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof DomainError) return err.message;
  if (err instanceof Error) return err.message;
  return "حدث خطأ غير متوقع";
}
