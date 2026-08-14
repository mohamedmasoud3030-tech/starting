import { describe, expect, it } from "vitest";
import { formatOMR } from "@/lib/money";
import { orderFixture } from "./__tests__/testDoubles";
import {
  formatQuantity,
  linePreviewTotal,
  parseRequiredNonNegativeOMR,
  parsePositiveQuantity,
  validateOrderDraft,
  validateReceiptDraft,
} from "./validation";

describe("procurement exact frontend validation", () => {
  it("accepts exact 3-decimal quantity and rejects excess precision", () => {
    expect(parsePositiveQuantity("12.345")).toEqual({ ok: true, milli: 12_345 });
    expect(parsePositiveQuantity("12.3456")).toEqual({
      ok: false,
      message: "أدخل كمية صحيحة بثلاث خانات عشرية كحد أقصى.",
    });
    expect(formatQuantity(12_340)).toBe("12.34");
  });

  it("rejects zero and negative order quantities", () => {
    expect(parsePositiveQuantity("0")).toMatchObject({ ok: false });
    expect(parsePositiveQuantity("-0.001")).toMatchObject({ ok: false });
  });

  it("keeps OMR at exact 3 decimals without float multiplication", () => {
    expect(parseRequiredNonNegativeOMR("2.435")).toEqual({ ok: true, milli: 2_435 });
    expect(linePreviewTotal("2.435", "3.333")).toBe(8_116);
    expect(formatOMR(linePreviewTotal("2.435", "3.333")!)).toBe("8.116 ر.ع.");
    expect(parseRequiredNonNegativeOMR("1.2345")).toMatchObject({ ok: false });
    expect(parseRequiredNonNegativeOMR("")).toEqual({
      ok: false,
      message: "أدخل سعر الوحدة المتفق عليه.",
    });
  });

  it("requires supplier, order date, tracked catalog identity, quantity, and negotiated amount", () => {
    const errors = validateOrderDraft({
      supplierId: "",
      eventId: "",
      orderDate: "",
      deliveryDueLocal: "",
      notes: "",
      lines: [{
        key: 7,
        catalogItemId: "",
        description: " ",
        kind: "CONSUMABLE",
        unit: "",
        quantityText: "-1",
        unitCostText: "1.0009",
      }],
    });
    expect(errors.supplierId).toBe("اختر المورد.");
    expect(errors.orderDate).toBe("حدد تاريخ الطلب.");
    expect(errors.deliveryDueLocal).toBeUndefined();
    expect(errors.lineErrors[7]).toEqual({
      catalogItemId: "اختر صنف مخزون معتمداً.",
      quantity: "الكمية يجب أن تكون أكبر من صفر.",
      unitCost: "أدخل مبلغاً صحيحاً بدقة 3 خانات عشرية.",
    });
  });

  it("requires description and unit for non-catalog service lines", () => {
    const errors = validateOrderDraft({
      supplierId: "supplier",
      eventId: "",
      orderDate: "2026-08-14",
      deliveryDueLocal: "2026-08-15T10:30",
      notes: "",
      lines: [{
        key: 9,
        catalogItemId: "",
        description: "",
        kind: "CATERING_SERVICE",
        unit: "",
        quantityText: "1",
        unitCostText: "0",
      }],
    });
    expect(errors.lineErrors[9]).toEqual({
      description: "وصف البند مطلوب.",
      unit: "الوحدة مطلوبة.",
    });
  });

  it("blocks over-receipt against the server-supplied remaining quantity", () => {
    const order = orderFixture("PARTIALLY_RECEIVED");
    expect(validateReceiptDraft([
      { orderLineId: "line-consumable-internal", quantityText: "6.001" },
    ], order.lines)).toEqual({
      "line-consumable-internal": "الكمية أكبر من المتبقي (6).",
    });
  });
});
