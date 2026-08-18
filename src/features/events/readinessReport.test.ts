import { describe, expect, it } from "vitest";
import type { Assignment, Capacity, CommercialLine, Reservation } from "./events.api";
import { buildReadinessReport } from "./readinessReport";

function line(over: Partial<CommercialLine> = {}): CommercialLine {
  return {
    id: "l1",
    description: "مضيف",
    item_type: "STAFF",
    unit: "مضيف",
    pricing_method: "PER_EVENT",
    quantity: "5",
    unit_selling_price: "10",
    total_selling: "50",
    is_custom: false,
    ...over,
  };
}

function equipmentLine(over: Partial<CommercialLine> = {}): CommercialLine {
  return {
    ...line({ item_type: "REUSABLE_EQUIPMENT", description: "دلة قهوة", unit: "دلة" }),
    id: over.id ?? "eq1",
    source_catalog_item_id: over.source_catalog_item_id ?? "cat-1",
    ...over,
  };
}

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    staff_member_id: "s1",
    assignment_role: "HOST",
    status: "ACTIVE",
    scheduled_start: "",
    scheduled_end: "",
    ...over,
  };
}

function reservation(over: Partial<Reservation> = {}): Reservation {
  return {
    id: "r1",
    equipment_capacity_id: "cap-1",
    quantity: 2,
    status: "ACTIVE",
    ...over,
  };
}

function capacity(over: Partial<Capacity> = {}): Capacity {
  return { id: "cap-1", catalog_item_id: "cat-1", total_quantity: 10, ...over };
}

describe("buildReadinessReport", () => {
  it("reports an empty event as EMPTY with no percentage", () => {
    const r = buildReadinessReport({
      lines: [],
      assignments: [],
      capacities: [],
      reservations: [],
      hasPayableAcceptedQuotation: false,
      amountPaidMilli: 0,
    });
    expect(r.overall).toBe("EMPTY");
    expect(r.percent).toBeNull();
    expect(r.items).toHaveLength(0);
  });

  it("counts required vs assigned staff honestly", () => {
    const r = buildReadinessReport({
      lines: [line({ quantity: "15" })],
      assignments: [assignment(), assignment({ id: "a2" })], // 2 assigned of 15
      capacities: [],
      reservations: [],
      hasPayableAcceptedQuotation: false,
      amountPaidMilli: 0,
    });
    expect(r.staffMissing).toBe(13);
    const staff = r.items.find((i) => i.key === "staff")!;
    expect(staff.required).toBe(15);
    expect(staff.assigned).toBe(2);
    expect(staff.status).toBe("short");
  });

  it("computes an explainable percentage excluding non-applicable items", () => {
    // Staff complete (5/5) + equipment short (needs 5, reserved 2) → 1 of 2 ok = 50%.
    const r = buildReadinessReport({
      lines: [
        line({ quantity: "5" }),
        equipmentLine({ quantity: "5" }),
      ],
      assignments: [
        assignment(),
        assignment({ id: "a2" }),
        assignment({ id: "a3" }),
        assignment({ id: "a4" }),
        assignment({ id: "a5" }),
      ],
      capacities: [capacity()],
      reservations: [reservation({ quantity: 2 })],
      hasPayableAcceptedQuotation: false,
      amountPaidMilli: 0,
    });
    expect(r.overall).toBe("INCOMPLETE");
    expect(r.percent).toBe(50);
    expect(r.equipmentShortage).toBe(3);
  });

  it("is READY at 100% when staff, equipment and deposit are all satisfied", () => {
    const r = buildReadinessReport({
      lines: [line({ quantity: "2" }), equipmentLine({ quantity: "3" })],
      assignments: [assignment(), assignment({ id: "a2" })],
      capacities: [capacity()],
      reservations: [reservation({ quantity: 3 })],
      hasPayableAcceptedQuotation: true,
      amountPaidMilli: 50_000,
    });
    expect(r.overall).toBe("READY");
    expect(r.percent).toBe(100);
  });

  it("marks the deposit as short only when a payable quotation exists", () => {
    const withQuote = buildReadinessReport({
      lines: [line({ quantity: "1" })],
      assignments: [assignment()],
      capacities: [],
      reservations: [],
      hasPayableAcceptedQuotation: true,
      amountPaidMilli: 0,
    });
    expect(withQuote.items.some((i) => i.key === "deposit" && i.status === "short")).toBe(true);

    const withoutQuote = buildReadinessReport({
      lines: [line({ quantity: "1" })],
      assignments: [assignment()],
      capacities: [],
      reservations: [],
      hasPayableAcceptedQuotation: false,
      amountPaidMilli: 0,
    });
    expect(withoutQuote.items.some((i) => i.key === "deposit")).toBe(false);
  });

  it("ignores released/cancelled assignments and reservations", () => {
    const r = buildReadinessReport({
      lines: [line({ quantity: "1" }), equipmentLine({ quantity: "1" })],
      assignments: [assignment({ status: "RELEASED" })],
      capacities: [capacity()],
      reservations: [reservation({ status: "RELEASED" })],
      hasPayableAcceptedQuotation: false,
      amountPaidMilli: 0,
    });
    expect(r.staffMissing).toBe(1);
    expect(r.equipmentShortage).toBe(1);
  });
});
