import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttendanceSummary } from "./staff.api";

const mocks = vi.hoisted(() => ({
  attendance: [] as AttendanceSummary[],
  clockIn: vi.fn(),
  clockOut: vi.fn(),
}));

vi.mock("./staff.api", async () => {
  const actual = await vi.importActual<typeof import("./staff.api")>("./staff.api");
  return {
    ...actual,
    useEventAttendance: () => ({ data: mocks.attendance, isLoading: false }),
    useClockStaffIn: () => ({ mutateAsync: mocks.clockIn, isPending: false }),
    useClockStaffOut: () => ({ mutateAsync: mocks.clockOut, isPending: false }),
  };
});

vi.mock("@/lib/dates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dates")>("@/lib/dates");
  return {
    ...actual,
    todayInMuscat: () => "2026-08-19",
    defaultMuscatShift: () => "MORNING" as const,
  };
});

import { AttendanceClock } from "./AttendanceClock";

function summary(overrides: Partial<AttendanceSummary> = {}): AttendanceSummary {
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

const assignments = [
  { id: "asg-1", staffMemberId: "staff-1", assignmentRole: "HOST", status: "ACTIVE" },
  { id: "asg-2", staffMemberId: "staff-2", assignmentRole: "HOSTESS", status: "ACTIVE" },
];
const staffList = [
  { id: "staff-1", name: "سعيد", staffType: "HOST" },
  { id: "staff-2", name: "فاطمة", staffType: "HOSTESS" },
];

describe("AttendanceClock", () => {
  beforeEach(() => {
    mocks.attendance = [];
    mocks.clockIn.mockReset();
    mocks.clockOut.mockReset();
    mocks.clockIn.mockResolvedValue({});
    mocks.clockOut.mockResolvedValue({});
  });

  it("asks the owner to assign staff first when the roster is empty", () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={[]}
        staffList={staffList}
      />,
    );
    expect(screen.getByText("لا يوجد فريق مسند")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /دخول الآن/ })).not.toBeInTheDocument();
  });

  it("clocks a host in for the current Muscat shift", async () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "دخول الآن — سعيد" }));
    expect(mocks.clockIn).toHaveBeenCalledWith({
      staffMemberId: "staff-1",
      assignmentId: "asg-1",
      shift: "MORNING",
    });
  });

  it("shows خروج الآن for an open punch and does not invent wages", async () => {
    mocks.attendance = [summary()];
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.getByText(/المستحق يظهر بعد الخروج/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "خروج الآن — سعيد" }));
    expect(mocks.clockOut).toHaveBeenCalledWith({ staffMemberId: "staff-1" });
    expect(screen.queryByRole("button", { name: "دخول الآن — سعيد" })).not.toBeInTheDocument();
  });

  it("hides دخول الآن after the current slot is already closed", () => {
    mocks.attendance = [
      summary({
        checkOut: "2026-08-19T13:30:00+04:00",
        hoursWorked: 5.5,
        earnedMilli: 11000,
      }),
    ];
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.getByText("مسجّل لهذه الوردية")).toBeInTheDocument();
    expect(screen.getByText(/11\.000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "دخول الآن — سعيد" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "دخول الآن — فاطمة" })).toBeInTheDocument();
  });
});
