import { describe, expect, it } from "vitest";
import {
  canOperateWarehouse,
  canReconcileWarehouse,
  dispatchBlock,
  dispatchBlockMessage,
  parseWarehouseLine,
  reconcileBlock,
  reconcileBlockMessage,
  returnBlock,
  returnBlockMessage,
  validateDispatchQuantity,
  validateReturnQuantities,
  warehouseErrorMessage,
  type WarehouseLine,
  type WarehouseLineRow,
  type WarehouseSummary,
} from "./warehouse.model";

function row(overrides: Partial<WarehouseLineRow> = {}): WarehouseLineRow {
  return {
    capacity_total_quantity: 100,
    catalog_item_id: "cat-1",
    damaged_quantity: 0,
    dispatched_quantity: 0,
    equipment_capacity_id: "cap-1",
    equipment_name: "كراسي",
    equipment_unit: "قطعة",
    event_id: "ev-1",
    is_reconciled: false,
    lost_quantity: 0,
    organization_id: "org-1",
    outstanding_quantity: 0,
    reconciled_at: null,
    reservation_id: "res-1",
    reservation_status: "ACTIVE",
    reserved_from: "2026-10-01T06:00:00Z",
    reserved_quantity: 10,
    reserved_until: "2026-10-01T16:00:00Z",
    returned_good_quantity: 0,
    ...overrides,
  };
}

function line(overrides: Partial<WarehouseLine> = {}): WarehouseLine {
  return {
    reservationId: "res-1",
    eventId: "ev-1",
    equipmentName: "كراسي",
    equipmentUnit: "قطعة",
    reservationStatus: "ACTIVE",
    reserved: 10,
    dispatched: 0,
    returnedGood: 0,
    damaged: 0,
    lost: 0,
    outstanding: 0,
    remainingToDispatch: 10,
    isReconciled: false,
    damageLossValuationMilli: null,
    ...overrides,
  };
}

function summary(overrides: Partial<WarehouseSummary> = {}): WarehouseSummary {
  return {
    status: "AWAITING_DISPATCH",
    reserved: 10,
    dispatched: 0,
    returned_good: 0,
    damaged: 0,
    lost: 0,
    outstanding: 0,
    is_reconciled: false,
    ...overrides,
  };
}

