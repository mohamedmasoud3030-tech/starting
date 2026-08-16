/**
 * Characterization + regression tests for the S9 staff read-model mappers.
 *
 * CONFIRMED P0 DEFECT (Phase 3): `staff_attendance_summaries.record_status`
 * is `staff_attendance.status` — the `attendance_status` enum
 * (`PRESENT | LATE | PARTIAL | ABSENT | VOIDED`). It is NEVER the string
 * `'RECORDED'`. The old mapper cast it straight to `HostPaymentStatus`
 * (`RECORDED | VOIDED`) through the untyped client boundary, so every live
 * attendance row carried `recordStatus: "PRESENT" / "LATE" / …`:
 *
 *  - the attendance panel's earned total filtered
 *    `recordStatus === "RECORDED"` → always 0.000 OMR;
 *  - the void button rendered only for `recordStatus === "RECORDED"` →
 *    never rendered (voiding attendance was unreachable from the UI);
 *  - the workspace attendance voice summary counted 0 of 0 present.
 *
 * The lifecycle must be DERIVED: a row is VOIDED iff its status is VOIDED,
 * otherwise it is a live RECORDED row.
 */
import { describe, expect, it } from "vitest";
import {
  mapAttendance,
  mapAdvance,
  mapPayout,
  mapPayroll,
} from "./staff.api";
import type {
  HostEventPayrollSummaryRow,
  HostPayoutSummaryRow,
  StaffAdvanceSummaryRow,
  StaffAttendanceSummaryRow,
} from "@/lib/dbTypes";

function attendanceRow(
  overrides: Partial<StaffAttendanceSummaryRow>,
): StaffAttendanceSummaryRow {
  return {
    attendance_id: "att-1",
    organization_id: "org-1",
    event_id: "event-1",
    event_number: "EV-1001",
    event_title: "حفل زفاف",
    staff_member_id: "staff-1",
    staff_name: "سالم",
    staff_type: "HOST",
    assignment_id: null,
    attendance_date: "2026-08-16",
    shift: "MORNING",
    check_in: "2026-08-16T08:00:00+04:00",
    check_out: "2026-08-16T14:00:00+04:00",
    break_minutes: 30,
    hours_worked: 5.5,
    attendance_status: "PRESENT",
    wage_method: "PER_HOUR",
    wage_rate: 2,
    earned_amount: 11,
    notes: null,
    recorded_by: "user-1",
    voided_by: null,
    voided_at: null,
    void_reason: null,
    record_status: "PRESENT",
    created_at: "2026-08-16T14:05:00+04:00",
    ...overrides,
  };
}

describe("mapAttendance record lifecycle (P0 regression)", () => {
  it("maps a live PRESENT row to recordStatus RECORDED (never PRESENT)", () => {
    const mapped = mapAttendance(attendanceRow({}));
    expect(mapped.recordStatus).toBe("RECORDED");
    expect(mapped.status).toBe("PRESENT");
  });

  it.each(["LATE", "PARTIAL", "ABSENT"] as const)(
    "maps a live %s row to recordStatus RECORDED",
    (status) => {
      const mapped = mapAttendance(
        attendanceRow({ attendance_status: status, record_status: status }),
      );
      expect(mapped.recordStatus).toBe("RECORDED");
      expect(mapped.status).toBe(status);
    },
  );

  it("maps a VOIDED row to recordStatus VOIDED with its void reason", () => {
    const mapped = mapAttendance(
      attendanceRow({
        attendance_status: "VOIDED",
        record_status: "VOIDED",
        void_reason: "خطأ إدخال",
        voided_at: "2026-08-16T15:00:00+04:00",
      }),
    );
    expect(mapped.recordStatus).toBe("VOIDED");
    expect(mapped.voidReason).toBe("خطأ إدخال");
  });

  it("keeps money exact: wage_rate/earned_amount become integer milli-OMR", () => {
    const mapped = mapAttendance(
      attendanceRow({ wage_rate: 2.5, earned_amount: 13.75 }),
    );
    expect(mapped.wageRateMilli).toBe(2500);
    expect(mapped.earnedMilli).toBe(13750);
  });

  it("the RECORDED filter used by the panels now sums live earnings", () => {
    const rows = [
      mapAttendance(attendanceRow({ earned_amount: 11 })),
      mapAttendance(
        attendanceRow({
          attendance_id: "att-2",
          attendance_status: "VOIDED",
          record_status: "VOIDED",
          earned_amount: 5,
        }),
      ),
    ];
    const earned = rows
      .filter((a) => a.recordStatus === "RECORDED")
      .reduce((n, a) => n + a.earnedMilli, 0);
    expect(earned).toBe(11_000);
  });
});

describe("mapAdvance / mapPayout (host_payment_status is the real lifecycle)", () => {
  function advanceRow(
    overrides: Partial<StaffAdvanceSummaryRow>,
  ): StaffAdvanceSummaryRow {
    return {
      advance_id: "adv-1",
      organization_id: "org-1",
      staff_member_id: "staff-1",
      staff_name: "سالم",
      staff_type: "HOST",
      amount: 10,
      advance_date: "2026-08-10",
      reason: null,
      status: "RECORDED",
      void_reason: null,
      voided_at: null,
      voided_by: null,
      recorded_by: "user-1",
      created_at: "2026-08-10T10:00:00+04:00",
      ...overrides,
    };
  }

  it("maps advances with exact money and true lifecycle", () => {
    const live = mapAdvance(advanceRow({}));
    expect(live.status).toBe("RECORDED");
    expect(live.amountMilli).toBe(10_000);

    const voided = mapAdvance(
      advanceRow({ status: "VOIDED", void_reason: "تكرار" }),
    );
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("تكرار");
  });

  it("maps payouts with exact money, method and event linkage", () => {
    const row: HostPayoutSummaryRow = {
      payout_id: "pay-1",
      organization_id: "org-1",
      staff_member_id: "staff-1",
      staff_name: "سالم",
      staff_type: "HOST",
      event_id: "event-1",
      event_number: "EV-1001",
      amount: 25.5,
      payout_date: "2026-08-16",
      payment_method: "CASH",
      reference: null,
      reason: null,
      status: "RECORDED",
      void_reason: null,
      voided_at: null,
      voided_by: null,
      recorded_by: "user-1",
      created_at: "2026-08-16T16:00:00+04:00",
    };
    const mapped = mapPayout(row);
    expect(mapped.amountMilli).toBe(25_500);
    expect(mapped.method).toBe("CASH");
    expect(mapped.eventId).toBe("event-1");
    expect(mapped.status).toBe("RECORDED");
  });
});

describe("mapPayroll", () => {
  it("maps every rollup column into exact milli-OMR", () => {
    const row: HostEventPayrollSummaryRow = {
      organization_id: "org-1",
      staff_member_id: "staff-1",
      staff_name: "سالم",
      staff_type: "HOST",
      event_id: "event-1",
      event_number: "EV-1001",
      event_title: "حفل زفاف",
      attendance_count: 2,
      earned_total: 22,
      advances_total: 5,
      payouts_total: 10,
      due_total: 22,
      paid_total: 15,
      late_total: 7,
    };
    const mapped = mapPayroll(row);
    expect(mapped.earnedMilli).toBe(22_000);
    expect(mapped.advancesMilli).toBe(5_000);
    expect(mapped.payoutsMilli).toBe(10_000);
    expect(mapped.dueMilli).toBe(22_000);
    expect(mapped.paidMilli).toBe(15_000);
    expect(mapped.lateMilli).toBe(7_000);
    expect(mapped.attendanceCount).toBe(2);
  });
});
