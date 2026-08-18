import { describe, expect, it } from "vitest";
import { computeGrandTotalMilli } from "./quotationMath";

describe("computeGrandTotalMilli — price components mirror of DB quotation_pricing", () => {
  it("no discount: grand total = subtotal + transport + surcharge", () => {
    const r = computeGrandTotalMilli(500_000, 10_000, 5_000, "NONE", "");
    expect(r.discountAmount).toBe(0);
    expect(r.grandTotal).toBe(515_000);
  });

  it("fixed discount is subtracted exactly", () => {
    const r = computeGrandTotalMilli(500_000, 10_000, 5_000, "FIXED", "15");
    expect(r.discountAmount).toBe(15_000);
    expect(r.grandTotal).toBe(500_000);
  });

  it("percentage discount: 500 - 10% = 450", () => {
    const r = computeGrandTotalMilli(500_000, 0, 0, "PERCENT", "10");
    expect(r.discountAmount).toBe(50_000);
    expect(r.grandTotal).toBe(450_000);
  });

  it("fractional percentage is computed with half-away rounding", () => {
    // 500.000 × 7.5% = 37.500 → discount 37.500, grand 462.500
    const r = computeGrandTotalMilli(500_000, 0, 0, "PERCENT", "7.5");
    expect(r.discountAmount).toBe(37_500);
    expect(r.grandTotal).toBe(462_500);
  });

  it("rejects an invalid percentage", () => {
    expect(() => computeGrandTotalMilli(500_000, 0, 0, "PERCENT", "abc")).toThrow();
  });

  it("rejects a percentage above 100", () => {
    expect(() => computeGrandTotalMilli(500_000, 0, 0, "PERCENT", "150")).toThrow();
  });
});
