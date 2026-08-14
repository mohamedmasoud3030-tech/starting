import { describe, expect, it } from "vitest";
import { arabicError } from "./events.api";

describe("Arabic Event domain errors", () => {
  it("explains a staff overlap", () => {
    expect(arabicError(new Error("STAFF_CONFLICT"))).toBe(
      "الموظف مرتبط بمناسبة أخرى في هذا الوقت",
    );
  });

  it("explains equipment shortage", () => {
    expect(arabicError(new Error("EQUIPMENT_SHORTAGE"))).toBe(
      "الكمية المطلوبة غير متاحة في هذا الوقت",
    );
  });

  it("explains immutable accepted pricing", () => {
    expect(arabicError(new Error("EVENT_PRICING_LOCKED"))).toBe(
      "تم اعتماد العرض ولا يمكن تعديل التسعير",
    );
  });
});
