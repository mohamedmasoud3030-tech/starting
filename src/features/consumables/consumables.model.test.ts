import { describe, expect, it } from "vitest";
import {
  canManageConsumables,
  canOperateConsumables,
  consumableErrorMessage,
  custodyBlock,
  custodyBlockMessage,
  formatQuantity,
  issueBlock,
  issueBlockMessage,
  parseConsumableSummary,
  parseEventConsumableLine,
  parseQuantityInput,
  parseStockLine,
  quantityFromDb,
  quantityToDecimalString,
  reconcileConsumablesBlock,
  reconcileConsumablesBlockMessage,
  validateQuantityAgainst,
  type ConsumableSummary,
  type EventConsumableLine,
  type EventConsumableLineRow,
  type StockSummaryRow,
} from "./consumables.model";

// ---------------------------------------------------------------------------
// Exact quantity boundary
// ---------------------------------------------------------------------------

describe("exact quantity parsing", () => {
  it("parses fractional quantities into exact milli-units", () => {
    expect(parseQuantityInput("12.5")).toEqual({ ok: true, milli: 12500 });
    expect(parseQuantityInput("0.375")).toEqual({ ok: true, milli: 375 });
    expect(parseQuantityInput("3")).toEqual({ ok: true, milli: 3000 });
  });

  it("rejects zero, negative, empty and over-precision input", () => {
    expect(parseQuantityInput("0").ok).toBe(false);
    expect(parseQuantityInput("-2").ok).toBe(false);
    expect(parseQuantityInput("").ok).toBe(false);
    expect(parseQuantityInput("1.0001").ok).toBe(false);
    expect(parseQuantityInput("abc").ok).toBe(false);
  });

  it("normalizes DB numerics without floating-point drift", () => {
    // 2.435 * 1000 === 2434.9999999999995 in binary floats; the exact path
    // must land on 2435.
    expect(quantityFromDb(2.435)).toBe(2435);
    expect(quantityFromDb("8.250")).toBe(8250);
  });

  it("round-trips exact decimal strings", () => {
    expect(quantityToDecimalString(12500)).toBe("12.500");
    expect(quantityToDecimalString(375)).toBe("0.375");
  });

  it("formats display quantities without lying about precision", () => {
    expect(formatQuantity(12500)).toBe("12.5");
    expect(formatQuantity(3000)).toBe("3");
    expect(formatQuantity(375)).toBe("0.375");
    expect(formatQuantity(100000)).toBe("100");
    expect(formatQuantity(0)).toBe("0");
  });

  it("validates against a limit with a readable Arabic message", () => {
    const ok = validateQuantityAgainst("2.5", 3000, "المتاح");
    expect(ok).toEqual({ valid: true, milli: 2500 });
    const over = validateQuantityAgainst("3.5", 3000, "المتاح");
    expect(over.valid).toBe(false);
    if (!over.valid) expect(over.message).toContain("المتاح");
  });
});

// ---------------------------------------------------------------------------
// Read-model parsing: missing critical values are defects, never zeros
// ---------------------------------------------------------------------------

function stockRow(overrides: Partial<StockSummaryRow> = {}): StockSummaryRow {
  return {
    stock_item_id: "stock-1",
    organization_id: "org-1",
    catalog_item_id: "cat-1",
    item_name: "قهوة عربية",
    item_unit: "كجم",
    catalog_status: "ACTIVE",
    is_tracking_active: true,
    minimum_stock_quantity: 5,
    on_hand_quantity: 12.5,
    is_low_stock: false,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    ...overrides,
  };
}

describe("parseStockLine", () => {
  it("parses a healthy row into exact milli quantities", () => {
    const parsed = parseStockLine(stockRow());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.line.onHandMilli).toBe(12500);
      expect(parsed.line.minimumMilli).toBe(5000);
      expect(parsed.line.isLowStock).toBe(false);
      expect(parsed.line.itemName).toBe("قهوة عربية");
    }
  });

  it("rejects a row with a missing balance instead of showing 0", () => {
    const parsed = parseStockLine(stockRow({ on_hand_quantity: null }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.defect.reason).toBe("MISSING_QUANTITY");
  });

  it("rejects a row with missing identity", () => {
    const parsed = parseStockLine(stockRow({ item_name: null }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.defect.reason).toBe("MISSING_IDENTITY");
  });

  it("rejects a row whose low-stock state is unknown", () => {
    const parsed = parseStockLine(stockRow({ is_low_stock: null }));
    expect(parsed.ok).toBe(false);
  });
});

