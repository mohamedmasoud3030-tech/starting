import { describe, expect, it } from "vitest";
import { buildInstallmentSchedule } from "./invoices.api";

describe("buildInstallmentSchedule", () => {
  it("sums exactly to the invoice total (deposit + equal installments)", () => {
    const schedule = buildInstallmentSchedule(500000, 100000, 2, "2026-09-01", 30);
    const total = schedule.reduce((n, s) => n + s.amountMilli, 0);
    expect(total).toBe(500000);
    expect(schedule[0]!.kind).toBe("DEPOSIT");
    expect(schedule[0]!.amountMilli).toBe(100000);
    expect(schedule[1]!.kind).toBe("INSTALLMENT");
    expect(schedule[2]!.kind).toBe("FINAL");
  });

  it("distributes a non-divisible remainder to the final installment", () => {
    const schedule = buildInstallmentSchedule(500000, 0, 3, "2026-09-01", 30);
    const amounts = schedule.map((s) => s.amountMilli);
    expect(amounts).toEqual([0, 166666, 166666, 166668]);
    expect(amounts.reduce((n, a) => n + a, 0)).toBe(500000);
  });

  it("uses one deposit plus N installments (no remainder distortion)", () => {
    const schedule = buildInstallmentSchedule(300000, 100000, 2, "2026-10-10", 15);
    expect(schedule).toHaveLength(3);
    expect(schedule.map((s) => s.amountMilli).reduce((n, a) => n + a, 0)).toBe(300000);
  });
});
