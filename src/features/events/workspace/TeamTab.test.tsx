import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamTab } from "./TeamTab";
import type { Assignment, StaffMember } from "../events.api";

const run = vi.fn().mockResolvedValue(undefined);
const onOpenAttendance = vi.fn();

const staff: StaffMember[] = [
  {
    id: "staff-1",
    name: "سعيد",
    staff_type: "HOST",
    is_active: true,
    default_compensation_method: "PER_HOUR",
    default_rate: "2.000",
  },
  {
    id: "staff-2",
    name: "فاطمة",
    staff_type: "HOSTESS",
    is_active: true,
    default_compensation_method: "PER_EVENT",
    default_rate: "25.000",
  },
];

function assignment(
  id: string,
  staffId: string,
  status = "ACTIVE",
): Assignment {
  return {
    id,
    staff_member_id: staffId,
    assignment_role: staffId === "staff-1" ? "HOST" : "HOSTESS",
    status,
    scheduled_start: "2026-08-19T16:00:00+04:00",
    scheduled_end: "2026-08-19T22:00:00+04:00",
    compensation_method: "PER_HOUR",
    rate: "2.000",
  };
}

describe("TeamTab", () => {
  beforeEach(() => {
    run.mockClear();
    onOpenAttendance.mockClear();
  });

  it("hides already-assigned staff from the select and uses Arabic labels", () => {
    render(
      <TeamTab
        staff={staff}
        assignments={[assignment("asg-1", "staff-1")]}
        run={run}
        canAssign
        canCost
        onOpenAttendance={onOpenAttendance}
      />,
    );
    const options = Array.from(screen.getByLabelText("اختر الموظف").querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    expect(options.join(" ")).toContain("فاطمة");
    expect(options.join(" ")).not.toContain("سعيد");
    expect(screen.getByText(/مضيف · بالساعة/)).toBeInTheDocument();
    expect(screen.getByText(/2\.000/)).toBeInTheDocument();
  });

  it("releases an active assignment without sending event_id", async () => {
    render(
      <TeamTab
        staff={staff}
        assignments={[assignment("asg-1", "staff-1")]}
        run={run}
        canAssign
        canCost
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "تحرير" }));
    expect(run).toHaveBeenCalledWith(
      "release_staff_assignment",
      { p_assignment_id: "asg-1" },
      false,
    );
  });

  it("shows an empty state when nobody is assigned", () => {
    render(
      <TeamTab staff={staff} assignments={[]} run={run} canAssign canCost />,
    );
    expect(screen.getByText("لا يوجد فريق مسند")).toBeInTheDocument();
  });

  it("points the owner to the attendance punch after assigning", () => {
    render(
      <TeamTab
        staff={staff}
        assignments={[assignment("asg-1", "staff-1")]}
        run={run}
        canAssign
        canCost
        onOpenAttendance={onOpenAttendance}
      />,
    );
    expect(screen.getByRole("button", { name: "فتح بصمة الحضور" })).toBeInTheDocument();
  });

  it("hides assign and release from roles that cannot mutate the team", () => {
    render(
      <TeamTab
        staff={staff}
        assignments={[assignment("asg-1", "staff-1")]}
        run={run}
        canAssign={false}
        canCost={false}
      />,
    );
    expect(screen.queryByText("إسناد موظف")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تحرير" })).not.toBeInTheDocument();
    expect(screen.queryByText(/2\.000/)).not.toBeInTheDocument();
  });
});
