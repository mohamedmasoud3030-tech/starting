import type { ProcurementDomainErrorCode } from "./contracts";

export const PROCUREMENT_ERROR_MESSAGES: Record<
  ProcurementDomainErrorCode,
  string
> = {
  SUPPLIER_INACTIVE: "هذا المورد غير نشط. اختر مورداً نشطاً أو أعد تفعيله أولاً.",
  ORDER_NOT_EDITABLE: "لا يمكن تعديل هذا الطلب في حالته الحالية.",
  ORDER_ALREADY_CANCELLED: "هذا الطلب ملغي بالفعل.",
  OVER_RECEIPT: "كمية الاستلام أكبر من الكمية المتبقية.",
  INVALID_LIFECYCLE: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.",
  PERMISSION_DENIED: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  IDEMPOTENCY_MISMATCH:
    "تغيّرت بيانات المحاولة السابقة. راجع الكميات ثم أعد المحاولة.",
  SUPPLIER_NOT_AVAILABLE: "المورد غير متاح حالياً. اختر مورداً آخر.",
  ITEM_NOT_RECEIVABLE: "هذا البند غير متاح للاستلام حالياً.",
  NETWORK_ERROR: "تعذر الاتصال بالخدمة. تحقق من الشبكة ثم أعد المحاولة.",
  NOT_FOUND: "تعذر العثور على البيانات المطلوبة. قد تكون تغيّرت أو حُذفت.",
  UNKNOWN: "حدث خطأ غير متوقع. أعد المحاولة، أو تواصل مع المسؤول إذا استمر الخطأ.",
};

/** A safe error that an S5A adapter may throw without leaking backend detail. */
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
  ["SUPPLIER_INACTIVE", "SUPPLIER_INACTIVE"],
  ["ORDER_NOT_EDITABLE", "ORDER_NOT_EDITABLE"],
  ["ORDER_ALREADY_CANCELLED", "ORDER_ALREADY_CANCELLED"],
  ["OVER_RECEIPT", "OVER_RECEIPT"],
  ["RECEIPT_EXCEEDS", "OVER_RECEIPT"],
  ["INVALID_LIFECYCLE", "INVALID_LIFECYCLE"],
  ["INVALID_ORDER_STATUS", "INVALID_LIFECYCLE"],
  ["PERMISSION_DENIED", "PERMISSION_DENIED"],
  ["42501", "PERMISSION_DENIED"],
  ["IDEMPOTENCY", "IDEMPOTENCY_MISMATCH"],
  ["SUPPLIER_NOT_AVAILABLE", "SUPPLIER_NOT_AVAILABLE"],
  ["ITEM_NOT_RECEIVABLE", "ITEM_NOT_RECEIVABLE"],
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
