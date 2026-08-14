import { describe, expect, it } from "vitest";
import {
  MAX_MONEY_MILLI,
  MIN_MONEY_MILLI,
  MoneyError,
  formatOMR,
  fromDbAmount,
  isNegative,
  multiplyOMR,
  parseOMR,
  parseQuantityMilli,
  toDbAmount,
  toDbNumeric,
  toOMRString,
} from "./money";

describe("money — OMR 3-decimal handling", () => {
  it("parses a 3-decimal amount to integer milli-OMR", () => {
    expect(parseOMR("12.345")).toBe(12345);
  });

  it("parses whole amounts", () => {
    expect(parseOMR("8")).toBe(8000);
  });

  it("parses the smallest representable amount", () => {
    expect(parseOMR("0.001")).toBe(1);
  });

  it("parses negative amounts", () => {
    expect(parseOMR("-0.500")).toBe(-500);
  });

  it("parses amounts with thousand separators", () => {
    expect(parseOMR("1,234.567")).toBe(1234567);
  });

  it("pads short fractions to 3 decimals", () => {
    expect(toOMRString(parseOMR("1.5"))).toBe("1.500");
  });

  it("rejects more than 3 decimal places", () => {
    expect(() => parseOMR("1.2345")).toThrow(MoneyError);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseOMR("abc")).toThrow(MoneyError);
    expect(() => parseOMR("12.34.56")).toThrow(MoneyError);
  });

  it("round-trips through the DB string representation", () => {
    expect(toDbAmount(12345)).toBe("12.345");
    expect(fromDbAmount("2.500")).toBe(2500);
    expect(fromDbAmount(null)).toBe(0);
  });

  it("normalizes the PostgREST numeric transport shape into exact milli-OMR", () => {
    // `numeric(12,3)` is transported as a JSON number; it must become the
    // exact same integer as the equivalent decimal string.
    expect(fromDbAmount(2.5)).toBe(2500);
    expect(fromDbAmount("2.500")).toBe(2500);
    expect(fromDbAmount(3)).toBe(3000);
    expect(fromDbAmount(0)).toBe(0);
    expect(fromDbAmount(-1.25)).toBe(-1250);
    expect(fromDbAmount(undefined)).toBe(0);
  });

  it("does not lose a milli-unit to float error on numeric transport", () => {
    // 2.435 * 1000 === 2434.9999999999995 in IEEE-754. Normalization must not
    // truncate to 2434.
    expect(fromDbAmount(2.435)).toBe(2435);
    expect(fromDbAmount(1.005)).toBe(1005);
    expect(fromDbAmount(8.115)).toBe(8115);
    expect(parseQuantityMilli(2.435)).toBe(2435);
    expect(parseQuantityMilli(1.005)).toBe(1005);
  });

  it("round-trips every 3-decimal value through the numeric write shape", () => {
    for (const millis of [0, 1, 999, 1005, 2435, 8115, 12345, -12345, 999_999]) {
      expect(fromDbAmount(toDbNumeric(millis))).toBe(millis);
    }
    expect(toDbNumeric(12345)).toBe(12.345);
    expect(toDbNumeric(0)).toBe(0);
  });

  it("rejects a numeric transport value outside the persisted domain", () => {
    // Exponential notation cannot occur inside numeric(12,3).
    expect(() => fromDbAmount(1e21)).toThrow(MoneyError);
    expect(() => fromDbAmount(Number.NaN)).toThrow(MoneyError);
    expect(() => fromDbAmount(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    // More than 3 decimals is not a representable persisted amount.
    expect(() => fromDbAmount(1.2345)).toThrow(MoneyError);
  });

  it("formats for display with the OMR symbol", () => {
    expect(formatOMR(12345)).toBe("12.345 ر.ع.");
    expect(formatOMR(8000)).toBe("8.000 ر.ع.");
  });

  it("detects negative amounts", () => {
    expect(isNegative(-1)).toBe(true);
    expect(isNegative(0)).toBe(false);
    expect(isNegative(1)).toBe(false);
  });
});

describe("money — numeric(12,3) persisted domain bounds", () => {
  it("accepts the maximum legal value", () => {
    expect(parseOMR("999999999.999")).toBe(MAX_MONEY_MILLI);
  });

  it("accepts the minimum legal value", () => {
    expect(parseOMR("-999999999.999")).toBe(MIN_MONEY_MILLI);
  });

  it("rejects one unit beyond the maximum (10 integer digits)", () => {
    expect(() => parseOMR("1000000000.000")).toThrow(MoneyError);
  });

  it("rejects one unit beyond the minimum", () => {
    expect(() => parseOMR("-1000000000.000")).toThrow(MoneyError);
  });

  it("rejects values with too many integer digits", () => {
    expect(() => parseOMR("1234567890")).toThrow(MoneyError);
  });
});

describe("money — exact arithmetic (no binary float drift)", () => {
  it("multiplies an amount by a guest count exactly", () => {
    // 2.300 OMR × 150 guests = 345.000 OMR
    expect(multiplyOMR(2300, parseQuantityMilli(150))).toBe(345000);
  });

  it("multiplies by a fractional quantity exactly", () => {
    // 8.000 OMR × 2.5 = 20.000 OMR
    expect(multiplyOMR(8000, parseQuantityMilli("2.5"))).toBe(20000);
  });

  it("avoids classic float error (0.1 + 0.2)", () => {
    expect(toOMRString(parseOMR("0.1") + parseOMR("0.2"))).toBe("0.300");
  });

  it("rounds ties half away from zero", () => {
    // 1.000 OMR × 1.0005 ... use a direct tie: 0.500 * 0.001 => below.
    // 0.500 OMR × 1 = 0.500 (no rounding needed). Use a true tie:
    // amount=0.001, qty=0.5 → 0.001 * 0.5 = 0.0005 → rounds to 0.001 (half up)
    expect(multiplyOMR(1, parseQuantityMilli("0.5"))).toBe(1);
  });

  it("rounds negative ties away from zero", () => {
    // -0.001 * 0.5 = -0.0005 → rounds to -0.001 (away from zero)
    expect(multiplyOMR(-1, parseQuantityMilli("0.5"))).toBe(-1);
  });

  it("throws on multiplication overflow beyond the persisted domain", () => {
    expect(() =>
      multiplyOMR(MAX_MONEY_MILLI, parseQuantityMilli(2)),
    ).toThrow(MoneyError);
  });

  it("parses quantities as integers and decimals", () => {
    expect(parseQuantityMilli(150)).toBe(150000);
    expect(parseQuantityMilli("2.5")).toBe(2500);
    expect(parseQuantityMilli("0.5")).toBe(500);
  });
});
