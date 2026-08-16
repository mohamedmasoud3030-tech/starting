/**
 * Regression tests for the Pricing tab totals.
 *
 * CONFIRMED DEFECT (Phase 3): the tab computed expected revenue / cost /
 * profit with `Number(...)` float reduction and rendered them with
 * `.toFixed(3)` — binary floating point presented as financial truth,
 * violating the money rules (AGENTS.md). 0.1 + 0.2 famously is not 0.3 in
 * IEEE-754; with enough lines the drift crosses a rounding boundary and the
 * displayed profit disagrees with the database by a fils.
 */
import { describe, expect, it } from "vitest";
import { formatOMR } from "@/lib/money";
import { pricingTotals } from "./pricingTotals";

function line(selling: string, cost?: string) {
  return {
    total_selling: selling,
    total_expected_cost: cost,
  };
}

describe("pricingTotals", () => {
  it("sums exactly in integer milli-OMR (no float drift)", () => {
    const totals = pricingTotals([line("0.100", "0.100"), line("0.200", "0.200")]);
    expect(totals.sellMilli).toBe(300);
    expect(totals.costMilli).toBe(300);
    expect(totals.profitMilli).toBe(0);
    // The float path would produce 0.30000000000000004 here.
    expect(formatOMR(totals.sellMilli)).toBe("0.300 ر.ع.");
  });

  it("accumulates many small lines without crossing a rounding boundary", () => {
    // 1000 × 0.001 must be exactly 1.000 — float accumulation of 0.001
    // yields 1.0000000000000007 and a naive toFixed can round wrong at
    // other magnitudes.
    const lines = Array.from({ length: 1000 }, () => line("0.001", "0.001"));
    const totals = pricingTotals(lines);
    expect(totals.sellMilli).toBe(1000);
    expect(totals.costMilli).toBe(1000);
    expect(totals.profitMilli).toBe(0);
  });

  it("treats a missing expected cost as zero cost, not NaN", () => {
    const totals = pricingTotals([line("5.000"), line("2.500", "1.250")]);
    expect(totals.sellMilli).toBe(7500);
    expect(totals.costMilli).toBe(1250);
    expect(totals.profitMilli).toBe(6250);
  });

  it("accepts the numeric transport shape as well as decimal strings", () => {
    const totals = pricingTotals([
      { total_selling: 12.345, total_expected_cost: 1.005 },
    ]);
    expect(totals.sellMilli).toBe(12345);
    expect(totals.costMilli).toBe(1005);
    expect(totals.profitMilli).toBe(11340);
  });
});
