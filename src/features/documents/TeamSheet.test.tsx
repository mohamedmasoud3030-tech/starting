import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamSheet } from "./TeamSheet";
import type { EventTeamSheetRow } from "./documents.api";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";

const identity: DocumentIdentity = {
  nameAr: "منشأة الضيافة",
  nameEn: null,
  logoUrl: null,
  phonePrimary: null,
  phoneSecondary: null,
  whatsapp: null,
  email: null,
  commercialRegistration: null,
  postalCode: null,
  poBox: null,
  addressLine1: null,
  city: null,
  region: null,
  country: null,
  managerName: null,
  managerTitle: null,
  terms: null,
  footer: null,
};

function row(overrides: Partial<EventTeamSheetRow> = {}): EventTeamSheetRow {
  return {
    staff_member_id: "s1",
    staff_name: "أحمد المضيف",
    staff_phone: "+96890000001",
    assignment_role: "HOST",
    scheduled_start: "2026-10-01T09:00:00+04:00",
    scheduled_end: "2026-10-01T18:00:00+04:00",
    presence_status: null,
    check_in: null,
    check_out: null,
    assignment_notes: null,
    ...overrides,
  };
}

describe("TeamSheet — كشف فريق المناسبة", () => {
  it("renders the assigned roster with Arabic role labels and unrecorded presence", () => {
    render(
      <TeamSheet
        identity={identity}
        eventNumber="EV-2026-00042"
        eventTitle="حفل مريم"
        printedAt="2026-09-30T08:00:00+04:00"
        rows={[row()]}
      />,
    );
    expect(screen.getByText("كشف فريق المناسبة")).toBeInTheDocument();
    expect(screen.getByText("EV-2026-00042")).toBeInTheDocument();
    expect(screen.getByText("أحمد المضيف")).toBeInTheDocument();
    expect(screen.getByText("مضيف")).toBeInTheDocument();
    expect(screen.getByText("لم يُسجَّل")).toBeInTheDocument();
  });

  it("maps recorded attendance states to their Arabic labels", () => {
    render(
      <TeamSheet
        identity={identity}
        eventNumber="EV-1"
        eventTitle=""
        printedAt="2026-09-30T08:00:00+04:00"
        rows={[
          row({ staff_member_id: "s1", staff_name: "سالم", presence_status: "LATE" }),
          row({ staff_member_id: "s2", staff_name: "خالد", presence_status: "ABSENT" }),
        ]}
      />,
    );
    expect(screen.getByText("متأخر")).toBeInTheDocument();
    expect(screen.getByText("غائب")).toBeInTheDocument();
  });

  it("is wage-free: no OMR money format anywhere in the document", () => {
    const { container } = render(
      <TeamSheet
        identity={identity}
        eventNumber="EV-1"
        eventTitle="حفل"
        printedAt="2026-09-30T08:00:00+04:00"
        rows={[row()]}
      />,
    );
    // The operational roster never renders money (the projection carries no
    // rate/compensation/earned columns at all).
    expect(container.textContent).not.toContain("ر.ع.");
    expect(container.textContent).not.toMatch(/\d+\.\d{3}/);
  });

  it("shows the empty state when no roster exists", () => {
    render(
      <TeamSheet
        identity={identity}
        eventNumber="EV-1"
        eventTitle=""
        printedAt="2026-09-30T08:00:00+04:00"
        rows={[]}
      />,
    );
    expect(
      screen.getByText("لا يوجد فريق مسند لهذه المناسبة بعد."),
    ).toBeInTheDocument();
  });
});
