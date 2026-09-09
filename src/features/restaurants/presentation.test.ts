import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  MEAL_TYPE_LABELS,
  contractStatusLabel,
  formatServiceDate,
  mealPriceLabel,
  restaurantErrorMessage,
} from "./presentation";

describe("restaurants presentation", () => {
  it("labels meal types and booking statuses in Arabic", () => {
    expect(MEAL_TYPE_LABELS.LUNCH).toBe("غداء");
    expect(MEAL_TYPE_LABELS.DINNER).toBe("عشاء");
    expect(BOOKING_STATUS_LABELS.PENDING).toBe("قيد التأكيد");
    expect(BOOKING_STATUS_LABELS.CONFIRMED).toBe("مؤكد");
    expect(BOOKING_STATUS_LABELS.SERVED).toBe("منجز");
    expect(BOOKING_STATUS_LABELS.CANCELLED).toBe("ملغي");
    expect(BOOKING_STATUS_TONES.CONFIRMED).toBe("brand");
    expect(BOOKING_STATUS_TONES.PENDING).toBe("warning");
    expect(contractStatusLabel("ACTIVE")).toBe("ساري");
    expect(contractStatusLabel("ENDED")).toBe("منتهي");
  });

  it("formats service dates as DD/MM/YYYY and tolerates bad input", () => {
    expect(formatServiceDate("2026-10-15")).toBe("15/10/2026");
    expect(formatServiceDate("nope")).toBe("nope");
  });

  it("formats DB OMR amounts exactly like the rest of the app", () => {
    expect(mealPriceLabel(3.5)).toBe("3.500 ر.ع.");
    expect(mealPriceLabel(400)).toBe("400.000 ر.ع.");
    expect(mealPriceLabel(0)).toBe("0.000 ر.ع.");
  });

  it("maps known command error codes to Arabic and never leaks raw text", () => {
    expect(restaurantErrorMessage(new Error("NOT_AUTHORIZED"))).toBe(
      "دورك الحالي لا يسمح بتنفيذ هذا الإجراء.",
    );
    expect(restaurantErrorMessage("CANCELLATION_REASON_REQUIRED")).toBe(
      "أدخل سبب الإلغاء.",
    );
    const generic = restaurantErrorMessage(new Error("some internal detail"));
    expect(generic).toContain("تعذّر تنفيذ العملية");
    expect(generic).not.toContain("internal detail");
  });
});