describe("parseWarehouseLine", () => {
  it("derives the operator quantities from a complete row", () => {
    const parsed = parseWarehouseLine(
      row({ dispatched_quantity: 6, returned_good_quantity: 2, outstanding_quantity: 4 }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.line.dispatched).toBe(6);
    expect(parsed.line.outstanding).toBe(4);
    expect(parsed.line.remainingToDispatch).toBe(4);
  });

  it("never coerces a missing critical quantity to zero", () => {
    const parsed = parseWarehouseLine(row({ outstanding_quantity: null }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.defect.reason).toBe("MISSING_QUANTITY");
  });

  it("rejects a row with no usable identity", () => {
    const parsed = parseWarehouseLine(row({ reservation_id: null }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.defect.reason).toBe("MISSING_IDENTITY");
  });

  it("reads the immutable damage/loss valuation exactly, without float math", () => {
    const parsed = parseWarehouseLine(row({ damaged_quantity: 2, dispatched_quantity: 2 }), {
      damage_loss_valuation_omr: 8.5,
      damaged_quantity: 2,
      dispatched_quantity: 2,
      equipment_capacity_id: "cap-1",
      event_id: "ev-1",
      lost_quantity: 0,
      organization_id: "org-1",
      outstanding_quantity: 0,
      reservation_id: "res-1",
      reserved_quantity: 10,
      returned_good_quantity: 0,
      unit_valuation_omr: 4.25,
      valuation_basis: "CATALOG_COST_SNAPSHOT",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.line.damageLossValuationMilli).toBe(8500);
  });

  it("leaves valuation null rather than faking zero when cost is not readable", () => {
    const parsed = parseWarehouseLine(row(), null);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.line.damageLossValuationMilli).toBeNull();
  });
});

describe("authorization matrix mirrors the database", () => {
  it("lets warehouse-owning roles perform physical operations", () => {
    expect(canOperateWarehouse("WAREHOUSE")).toBe(true);
    expect(canOperateWarehouse("SUPERVISOR")).toBe(true);
    expect(canOperateWarehouse("OWNER")).toBe(true);
    expect(canOperateWarehouse("MANAGER")).toBe(true);
  });

  it("does not give ACCOUNTANT physical warehouse actions", () => {
    expect(canOperateWarehouse("ACCOUNTANT")).toBe(false);
    expect(canReconcileWarehouse("ACCOUNTANT")).toBe(false);
  });

  it("restricts final reconciliation to OWNER and MANAGER", () => {
    expect(canReconcileWarehouse("OWNER")).toBe(true);
    expect(canReconcileWarehouse("MANAGER")).toBe(true);
    expect(canReconcileWarehouse("WAREHOUSE")).toBe(false);
    expect(canReconcileWarehouse("SUPERVISOR")).toBe(false);
  });

  it("treats a missing role as unauthorized", () => {
    expect(canOperateWarehouse(null)).toBe(false);
    expect(canReconcileWarehouse(null)).toBe(false);
  });
});

describe("dispatchBlock", () => {
  it("allows dispatch for an authorized operator on a confirmed Event", () => {
    expect(
      dispatchBlock({ role: "WAREHOUSE", eventStatus: "PREPARING", line: line() }),
    ).toEqual({ blocked: false });
  });

  it("blocks an unauthorized role with a reason", () => {
    const block = dispatchBlock({
      role: "ACCOUNTANT",
      eventStatus: "PREPARING",
      line: line(),
    });
    expect(block).toEqual({ blocked: true, reason: "NOT_AUTHORIZED" });
    expect(dispatchBlockMessage(block)).toBe("لا تملك صلاحية صرف المعدات.");
  });

  it("blocks dispatch before the Event is confirmed", () => {
    const block = dispatchBlock({
      role: "WAREHOUSE",
      eventStatus: "DRAFT",
      line: line(),
    });
    expect(block).toEqual({ blocked: true, reason: "EVENT_NOT_DISPATCHABLE" });
    expect(dispatchBlockMessage(block)).toContain("قبل تأكيد المناسبة");
  });

  it("blocks dispatch after the warehouse was reconciled", () => {
    const block = dispatchBlock({
      role: "WAREHOUSE",
      eventStatus: "PREPARING",
      line: line({ isReconciled: true }),
    });
    expect(block).toEqual({ blocked: true, reason: "RECONCILED" });
  });

  it("blocks dispatch once the whole reservation is out", () => {
    const block = dispatchBlock({
      role: "WAREHOUSE",
      eventStatus: "PREPARING",
      line: line({ dispatched: 10, remainingToDispatch: 0, outstanding: 10 }),
    });
    expect(block).toEqual({ blocked: true, reason: "NOTHING_REMAINING" });
  });

  it("blocks dispatch on a released reservation", () => {
    const block = dispatchBlock({
      role: "WAREHOUSE",
      eventStatus: "PREPARING",
      line: line({ reservationStatus: "CANCELLED" }),
    });
    expect(block).toEqual({ blocked: true, reason: "RESERVATION_NOT_ACTIVE" });
  });
});

describe("returnBlock", () => {
  it("allows a return while stock is outstanding", () => {
    expect(returnBlock({ role: "WAREHOUSE", line: line({ outstanding: 4 }) })).toEqual({
      blocked: false,
    });
  });

  it("blocks a return when nothing is outstanding", () => {
    const block = returnBlock({ role: "WAREHOUSE", line: line({ outstanding: 0 }) });
    expect(block).toEqual({ blocked: true, reason: "NOTHING_OUTSTANDING" });
    expect(returnBlockMessage(block)).toContain("لا توجد كمية بالخارج");
  });

  it("blocks a return after reconciliation", () => {
    const block = returnBlock({
      role: "WAREHOUSE",
      line: line({ outstanding: 3, isReconciled: true }),
    });
    expect(block).toEqual({ blocked: true, reason: "RECONCILED" });
  });
});

describe("reconcileBlock", () => {
  it("allows reconciliation once everything is accounted for", () => {
    expect(
      reconcileBlock({
        role: "OWNER",
        summary: summary({ dispatched: 10, returned_good: 10, outstanding: 0 }),
      }),
    ).toEqual({ blocked: false });
  });

  it("blocks reconciliation while stock is outstanding, and says how much", () => {
    const block = reconcileBlock({
      role: "OWNER",
      summary: summary({ dispatched: 10, returned_good: 6, outstanding: 4 }),
    });
    expect(block).toEqual({ blocked: true, reason: "OUTSTANDING", outstanding: 4 });
    expect(reconcileBlockMessage(block)).toContain("4");
  });

  it("blocks reconciliation for a role that does not own it", () => {
    const block = reconcileBlock({ role: "WAREHOUSE", summary: summary() });
    expect(block).toEqual({ blocked: true, reason: "NOT_AUTHORIZED" });
    expect(reconcileBlockMessage(block)).toContain("المالك أو المدير");
  });

  it("blocks a second reconciliation", () => {
    const block = reconcileBlock({
      role: "OWNER",
      summary: summary({ is_reconciled: true, status: "RECONCILED" }),
    });
    expect(block).toEqual({ blocked: true, reason: "ALREADY_RECONCILED" });
  });
});

describe("client-side quantity guards", () => {
  it("rejects a non-positive dispatch quantity", () => {
    expect(validateDispatchQuantity(0, line())).toEqual({
      valid: false,
      message: "أدخل كمية صحيحة أكبر من صفر.",
    });
  });

  it("rejects dispatch above the remaining reservation", () => {
    const check = validateDispatchQuantity(11, line());
    expect(check.valid).toBe(false);
    if (check.valid) return;
    expect(check.message).toContain("10");
  });

  it("accepts dispatch of exactly the remaining reservation", () => {
    expect(validateDispatchQuantity(10, line())).toEqual({ valid: true });
  });

  it("rejects an empty return", () => {
    expect(
      validateReturnQuantities({ good: 0, damaged: 0, lost: 0 }, line({ outstanding: 5 })),
    ).toEqual({ valid: false, message: "أدخل كمية واحدة على الأقل." });
  });

  it("rejects a return above the outstanding quantity", () => {
    const check = validateReturnQuantities(
      { good: 3, damaged: 2, lost: 1 },
      line({ outstanding: 5 }),
    );
    expect(check.valid).toBe(false);
    if (check.valid) return;
    expect(check.message).toContain("6");
  });

  it("accepts a mixed good/damaged/lost return that exactly clears the line", () => {
    expect(
      validateReturnQuantities({ good: 3, damaged: 1, lost: 1 }, line({ outstanding: 5 })),
    ).toEqual({ valid: true });
  });

  it("rejects negative quantities", () => {
    expect(
      validateReturnQuantities({ good: -1, damaged: 0, lost: 0 }, line({ outstanding: 5 })),
    ).toEqual({ valid: false, message: "أدخل كميات صحيحة غير سالبة." });
  });
});

describe("warehouseErrorMessage", () => {
  it("translates each server invariant into operator Arabic", () => {
    expect(warehouseErrorMessage(new Error("DISPATCH_EXCEEDS_RESERVATION"))).toContain(
      "أكبر من المتبقي في الحجز",
    );
    expect(warehouseErrorMessage(new Error("RETURN_EXCEEDS_OUTSTANDING"))).toContain(
      "المتبقية بالخارج",
    );
    expect(warehouseErrorMessage(new Error("WAREHOUSE_OUTSTANDING_QUANTITY"))).toContain(
      "ما زالت بالخارج",
    );
    expect(warehouseErrorMessage(new Error("WAREHOUSE_ALREADY_RECONCILED"))).toContain(
      "مسبقاً",
    );
    expect(
      warehouseErrorMessage(new Error("DISPATCH_EXCEEDS_PHYSICAL_CAPACITY")),
    ).toContain("لم تُرجع بعد");
  });

  it("never leaks raw PostgreSQL text to a warehouse operator", () => {
    const message = warehouseErrorMessage(
      new Error('duplicate key value violates unique constraint "movements_pkey"'),
    );
    expect(message).toBe("تعذر إتمام العملية. أعد المحاولة أو راجع المسؤول.");
    expect(message).not.toContain("constraint");
    expect(message).not.toContain("movements_pkey");
  });

  it("does not expose an idempotency mismatch as a technical error", () => {
    const message = warehouseErrorMessage(
      new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"),
    );
    expect(message).toContain("أعد المحاولة");
    expect(message).not.toContain("IDEMPOTENCY");
  });
});
