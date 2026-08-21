import { describe, expect, it } from "vitest";
import type { AttendanceSummary } from "./staff.api";
import {
  matchesHostSearch,
  matchesRosterFilter,
  pickAttendanceForRoster,
  rosterCounts,
  rosterVisualStatus,
} from "./attendanceRoster.model";

function row(overrides: Partial<AttendanceSummary> = {}): AttendanceSummary {
  return {
    id: "att-1",
    eventId: "event-1",
    eventNumber: "EV-1",
    eventTitle: "حفل",
    staffMemberId: "staff-1",
    staffName: "سعيد",
    staffType: "HOST",
    assignmentId: "asg-1",
    attendanceDate: "2026-08-19",
    shift: "MORNING",
    checkIn: "2026-08-19T08:00:00+04:00",
    checkOut: null,
    breakMinutes: 0,
    hoursWorked: 0,
    status: "PRESENT",
    wageMethod: "PER_HOUR",
    wageRateMilli: 2000,
    earnedMilli: 0,
    notes: null,
    recordStatus: "RECORDED",
    voidReason: null,
    createdAt: "2026-08-19T08:00:00+04:00",
    ...overrides,
  };
}

describe("rosterVisualStatus", () => {
  it("maps missing / absent / voided rows to لم يصل", () => {
    expect(rosterVisualStatus(undefined)).toBe("NOT_ARRIVED");
    expect(rosterVisualStatus(row({ checkIn: null }))).toBe("NOT_ARRIVED");
    expect(rosterVisualStatus(row({ status: "ABSENT", checkIn: null, checkOut: null }))).toBe(
      "NOT_ARRIVED",
    );
    expect(rosterVisualStatus(row({ recordStatus: "VOIDED", status: "VOIDED" }))).toBe(
      "NOT_ARRIVED",
    );
  });

  it("maps an open punch to حضر and a closed punch to خرج", () => {
    expect(rosterVisualStatus(row())).toBe("ARRIVED");
    expect(
      rosterVisualStatus(row({ checkOut: "2026-08-19T13:00:00+04:00" })),
    ).toBe("CHECKED_OUT");
  });
});

describe("pickAttendanceForRoster", () => {
  it("prefers an open punch over an older closed slot", () => {
    const closed = row({
      id: "old",
      checkIn: "2026-08-19T08:00:00+04:00",
      checkOut: "2026-08-19T12:00:00+04:00",
      shift: "MORNING",
    });
    const open = row({
      id: "open",
      checkIn: "2026-08-19T16:00:00+04:00",
      checkOut: null,
      shift: "EVENING",
    });
    expect(pickAttendanceForRoster([closed, open], "staff-1")?.id).toBe("open");
  });

  it("ignores other hosts", () => {
    expect(pickAttendanceForRoster([row({ staffMemberId: "other" })], "staff-1")).toBeUndefined();
  });
});

describe("rosterCounts", () => {
  it("splits 50 hosts without inventing zeros from missing data", () => {
    const statuses = [
      ...Array.from({ length: 32 }, () => "ARRIVED" as const),
      ...Array.from({ length: 8 }, () => "NOT_ARRIVED" as const),
      ...Array.from({ length: 10 }, () => "CHECKED_OUT" as const),
    ];
    const counts = rosterCounts(statuses);
    expect(counts.total).toBe(50);
    expect(counts.present).toBe(32);
    expect(counts.notArrived).toBe(8);
    expect(counts.checkedOut).toBe(10);
    expect(counts.arrived).toBe(42);
  });
});

describe("filters and search", () => {
  it("filters by visual status", () => {
    expect(matchesRosterFilter("ARRIVED", "ALL")).toBe(true);
    expect(matchesRosterFilter("ARRIVED", "ARRIVED")).toBe(true);
    expect(matchesRosterFilter("ARRIVED", "NOT_ARRIVED")).toBe(false);
  });

  it("searches Arabic names", () => {
    expect(matchesHostSearch("فاطمة العلوي", "فاط")).toBe(true);
    expect(matchesHostSearch("سعيد", "فاطمة")).toBe(false);
    expect(matchesHostSearch("سعيد", "  ")).toBe(true);
  });
});