function eventRow(
  overrides: Partial<EventConsumableLineRow> = {},
): EventConsumableLineRow {
  return {
    organization_id: "org-1",
    event_id: "ev-1",
    stock_item_id: "stock-1",
    catalog_item_id: "cat-1",
    item_name: "قهوة عربية",
    item_unit: "كجم",
    issued_quantity: 8.25,
    returned_quantity: 2,
    consumed_quantity: 5,
    wasted_quantity: 1,
    outstanding_quantity: 0.25,
    is_reconciled: false,
    reconciled_at: null,
    ...overrides,
  };
}

describe("parseEventConsumableLine", () => {
  it("parses issued/returned/consumed/wasted/outstanding exactly", () => {
    const parsed = parseEventConsumableLine(eventRow());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.line.issuedMilli).toBe(8250);
      expect(parsed.line.returnedMilli).toBe(2000);
      expect(parsed.line.consumedMilli).toBe(5000);
      expect(parsed.line.wastedMilli).toBe(1000);
      expect(parsed.line.outstandingMilli).toBe(250);
    }
  });

  it("rejects a row with a missing outstanding quantity", () => {
    const parsed = parseEventConsumableLine(
      eventRow({ outstanding_quantity: null }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.defect.reason).toBe("MISSING_QUANTITY");
  });
});

