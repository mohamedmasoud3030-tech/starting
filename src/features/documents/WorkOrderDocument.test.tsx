import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkOrderDocument } from "./WorkOrderDocument";
import type {
  EventProcurementOpsRow,
  EventTeamSheetRow,
  EventWorkOrderHeaderRow,
  WarehouseSheetRow,
} from "./documents.api";
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

function header(overrides: Partial<EventWorkOrderHeaderRow> = {}): EventWorkOrderHeaderRow {
  return {
    event_number: "EV-2026-00042",
    title: "حفل مريم",
    event_type: "زفاف",
    status: "CONFIRMED",
    start_at: "2026-10-01T10:00:00+04:00",
    end_at: "2026-10-01T20:00:00+04:00",
    guest_count: 120,
    venue_name: "قاعة الأفراح",
    location_details: "الغبرة",
    contact_name: "سعيد",
    contact_phone: "98203088",
    notes: "تجهيز قبل ساعتين",
    customer_name: "عائلة الخصيبي",
    responsible_user_name: "محمد المكلف",
    ...overrides,
  };
}

const team: EventTeamSheetRow[] = [
  {
    staff_member_id: "s1",
    staff_name: "أحمد",
    staff_phone: "90000001",
    assignment_role: "HOST",
    scheduled_start: "2026-10-01T09:00:00+04:00",
    scheduled_end: "2026-10-01T18:00:00+04:00",
    presence_status: null,
    check_in: null,
    check_out: null,
    assignment_notes: null,
  },
];

const warehouse: WarehouseSheetRow[] = [
  {
    line_kind: "EQUIPMENT",
    item_name: "كرسي",
    unit: "حبة",
    required_qty: 300,
    prepared_qty: 0,
    dispatched_qty: 0,
    returned_good_qty: 0,
    damaged_qty: 0,
    lost_qty: 0,
    outstanding_qty: 300,
  },
];

const procurement: EventProcurementOpsRow[] = [
  {
    order_number: "PO-2026-00007",
    supplier_name: "مؤسسة التوريدات",
    order_date: "2026-09-20",
    expected_delivery_at: "2026-09-30T16:00:00+04:00",
    order_status: "SENT",
    order_notes: "توصيل صباحي",
    item_name: "أكواب ورقية",
    unit: "علبة",
    quantity: "10.000",
  },
];

describe("WorkOrderDocument — أمر تشغيل المناسبة", () => {
  it("composes customer, event, team, equipment and procurement sections from truth", () => {
    render(
      <WorkOrderDocument
        identity={identity}
        header={header()}
        teamRows={team}
        warehouseRows={warehouse}
        procurementRows={procurement}
        printedAt="2026-09-29T08:00:00+04:00"
      />,
    );
    expect(screen.getByText("أمر تشغيل المناسبة")).toBeInTheDocument();
    expect(screen.getByText("عائلة الخصيبي")).toBeInTheDocument();
    expect(screen.getByText("محمد المكلف")).toBeInTheDocument();
    expect(screen.getByText("تجهيز قبل ساعتين")).toBeInTheDocument();
    expect(screen.getByText("الفريق المسند")).toBeInTheDocument();
    expect(screen.getByText("أحمد")).toBeInTheDocument();
    expect(screen.getByText("كرسي")).toBeInTheDocument();
    expect(screen.getByText("مؤسسة التوريدات")).toBeInTheDocument();
    expect(screen.getByText("مرسل للمورد")).toBeInTheDocument();
  });

  it("is strictly operational: no money format, no cost vocabulary", () => {
    const { container } = render(
      <WorkOrderDocument
        identity={identity}
        header={header()}
        teamRows={team}
        warehouseRows={warehouse}
        procurementRows={procurement}
        printedAt="2026-09-29T08:00:00+04:00"
      />,
    );
    expect(container.textContent).not.toContain("ر.ع.");
    expect(container.textContent).not.toContain("تكلفة");
    expect(container.textContent).not.toContain("هامش");
  });

  it("renders friendly empty sections when nothing is provisioned", () => {
    render(
      <WorkOrderDocument
        identity={identity}
        header={header({ notes: null })}
        teamRows={[]}
        warehouseRows={[]}
        procurementRows={[]}
        printedAt="2026-09-29T08:00:00+04:00"
      />,
    );
    expect(screen.getByText("لم يُسند فريق بعد.")).toBeInTheDocument();
    expect(screen.queryByText("المعدات والمواد المطلوبة")).not.toBeInTheDocument();
    expect(screen.queryByText("المشتريات والموردون")).not.toBeInTheDocument();
  });
});
