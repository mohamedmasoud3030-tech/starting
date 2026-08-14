import { describe, expect, it } from "vitest";
import {
  ProcurementDomainError,
  procurementErrorCode,
  procurementErrorMessage,
} from "./errors";

describe("central Arabic procurement error boundary", () => {
  it.each([
    ["SUPPLIER_INACTIVE", "هذا المورد غير نشط"],
    ["ORDER_NOT_EDITABLE", "لا يمكن تعديل هذا الطلب"],
    ["ORDER_ALREADY_CANCELLED", "هذا الطلب ملغي بالفعل"],
    ["RECEIPT_EXCEEDS_REMAINING", "كمية الاستلام أكبر"],
    ["INVALID_LIFECYCLE", "حالة الطلب الحالية"],
    ["42501 permission denied", "لا تملك صلاحية"],
    ["IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "تغيّرت بيانات المحاولة"],
    ["SUPPLIER_NOT_AVAILABLE", "المورد غير متاح"],
    ["ITEM_NOT_RECEIVABLE", "البند غير متاح"],
  ])("maps %s without exposing the backend code", (raw, expected) => {
    const message = procurementErrorMessage(new Error(raw));
    expect(message).toContain(expected);
    expect(message).not.toContain(raw);
  });

  it("never exposes unknown SQL/constraint details", () => {
    const raw = "23514 check procurement_order_quantity_positive violated";
    const message = procurementErrorMessage({ code: "23514", message: raw });
    expect(message).toContain("حدث خطأ غير متوقع");
    expect(message).not.toContain("23514");
    expect(message).not.toContain("constraint");
  });

  it("accepts the safe typed adapter error", () => {
    expect(procurementErrorCode(new ProcurementDomainError("OVER_RECEIPT"))).toBe("OVER_RECEIPT");
  });
});
