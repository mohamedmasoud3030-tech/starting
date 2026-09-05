import { describe, expect, it } from "vitest";
import * as staffApi from "./staff.api";
import {
  attendanceError,
  isOpenStatusRow,
  isOpenPunch,
} from "./staff.api";

describe("payroll calculation boundary", () => {
  it("has NO client-side wage calculator — the server is the only path", () => {
    // The former computeEarnedMilli duplicate was deleted: wages come ONLY
    // from the DB canonical compute_earned_amount chain (0039) surfaced via
    // attendance status rows and payroll projections. Any export matching a
    // wage formula here would be a regression against AGENTS.md.
    for (const key of Object.keys(staffApi)) {
      expect(key).not.toMatch(/computeEarned|earnedMilli|wageFor/i);
    }
    expect((staffApi as Record<string, unknown>).computeEarnedMilli).toBeUndefined();
  });
});

describe("isOpenStatusRow (canonical attendance status RPC rows)", () => {
  const row = {
    status: "PRESENT" as const,
    check_in: "2026-09-01T05:00:00+00:00",
    check_out: null,
  };
  it("is open only while a live status row has check-in without checkout", () => {
    expect(isOpenStatusRow(row)).toBe(true);
    expect(isOpenStatusRow({ ...row, status: "ABSENT" as const })).toBe(false);
    expect(isOpenStatusRow({ ...row, status: "VOIDED" as never })).toBe(false);
    expect(isOpenStatusRow({ ...row, check_in: null })).toBe(false);
    expect(isOpenStatusRow({ ...row, check_out: "2026-09-01T14:00:00+00:00" })).toBe(false);
  });
});

describe("isOpenPunch", () => {
  it("is true only while a live row has check-in and no check-out", () => {
    expect(
      isOpenPunch({
        recordStatus: "RECORDED",
        status: "PRESENT",
        checkIn: "2026-08-19T16:00:00+04:00",
        checkOut: null,
      }),
    ).toBe(true);
    expect(
      isOpenPunch({
        recordStatus: "RECORDED",
        status: "PRESENT",
        checkIn: "2026-08-19T16:00:00+04:00",
        checkOut: "2026-08-19T22:00:00+04:00",
      }),
    ).toBe(false);
    expect(
      isOpenPunch({
        recordStatus: "VOIDED",
        status: "VOIDED",
        checkIn: "2026-08-19T16:00:00+04:00",
        checkOut: null,
      }),
    ).toBe(false);
  });
});

describe("attendanceError", () => {
  it("translates punch-clock command errors into Arabic", () => {
    expect(attendanceError(new Error("CLOCK_IN_REQUIRED"))).toBe("اضغط دخول أولاً");
    expect(attendanceError(new Error("ATTENDANCE_SLOT_ALREADY_RECORDED"))).toBe(
      "مسجّل مسبقاً",
    );
  });

  it("translates treasury posting failures into Arabic", () => {
    expect(attendanceError(new Error("TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED"))).toContain(
      "رصيد الصندوق",
    );
  });

  it("translates advance-settlement failures into Arabic", () => {
    expect(attendanceError(new Error("SETTLEMENT_EXCEEDS_PAYABLE"))).toContain("راتب");
    expect(attendanceError(new Error("STAFF_RECEIVABLE_ZERO"))).toContain("سلفة");
  });
});
