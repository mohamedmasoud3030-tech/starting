import type { ProcurementDomainErrorCode } from "./contracts";

export const PROCUREMENT_ERROR_MESSAGES: Record<
  ProcurementDomainErrorCode,
  string
> = {
  SUPPLIER_INACTIVE: "هذا المورد غير نشط. اختر مورداً نشطاً أو أعد تفعيله أولاً.",
  ORDER_NOT_EDITABLE: "لا يمكن تعديل هذا الطلب في حالته الحالية.",
  ORDER_NOT_CANCELLABLE: "لا يمكن إلغاء هذا الطلب في حالته الحالية.",
  OVER_RECEIPT: "كمية الاستلام أكبر من الكمية المتبقية.",
  INVALID_LIFECYCLE: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.",
  PERMISSION_DENIED: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  IDEMPOTENCY_MISMATCH:
    "تغيّرت بيانات المحاولة السابقة. راجع البيانات ثم أعد المحاولة.",
  SUPPLIER_NOT_AVAILABLE: "المورد غير متاح حالياً. اختر مورداً آخر.",
  ITEM_NOT_RECEIVABLE: "هذا البند غير متاح للاستلام حالياً.",
  CANCELLATION_REASON_REQUIRED: "اكتب سبب الإلغاء بوضوح قبل المتابعة.",
  CATALOG_ITEM_REQUIRED: "اختر صنف مخزون معتمداً لهذا البند.",
  TRACKING_INACTIVE: "تتبع هذا الصنف غير نشط حالياً، لذلك لا يمكن استلامه.",
  NETWORK_ERROR: "تعذر الاتصال بالخدمة. تحقق من الشبكة ثم أعد المحاولة.",
  NOT_FOUND: "تعذر العثور على البيانات المطلوبة. قد تكون تغيّرت أو حُذفت.",
  UNKNOWN: "حدث خطأ غير متوقع. أعد المحاولة، أو تواصل مع المسؤول إذا استمر الخطأ.",
};

/** A safe error that the S5 adapter may throw without leaking backend detail. */
export class ProcurementDomainError extends Error {
  readonly code: ProcurementDomainErrorCode;

  constructor(code: ProcurementDomainErrorCode) {
    super(code);
    this.name = "ProcurementDomainError";
    this.code = code;
  }
}

const ERROR_ALIASES: ReadonlyArray<
  readonly [needle: string, code: ProcurementDomainErrorCode]
> = [
  ["SUPPLIER_NOT_ACTIVE", "SUPPLIER_INACTIVE"],
  ["SUPPLIER_INACTIVE", "SUPPLIER_INACTIVE"],
  ["SUPPLIER_NOT_FOUND", "SUPPLIER_NOT_AVAILABLE"],
  ["SUPPLIER_ALREADY_IN_STATUS", "INVALID_LIFECYCLE"],
  ["PROCUREMENT_ORDER_NOT_EDITABLE", "ORDER_NOT_EDITABLE"],
  ["ORDER_NOT_EDITABLE", "ORDER_NOT_EDITABLE"],
  ["PROCUREMENT_ORDER_NOT_CANCELLABLE", "ORDER_NOT_CANCELLABLE"],
  ["PROCUREMENT_CANCELLATION_REASON_REQUIRED", "CANCELLATION_REASON_REQUIRED"],
  ["PROCUREMENT_OVER_RECEIPT", "OVER_RECEIPT"],
  ["OVER_RECEIPT", "OVER_RECEIPT"],
  ["INVALID_PROCUREMENT_ORDER_TRANSITION", "INVALID_LIFECYCLE"],
  ["PROCUREMENT_ORDER_NOT_RECEIVABLE", "ITEM_NOT_RECEIVABLE"],
  ["PROCUREMENT_ORDER_LINE_NOT_FOUND", "ITEM_NOT_RECEIVABLE"],
  ["PROCUREMENT_CONSUMABLE_CATALOG_REQUIRED", "CATALOG_ITEM_REQUIRED"],
  ["CONSUMABLE_STOCK_ITEM_NOT_TRACKED", "CATALOG_ITEM_REQUIRED"],
  ["CONSUMABLE_TRACKING_INACTIVE", "TRACKING_INACTIVE"],
  ["WAREHOUSE_PHYSICAL_RECEIPT_ONLY", "PERMISSION_DENIED"],
  ["NOT_AUTHORIZED", "PERMISSION_DENIED"],
  ["NOT_AUTHENTICATED", "PERMISSION_DENIED"],
  ["42501", "PERMISSION_DENIED"],
  ["IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "IDEMPOTENCY_MISMATCH"],
  ["IDEMPOTENCY", "IDEMPOTENCY_MISMATCH"],
  ["PROCUREMENT_ORDER_NOT_FOUND", "NOT_FOUND"],
  ["NOT_FOUND", "NOT_FOUND"],
  ["PGRST116", "NOT_FOUND"],
  ["NETWORK", "NETWORK_ERROR"],
  ["FETCH", "NETWORK_ERROR"],
] as const;

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return [record.code, record.message, record.details]
      .filter((part): part is string => typeof part === "string")
      .join(" ");
  }
  return "";
}

/**
 * Central S5 Arabic boundary. It intentionally never returns unknown backend
 * messages, SQLSTATE text, constraint names, UUIDs, or stack traces.
 */
export function procurementErrorCode(error: unknown): ProcurementDomainErrorCode {
  if (error instanceof ProcurementDomainError) return error.code;
  const normalized = errorText(error).toUpperCase();
  return ERROR_ALIASES.find(([needle]) => normalized.includes(needle))?.[1] ?? "UNKNOWN";
}

export function procurementErrorMessage(error: unknown): string {
  return PROCUREMENT_ERROR_MESSAGES[procurementErrorCode(error)];
}

export function capabilityMessage(code?: ProcurementDomainErrorCode): string {
  return PROCUREMENT_ERROR_MESSAGES[code ?? "PERMISSION_DENIED"];
}
