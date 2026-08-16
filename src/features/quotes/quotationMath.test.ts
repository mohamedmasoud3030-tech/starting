import { describe, expect, it } from "vitest";
import { parseOMR, parseQuantityMilli, toOMRString } from "@/lib/money";
import {
  computeQuotationLineTotalMilli,
  sumQuotationLineTotals,
  type QuickPricingMethod,
} from "./quotationMath";

function total(
  method: QuickPricingMethod,
  unitOmr: string,
  qty: string | number,
  guests: number | null,
) {
  const milli = computeQuotationLineTotalMilli(
    method,
    parseOMR(unitOmr),
    typeof qty === "number" ? qty * 1000 : parseQuantityMilli(qty),
    guests,
  );
  return milli === null ? null : toOMRString(milli);
}

describe("computeQuotationLineTotalMilli (mirrors DB commercial_total)", () => {
  it("FIXED ignores quantity (850.000)", () => {
    expect(total("FIXED", "850.000", 99, null)).toBe("850.000");
  });

  it("PER_UNIT multiplies quantity (12.500 × 3 = 37.500)", () => {
    expect(total("PER_UNIT", "12.500", "3", null)).toBe("37.500");
  });

  it("PER_GUEST multiplies unit × quantity × guests (2.800 × 1 × 120 = 336.000)", () => {
    expect(total("PER_GUEST", "2.800", 1, 120)).toBe("336.000");
  });

  it("PER_GUEST without a guest count is unpriceable (null)", () => {
    expect(total("PER_GUEST", "2.800", 1, null)).toBeNull();
  });

  it("PER_GUEST with guests=0 is unpriceable (null)", () => {
    expect(total("PER_GUEST", "2.800", 1, 0)).toBeNull();
  });

  it("PER_HOUR / PER_DAY / PER_EVENT / MANUAL use unit × quantity", () => {
    expect(total("PER_HOUR", "25.000", "4", null)).toBe("100.000");
    expect(total("PER_DAY", "150.000", "2", null)).toBe("300.000");
    expect(total("PER_EVENT", "500.000", 1, null)).toBe("500.000");
    expect(total("MANUAL", "77.500", "2", null)).toBe("155.000");
  });

  it("rounds half away from zero to 3 decimals like the DB", () => {
    // 2.800 × 0.500 × 3 guests → 4.200
    expect(total("PER_GUEST", "2.800", "0.500", 3)).toBe("4.200");
    // 1.000 × 1.000 × 1 guest → 1.000
    expect(total("PER_GUEST", "1.000", 1, 1)).toBe("1.000");
  });

  it("sums line totals in integer milli (no float drift)", () => {
    const milli =
      computeQuotationLineTotalMilli("PER_UNIT", parseOMR("12.500"), parseQuantityMilli("3"), null) ?? 0;
    const milli2 =
      computeQuotationLineTotalMilli("FIXED", parseOMR("100.000"), 1000, null) ?? 0;
    expect(toOMRString(sumQuotationLineTotals([milli, milli2]))).toBe("137.500");
    expect(toOMRString(sumQuotationLineTotals([milli, null, milli2]))).toBe("137.500");
  });
});
