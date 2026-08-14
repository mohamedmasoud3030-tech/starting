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
