import { describe, expect, it } from "vitest";
import { formatOMR } from "@/lib/money";
import { orderFixture } from "./__tests__/testDoubles";
import {
  formatQuantity,
  linePreviewTotal,
  parseOptionalNonNegativeOMR,
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
    expect(parseOptionalNonNegativeOMR("2.435")).toEqual({ ok: true, milli: 2_435 });
    expect(linePreviewTotal("2.435", "3.333")).toBe(8_116);
    expect(formatOMR(linePreviewTotal("2.435", "3.333")!)).toBe("8.116 ر.ع.");
    expect(parseOptionalNonNegativeOMR("1.2345")).toMatchObject({ ok: false });
  });

  it("validates required supplier, delivery time, description, unit, quantity, and amount", () => {
    const errors = validateOrderDraft({
      supplierId: "",
      eventId: "",
      deliveryDueLocal: "",
      notes: "",
      lines: [{
        key: 7,
        description: " ",
        kind: "CONSUMABLE",
        unit: "",
        quantityText: "-1",
        unitCostText: "1.0009",
      }],
    });
    expect(errors.supplierId).toBe("اختر المورد.");
    expect(errors.deliveryDueLocal).toBe("حدد تاريخ ووقت التوريد.");
    expect(errors.lineErrors[7]).toEqual({
      description: "وصف البند مطلوب.",
      unit: "الوحدة مطلوبة.",
      quantity: "الكمية يجب أن تكون أكبر من صفر.",
      unitCost: "أدخل مبلغاً صحيحاً بدقة 3 خانات عشرية.",
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
