import { describe, expect, it } from "vitest";
import { computeEarnedMilli } from "./staff.api";
import type { CompensationMethod } from "@/lib/dbTypes";

describe("computeEarnedMilli", () => {
  it("multiplies exact hours by the hourly rate (3dp OMR)", () => {
    // 5.5 hours @ 2.000 OMR/hour = 11.000 OMR = 11000 milli.
    const earned = computeEarnedMilli(
      "PER_HOUR" as CompensationMethod,
      2000,
      "2026-08-15T14:00:00",
      "2026-08-15T19:30:00",
      0,
      "PRESENT",
    );
    expect(earned).toBe(11000);
  });

  it("subtracts break minutes before multiplying", () => {
    // 5 hours @ 2.000 OMR/hour = 10.000 OMR = 10000 milli (30 min break).
    const earned = computeEarnedMilli(
      "PER_HOUR" as CompensationMethod,
      2000,
      "2026-08-15T14:00:00",
      "2026-08-15T19:30:00",
      30,
      "PRESENT",
    );
    expect(earned).toBe(10000);
  });

  it("treats PER_DAY / PER_EVENT / MANUAL as a flat earned amount", () => {
    expect(
      computeEarnedMilli("PER_DAY" as CompensationMethod, 50000, null, null, 0, "PRESENT"),
    ).toBe(50000);
    expect(
      computeEarnedMilli("PER_EVENT" as CompensationMethod, 75000, null, null, 0, "PRESENT"),
    ).toBe(75000);
    expect(
      computeEarnedMilli("MANUAL" as CompensationMethod, 12345, null, null, 0, "PRESENT"),
    ).toBe(12345);
  });

  it("returns zero earned for ABSENT regardless of rate", () => {
    expect(
      computeEarnedMilli("PER_EVENT" as CompensationMethod, 75000, null, null, 0, "ABSENT"),
    ).toBe(0);
  });

  it("returns zero when times are missing for PER_HOUR", () => {
    expect(
      computeEarnedMilli("PER_HOUR" as CompensationMethod, 2000, null, null, 0, "PRESENT"),
    ).toBe(0);
  });
});