describe("parseConsumableSummary", () => {
  it("parses the RPC payload with decimal-text quantities", () => {
    const summary = parseConsumableSummary({
      status: "OUTSTANDING",
      issued: "8.250",
      returned: "2.000",
      consumed: "5.000",
      wasted: "0.000",
      outstanding: "1.250",
      is_reconciled: false,
    });
    expect(summary).not.toBeNull();
    expect(summary?.issuedMilli).toBe(8250);
    expect(summary?.outstandingMilli).toBe(1250);
    expect(summary?.status).toBe("OUTSTANDING");
  });

  it("returns null for an unknown status or corrupt quantities", () => {
    expect(parseConsumableSummary({ status: "???" })).toBeNull();
    expect(
      parseConsumableSummary({
        status: "OUTSTANDING",
        issued: "x",
        returned: "0",
        consumed: "0",
        wasted: "0",
        outstanding: "0",
      }),
    ).toBeNull();
    expect(parseConsumableSummary(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Authorization mirror + blocked-state reasoning
// ---------------------------------------------------------------------------

describe("authorization mirror", () => {
  it("lets warehouse roles operate but not manage", () => {
    expect(canOperateConsumables("WAREHOUSE")).toBe(true);
    expect(canOperateConsumables("SUPERVISOR")).toBe(true);
    expect(canOperateConsumables("ACCOUNTANT")).toBe(false);
    expect(canOperateConsumables(null)).toBe(false);
    expect(canManageConsumables("WAREHOUSE")).toBe(false);
    expect(canManageConsumables("MANAGER")).toBe(true);
    expect(canManageConsumables("OWNER")).toBe(true);
  });
});

function line(overrides: Partial<EventConsumableLine> = {}): EventConsumableLine {
  return {
    stockItemId: "stock-1",
    eventId: "ev-1",
    itemName: "قهوة عربية",
    itemUnit: "كجم",
    issuedMilli: 8250,
    returnedMilli: 0,
    consumedMilli: 0,
    wastedMilli: 0,
    outstandingMilli: 8250,
    isReconciled: false,
    ...overrides,
  };
}

describe("issueBlock", () => {
  it("allows issuing for a preparing Event", () => {
    expect(
      issueBlock({ canOperate: canOperateConsumables("WAREHOUSE"), eventStatus: "PREPARING", isReconciled: false }),
    ).toEqual({ blocked: false });
  });

  it("blocks with explicit Arabic reasons", () => {
    const notAuth = issueBlock({
      canOperate: canOperateConsumables("ACCOUNTANT"),
      eventStatus: "PREPARING",
      isReconciled: false,
    });
    expect(issueBlockMessage(notAuth)).toBe("لا تملك صلاحية صرف المواد.");

    const rec = issueBlock({
      canOperate: canOperateConsumables("OWNER"),
      eventStatus: "PREPARING",
      isReconciled: true,
    });
    expect(issueBlockMessage(rec)).toContain("تمت تسوية");

    const draft = issueBlock({
      canOperate: canOperateConsumables("OWNER"),
      eventStatus: "DRAFT",
      isReconciled: false,
    });
    expect(issueBlockMessage(draft)).toContain("حالة المناسبة");

    const cancelled = issueBlock({
      canOperate: canOperateConsumables("OWNER"),
      eventStatus: "CANCELLED",
      isReconciled: false,
    });
    expect(cancelled.blocked).toBe(true);
  });
});

describe("custodyBlock", () => {
  it("allows custody reduction while stock is outstanding", () => {
    expect(custodyBlock({ canOperate: canOperateConsumables("WAREHOUSE"), line: line() })).toEqual({
      blocked: false,
    });
  });

  it("blocks when nothing is outstanding, after reconciliation, or without a role", () => {
    const nothing = custodyBlock({
      canOperate: canOperateConsumables("WAREHOUSE"),
      line: line({ outstandingMilli: 0 }),
    });
    expect(custodyBlockMessage(nothing)).toBe("لا توجد كمية متبقية مع المناسبة.");

    const rec = custodyBlock({
      canOperate: canOperateConsumables("WAREHOUSE"),
      line: line({ isReconciled: true }),
    });
    expect(custodyBlockMessage(rec)).toContain("تمت تسوية");

    const noAuth = custodyBlock({ canOperate: canOperateConsumables("ACCOUNTANT"), line: line() });
    expect(noAuth.blocked).toBe(true);
  });
});

function summary(overrides: Partial<ConsumableSummary> = {}): ConsumableSummary {
  return {
    status: "READY_TO_RECONCILE",
    issuedMilli: 8250,
    returnedMilli: 2000,
    consumedMilli: 5250,
    wastedMilli: 1000,
    outstandingMilli: 0,
    isReconciled: false,
    ...overrides,
  };
}

describe("reconcileConsumablesBlock", () => {
  it("allows OWNER/MANAGER once nothing is outstanding", () => {
    expect(reconcileConsumablesBlock({ canManage: canManageConsumables("OWNER"), summary: summary() })).toEqual(
      { blocked: false },
    );
  });

  it("blocks WAREHOUSE from reconciliation", () => {
    const block = reconcileConsumablesBlock({ canManage: canManageConsumables("WAREHOUSE"), summary: summary() });
    expect(reconcileConsumablesBlockMessage(block)).toBe(
      "التسوية النهائية من صلاحية المالك أو المدير فقط.",
    );
  });

  it("blocks while quantities remain outstanding, with the exact amount", () => {
    const block = reconcileConsumablesBlock({
      canManage: canManageConsumables("OWNER"),
      summary: summary({ outstandingMilli: 1250, status: "OUTSTANDING" }),
    });
    expect(reconcileConsumablesBlockMessage(block)).toContain("1.25");
  });

  it("blocks re-reconciliation and empty Events", () => {
    expect(
      reconcileConsumablesBlock({
        canManage: canManageConsumables("OWNER"),
        summary: summary({ isReconciled: true, status: "RECONCILED" }),
      }).blocked,
    ).toBe(true);
    expect(
      reconcileConsumablesBlock({
        canManage: canManageConsumables("OWNER"),
        summary: summary({ issuedMilli: 0, status: "NO_CONSUMABLES" }),
      }).blocked,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Arabic domain-error mapping — no raw SQL/UUID leakage
// ---------------------------------------------------------------------------

describe("consumableErrorMessage", () => {
  it("maps every domain error to operator Arabic", () => {
    expect(consumableErrorMessage(new Error("CONSUMABLE_STOCK_SHORTAGE"))).toBe(
      "الكمية المطلوبة غير متوفرة في المخزن.",
    );
    expect(
      consumableErrorMessage(new Error("CONSUMABLE_EXCEEDS_OUTSTANDING")),
    ).toBe("الكمية أكبر من المتبقي مع المناسبة.");
    expect(
      consumableErrorMessage(new Error("CONSUMABLES_ALREADY_RECONCILED")),
    ).toBe("تمت تسوية مواد هذه المناسبة مسبقاً.");
    expect(
      consumableErrorMessage(new Error("CONSUMABLE_OUTSTANDING_QUANTITY")),
    ).toContain("لا يمكن إتمام التسوية");
    expect(consumableErrorMessage(new Error("QUANTITY_PRECISION_EXCEEDED"))).toContain(
      "الدقة",
    );
    expect(consumableErrorMessage(new Error("WASTE_REASON_REQUIRED"))).toBe(
      "سبب الإتلاف مطلوب.",
    );
    expect(consumableErrorMessage(new Error("ADJUSTMENT_REASON_REQUIRED"))).toBe(
      "سبب التعديل مطلوب.",
    );
    expect(
      consumableErrorMessage(new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")),
    ).toContain("أعد المحاولة");
    expect(consumableErrorMessage(new Error("EVENT_NOT_ISSUABLE"))).toContain(
      "حالة المناسبة",
    );
    expect(consumableErrorMessage(new Error("CATALOG_ITEM_NOT_CONSUMABLE"))).toContain(
      "المواد الاستهلاكية",
    );
  });

  it("never leaks raw PostgreSQL error text or identifiers", () => {
    const raw = new Error(
      'insert or update on table "consumable_movements" violates foreign key constraint; id=3f7c9a10-aaaa-bbbb-cccc-000000000001',
    );
    const message = consumableErrorMessage(raw);
    expect(message).toBe("تعذر إتمام العملية. أعد المحاولة أو راجع المسؤول.");
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(message).not.toContain("constraint");
  });
});
