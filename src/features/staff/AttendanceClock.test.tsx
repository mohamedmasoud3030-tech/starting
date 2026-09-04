import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttendanceStatusRow } from "./staff.api";

const mocks = vi.hoisted(() => ({
  statusRows: [] as AttendanceStatusRow[],
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./staff.api", async () => {
  const actual = await vi.importActual<typeof import("./staff.api")>("./staff.api");
  return {
    ...actual,
    useEventAttendanceStatus: () => ({ data: mocks.statusRows, isLoading: false }),
    useClockStaffIn: () => ({ mutateAsync: mocks.clockIn, isPending: false }),
    useClockStaffOut: () => ({ mutateAsync: mocks.clockOut, isPending: false }),
  };
});

// The face dialog owns its own provider/enrollment hooks — unit-testing the
// manual clock here must not drag them in.
vi.mock("./face/FaceAttendanceDialog", () => ({
  FaceAttendanceDialog: () => null,
}));

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

function statusRow(overrides: Partial<AttendanceStatusRow> = {}): AttendanceStatusRow {
  return {
    attendance_id: "att-1",
    staff_member_id: "staff-1",
    staff_name: "سعيد",
    assignment_id: "asg-1",
    attendance_date: "2026-08-19",
    shift: "MORNING",
    status: "PRESENT",
    check_in: "2026-08-19T08:00:00+04:00",
    check_out: null,
    hours_worked: 0,
    check_in_method: "MANUAL",
    check_out_method: null,
    has_checkin_evidence: true,
    has_checkout_evidence: false,
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
  const uploaded = {
    storagePath: "org-1/ATTENDANCE_CHECKIN/staff_attendance/selfie.jpg",
    fileName: "selfie.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
  };

  beforeEach(() => {
    mocks.statusRows = [];
    mocks.clockIn.mockReset();
    mocks.clockOut.mockReset();
    mocks.upload.mockReset();
    mocks.clockIn.mockResolvedValue({});
    mocks.clockOut.mockResolvedValue({});
    mocks.upload.mockResolvedValue(uploaded);
  });

  function selfieFile(): File {
    return new File(["x"], "selfie.jpg", { type: "image/jpeg" });
  }

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

  it("clocks a host in manually (evidence first, MANUAL method) for the current Muscat shift", async () => {
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "دخول الآن — سعيد" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, selfieFile());
    // Evidence upload precedes the punch command; the row is recorded MANUAL.
    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.clockIn).toHaveBeenCalledWith({
      staffMemberId: "staff-1",
      assignmentId: "asg-1",
      shift: "MORNING",
      evidencePath: uploaded.storagePath,
      evidenceFileName: uploaded.fileName,
      evidenceMimeType: uploaded.mimeType,
      evidenceSizeBytes: uploaded.sizeBytes,
      attendanceMethod: "MANUAL",
    });
  });

  it("shows خروج الآن for an open punch and does not invent wages", async () => {
    mocks.statusRows = [statusRow()];
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
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, selfieFile());
    expect(mocks.clockOut).toHaveBeenCalledWith({
      staffMemberId: "staff-1",
      evidencePath: uploaded.storagePath,
      evidenceFileName: uploaded.fileName,
      evidenceMimeType: uploaded.mimeType,
      evidenceSizeBytes: uploaded.sizeBytes,
      attendanceMethod: "MANUAL",
    });
    expect(screen.queryByRole("button", { name: "دخول الآن — سعيد" })).not.toBeInTheDocument();
  });

  it("hides دخول الآن after the current slot is already closed", () => {
    mocks.statusRows = [
      statusRow({ check_out: "2026-08-19T13:30:00+04:00", check_out_method: "MANUAL" }),
    ];
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.queryByRole("button", { name: "دخول الآن — سعيد" })).not.toBeInTheDocument();
    expect(screen.getByText(/خرج الساعة/)).toBeInTheDocument();
  });

  it("labels a face-assisted open punch honestly", () => {
    mocks.statusRows = [statusRow({ check_in_method: "FACE_ASSISTED" })];
    render(
      <AttendanceClock
        orgId="org-1"
        eventId="event-1"
        assignments={assignments}
        staffList={staffList}
      />,
    );
    expect(screen.getByText(/دخول بتطابق وجه مؤكَّد/)).toBeInTheDocument();
  });
});
