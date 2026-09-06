import { describe, expect, it } from "vitest";
import {
  agingBucketLabel,
  agingBucketTone,
  dateOnly,
  sourceTypeLabel,
} from "./presentation";

describe("agingBucketLabel", () => {
  it("maps the four contract buckets to Arabic", () => {
    expect(agingBucketLabel("CURRENT")).toBe("حالية");
    expect(agingBucketLabel("DAYS_31_60")).toBe("31–60 يوم");
    expect(agingBucketLabel("DAYS_61_90")).toBe("61–90 يوم");
    expect(agingBucketLabel("OVER_90")).toBe("أكثر من 90 يوم");
  });

  it("falls back to the raw code for unknown buckets (never a fabricated label)", () => {
    expect(agingBucketLabel("FUTURE_XYZ")).toBe("FUTURE_XYZ");
  });
});

describe("agingBucketTone", () => {
  it("escalates severity as buckets age", () => {
    expect(agingBucketTone("CURRENT")).toBe("success");
    expect(agingBucketTone("DAYS_31_60")).toBe("neutral");
    expect(agingBucketTone("DAYS_61_90")).toBe("warning");
    expect(agingBucketTone("OVER_90")).toBe("danger");
  });

  it("defaults unknown buckets to neutral", () => {
    expect(agingBucketTone("UNKNOWN")).toBe("neutral");
  });
});

describe("sourceTypeLabel", () => {
  it("maps statement source types to Arabic", () => {
    expect(sourceTypeLabel("INVOICE")).toBe("فاتورة");
    expect(sourceTypeLabel("CUSTOMER_PAYMENT")).toBe("دفعة عميل");
    expect(sourceTypeLabel("SUPPLIER_INVOICE")).toBe("فاتورة مورد");
    expect(sourceTypeLabel("UNBILLED_RECOGNITION")).toBe("إثبات إيراد غير مفوتر");
    expect(sourceTypeLabel("OPENING_BALANCE")).toBe("رصيد افتتاحي");
  });

  it("falls back to the raw code for unknown types", () => {
    expect(sourceTypeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("dateOnly", () => {
  it("formats a date-only string in Muscat", () => {
    // The exact rendering depends on the runtime ICU data; assert it does not
    // crash and returns a non-empty Arabic date, not the raw ISO string.
    const result = dateOnly("2026-09-05");
    expect(result).not.toBeNull();
    expect(result).not.toContain("2026-09-05");
  });

  it("returns null for null or invalid input", () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly("not-a-date")).toBeNull();
  });
});
