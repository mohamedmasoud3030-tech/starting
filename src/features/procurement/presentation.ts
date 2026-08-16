import type { Badge } from "@/components/ui/Badge";
import type {
  ProcurementLineKind,
  ProcurementOrderStatus,
  SupplierKind,
  SupplierStatus,
} from "./contracts";

export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = {
  CATERING_RESTAURANT: "مطعم / تموين وضيافة",
  CONSUMABLES: "مواد استهلاكية",
  EQUIPMENT_RENTAL: "تأجير معدات",
  GENERAL: "مورد عام",
};

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  ACTIVE: "نشط",
  INACTIVE: "غير نشط",
};

export const ORDER_STATUS_LABELS: Record<ProcurementOrderStatus, string> = {
  DRAFT: "مسودة",
  APPROVED: "معتمد",
  SENT: "مرسل للمورد",
  CONFIRMED: "مؤكد من المورد",
  PARTIALLY_RECEIVED: "استلام جزئي",
  RECEIVED: "تم الاستلام",
  CANCELLED: "ملغي",
};

type BadgeTone = Parameters<typeof Badge>[0]["tone"];

export const ORDER_STATUS_TONES: Record<ProcurementOrderStatus, BadgeTone> = {
  DRAFT: "neutral",
  APPROVED: "brand",
  SENT: "brand",
  CONFIRMED: "brand",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
};

export const LINE_KIND_LABELS: Record<ProcurementLineKind, string> = {
  CONSUMABLE: "مواد للمخزن",
  CATERING_SERVICE: "تموين / خدمة",
  OTHER: "بند آخر",
};

export function formatProcurementDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-OM", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Muscat",
  }).format(date);
}

/** Order lifecycle actions surfaced in the detail dialog. */
export type LifecycleAction = "approve" | "send" | "confirm" | "cancel";

export const ACTION_LABELS: Record<LifecycleAction, string> = {
  approve: "اعتماد الطلب",
  send: "إرسال للمورد",
  confirm: "تأكيد موافقة المورد",
  cancel: "إلغاء الطلب",
};

export const ACTION_CONFIRM_LABELS: Record<LifecycleAction, string> = {
  approve: "نعم، اعتماد الطلب",
  send: "نعم، إرسال الطلب",
  confirm: "نعم، تأكيد موافقة المورد",
  cancel: "نعم، إلغاء الطلب",
};

export const ACTION_QUESTION: Record<LifecycleAction, string> = {
  approve: "هل تريد اعتماد هذا الطلب؟",
  send: "هل تم إرسال الطلب فعلياً للمورد؟",
  confirm: "هل أكد المورد هذا الطلب؟",
  cancel: "هل تريد إلغاء هذا الطلب؟",
};

export const ACTION_EXPLANATION: Record<LifecycleAction, string> = {
  approve: "بعد الاعتماد تصبح البيانات التجارية لقطة تاريخية غير قابلة للتعديل.",
  send: "سجّل الإرسال فقط بعد إرسال الطلب للمورد فعلياً.",
  confirm: "التأكيد يفتح الطلب للاستلام الفعلي حسب الصلاحيات.",
  cancel: "لن تُحذف بيانات الطلب أو أي استلام سابق.",
};

export const ACTION_SUCCESS: Record<LifecycleAction, string> = {
  approve: "تم اعتماد الطلب بنجاح.",
  send: "تم تسجيل إرسال الطلب للمورد.",
  confirm: "تم تسجيل تأكيد المورد.",
  cancel: "تم إلغاء الطلب.",
};
