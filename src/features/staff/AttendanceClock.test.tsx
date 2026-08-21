import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttendanceSummary } from "./staff.api";

const mocks = vi.hoisted(() => ({
  attendance: [] as AttendanceSummary[],
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  upload: vi.fn(),
  attendanceError: false,
}));

vi.mock("./staff.api", async () => {
  const actual = await vi.importActual<typeof import("./staff.api")>("./staff.api");
  return {
    ...actual,
    useEventAttendance: () => ({
      data: mocks.attendance,
      isLoading: false,
      isError: mocks.attendanceError,
    }),
    useClockStaffIn: () => ({ mutateAsync: mocks.clockIn, isPending: false }),
    useClockStaffOut: () => ({ mutateAsync: mocks.clockOut, isPending: false }),
  };
});

vi.mock("@/features/attachments/attachments.api", async () => {
  const actual = await vi.importActual<typeof import("@/features/attachments/attachments.api")>(
    "@/features/attachments/attachments.api",
  );
  return {
    ...actual,
    uploadEvidenceFile: mocks.upload,
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

function manyAssignments(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `asg-${i}`,
    staffMemberId: `staff-${i}`,
    assignmentRole: "HOST",
    status: "ACTIVE",
  }));
}

function manyStaff(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `staff-${i}`,
    name: i === 7 ? "فاطمة العلوي" : `مضيف ${i + 1}`,
    staffType: "HOST",
  }));
}

describe("AttendanceClock — supervisor roster", () => {
  const uploaded = {
    storagePath: "org-1/ATTENDANCE_CHECKIN/staff_attendance/host.jpg",
    fileName: "host.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
  };

  beforeEach(() => {
    mocks.attendance = [];
    mocks.attendanceError = false;
    mocks.clockIn.mockReset();
    mocks.clockOut.mockReset();
    mocks.upload.mockReset();
    mocks.clockIn.mockResolvedValue({});
    mocks.clockOut.mockResolvedValue({});
    mocks.upload.mockResolvedValue(uploaded);
  });

  function photoFile(): File {
    return new File(["x"], "host.jpg", { type: "image/jpeg" });
  }

  it("asks the supervisor to assign staff first when the roster is empty", () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={[]}
        staffList={staffList}
      />,
    );
    expect(screen.getByText("لا يوجد فريق مسند")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تصوير دخول/ })).not.toBeInTheDocument();
  });

  it("uses supervisor photo language, not selfie or fingerprint", () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.getByText("إثبات الحضور بالصورة")).toBeInTheDocument();
    expect(screen.queryByText(/بصمة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/سيلفي/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصوير دخول — سعيد" })).toBeInTheDocument();
  });

  it("clocks a host in after a successful supervisor photo upload", async () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "تصوير دخول — سعيد" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.getAttribute("capture")).toBe("environment");
    await userEvent.upload(fileInput, photoFile());
    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.clockIn).toHaveBeenCalledWith({
      staffMemberId: "staff-1",
      assignmentId: "asg-1",
      shift: "MORNING",
      evidencePath: uploaded.storagePath,
      evidenceFileName: uploaded.fileName,
      evidenceMimeType: uploaded.mimeType,
      evidenceSizeBytes: uploaded.sizeBytes,
    });
  });

  it("does not record attendance when the photo upload fails", async () => {
    mocks.upload.mockRejectedValue(new Error("ATTACHMENT_OBJECT_MISSING"));
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "تصوير دخول — سعيد" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, photoFile());
    expect(mocks.clockIn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "تصوير دخول — سعيد" })).toBeInTheDocument();
    expect(screen.getAllByText("لم يصل").length).toBeGreaterThan(0);
  });

  it("shows تصوير خروج for an open punch and does not invent wages", async () => {
    mocks.attendance = [summary()];
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.getByRole("button", { name: "تصوير خروج — سعيد" })).toBeInTheDocument();
    expect(screen.queryByText(/المستحق/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "تصوير خروج — سعيد" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, photoFile());
    expect(mocks.clockOut).toHaveBeenCalledWith({
      staffMemberId: "staff-1",
      evidencePath: uploaded.storagePath,
      evidenceFileName: uploaded.fileName,
      evidenceMimeType: uploaded.mimeType,
      evidenceSizeBytes: uploaded.sizeBytes,
    });
    expect(screen.queryByRole("button", { name: "تصوير دخول — سعيد" })).not.toBeInTheDocument();
  });

  it("shows خرج after checkout and hides further punch actions for that host", () => {
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
    expect(screen.getAllByText("خرج").length).toBeGreaterThan(0);
    expect(screen.queryByText(/11\.000/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تصوير دخول — سعيد" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصوير دخول — فاطمة" })).toBeInTheDocument();
  });

  it("filters and searches a 50-host roster", async () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={manyAssignments(50)}
        staffList={manyStaff(50)}
      />,
    );
    expect(screen.getByText("المضيفون")).toBeInTheDocument();
    expect(screen.getByText("مضيف 50")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("ابحث عن مضيف…"), "فاطمة");
    expect(screen.getByText("فاطمة العلوي")).toBeInTheDocument();
    expect(screen.queryByText("مضيف 1")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText("ابحث عن مضيف…"));
    await userEvent.click(screen.getByRole("button", { name: "حضر", pressed: false }));
    expect(screen.getByText("لا توجد نتائج")).toBeInTheDocument();
  });
});
