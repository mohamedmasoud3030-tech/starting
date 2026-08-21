import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffMemberDialog } from "./StaffMemberDialog";
import type { StaffMemberRow } from "./staff.api";

const mutateAsync = vi.fn();

vi.mock("./staff.api", () => ({
  useSaveStaffMember: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/features/attachments/attachments.api", () => ({
  useEvidence: () => ({ data: [], isLoading: false }),
  useAttachEvidence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvidenceUrl: () => ({ data: null }),
  evidenceError: (e: unknown) => String(e),
}));

function memberRow(): StaffMemberRow {
  return {
    id: "staff-1",
    name: "سعيد",
    staffType: "HOST",
    isActive: true,
    defaultCompensationMethod: "PER_EVENT",
    defaultRateMilli: 25000,
    phone: "91234567",
    whatsapp: null,
    idNumber: null,
    notes: null,
  };
}

describe("StaffMemberDialog — roster provisioning (F11)", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });
  it("creates a staff member with the role-checked insert payload", async () => {
    render(
      <StaffMemberDialog open onOpenChange={() => {}} orgId="org-1" member={null} />,
    );

    await userEvent.type(screen.getByLabelText(/الاسم/), "فاطمة");
    await userEvent.selectOptions(screen.getByLabelText(/النوع/), "HOSTESS");
    await userEvent.selectOptions(
      screen.getByLabelText(/طريقة الأجر الافتراضية/),
      "PER_HOUR",
    );
    await userEvent.type(screen.getByLabelText("الأجر الافتراضي"), "3.500");
    await userEvent.click(screen.getByRole("button", { name: "إضافة المضيف" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: null,
      values: expect.objectContaining({
        name: "فاطمة",
        staffType: "HOSTESS",
        compensationMethod: "PER_HOUR",
        rateMilli: 3500,
        isActive: true,
      }),
    });
  });

  it("edits an existing member through the update path", async () => {
    render(
      <StaffMemberDialog
        open
        onOpenChange={() => {}}
        orgId="org-1"
        member={memberRow()}
      />,
    );

    await userEvent.clear(screen.getByLabelText(/الاسم/));
    await userEvent.type(screen.getByLabelText(/الاسم/), "سعيد المحروقي");
    await userEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "staff-1",
      values: expect.objectContaining({
        name: "سعيد المحروقي",
        staffType: "HOST",
        rateMilli: 25000,
      }),
    });
  });

  it("rejects a negative default rate without calling the server", async () => {
    render(
      <StaffMemberDialog open onOpenChange={() => {}} orgId="org-1" member={null} />,
    );

    await userEvent.type(screen.getByLabelText(/الاسم/), "فاطمة");
    await userEvent.type(screen.getByLabelText("الأجر الافتراضي"), "-5");
    await userEvent.click(screen.getByRole("button", { name: "إضافة المضيف" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByText("الأجر الافتراضي لا يمكن أن يكون سالباً"),
    ).toBeInTheDocument();
  });
});
