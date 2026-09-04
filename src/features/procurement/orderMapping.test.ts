/**
 * Characterization tests for the shared row→domain procurement mapping.
 *
 * These pin the behaviour that was previously duplicated between the cost
 * and cost-free branches of `getOrder` — especially the receive-capability
 * derivation, which is authorization-relevant presentation logic.
 */
import { describe, expect, it } from "vitest";
import {
  countOutstandingDeliveries,
  deriveLineReceiveCapability,
  groupReceiptLines,
  mapOrderLine,
  mapReceipts,
  toProcurementLineKind,
} from "./orderMapping";

describe("toProcurementLineKind", () => {
  it("passes known kinds through and defaults anything else to OTHER", () => {
    expect(toProcurementLineKind("CONSUMABLE")).toBe("CONSUMABLE");
    expect(toProcurementLineKind("CATERING_SERVICE")).toBe("CATERING_SERVICE");
    expect(toProcurementLineKind("OTHER")).toBe("OTHER");
    expect(toProcurementLineKind("SOMETHING_NEW")).toBe("OTHER");
    expect(toProcurementLineKind(null)).toBe("OTHER");
    expect(toProcurementLineKind(undefined)).toBe("OTHER");
  });
});

describe("deriveLineReceiveCapability", () => {
  const full = { canReceive: true, canProcure: true };
  const physicalOnly = { canReceive: true, canProcure: false };
  const noDispatch = { canReceive: false, canProcure: true };
  const nobody = { canReceive: false, canProcure: false };

  it("is silently complete when nothing remains", () => {
    expect(deriveLineReceiveCapability("CONFIRMED", full, "CONSUMABLE", 0)).toEqual({
      allowed: false,
    });
  });

  it("refuses outside CONFIRMED / PARTIALLY_RECEIVED with a lifecycle reason", () => {
    for (const status of ["DRAFT", "APPROVED", "SENT", "RECEIVED", "CANCELLED"] as const) {
      expect(
        deriveLineReceiveCapability(status, full, "CONSUMABLE", 1000),
      ).toEqual({ allowed: false, reason: "ITEM_NOT_RECEIVABLE" });
    }
  });

  it("denies anyone without warehouse.dispatch, even a procurement manager", () => {
    expect(
      deriveLineReceiveCapability("CONFIRMED", noDispatch, "CONSUMABLE", 1000),
    ).toEqual({ allowed: false, reason: "PERMISSION_DENIED" });
    expect(
      deriveLineReceiveCapability("CONFIRMED", nobody, "CONSUMABLE", 1000),
    ).toEqual({ allowed: false, reason: "PERMISSION_DENIED" });
  });

  it("restricts a dispatch-only receiver to physical CONSUMABLE lines", () => {
    expect(
      deriveLineReceiveCapability("CONFIRMED", physicalOnly, "CATERING_SERVICE", 1000),
    ).toEqual({ allowed: false, reason: "PERMISSION_DENIED" });
    expect(
      deriveLineReceiveCapability("CONFIRMED", physicalOnly, "CONSUMABLE", 1000),
    ).toEqual({ allowed: true });
  });

  it("lets a receiver holding BOTH capabilities take any line kind", () => {
    for (const kind of ["CONSUMABLE", "CATERING_SERVICE", "OTHER"] as const) {
      expect(
        deriveLineReceiveCapability("PARTIALLY_RECEIVED", full, kind, 500),
      ).toEqual({ allowed: true });
    }
  });
});

describe("mapOrderLine", () => {
  const row = {
    order_line_id: "line-1",
    description: "قهوة عربية",
    line_kind: "CONSUMABLE",
    catalog_item_id: "cat-1",
    unit: "كجم",
    ordered_quantity: "5.000",
    received_quantity: "2.000",
    remaining_quantity: "3.000",
  };

  it("maps exact milli quantities without floating point corruption", () => {
    const line = mapOrderLine(row, "CONFIRMED", { canReceive: true, canProcure: true }, {
      unitCostMilli: 1500,
      lineTotalMilli: 7500,
    });
    expect(line.orderedQuantityMilli).toBe(5000);
    expect(line.receivedQuantityMilli).toBe(2000);
    expect(line.remainingQuantityMilli).toBe(3000);
    expect(line.unitCostMilli).toBe(1500);
    expect(line.lineTotalMilli).toBe(7500);
    expect(line.receive.allowed).toBe(true);
  });

  it("keeps money null (not zero) on the cost-free path", () => {
    const line = mapOrderLine(row, "CONFIRMED", { canReceive: true, canProcure: false }, {
      unitCostMilli: null,
      lineTotalMilli: null,
    });
    expect(line.unitCostMilli).toBeNull();
    expect(line.lineTotalMilli).toBeNull();
  });
});

describe("groupReceiptLines + mapReceipts", () => {
  it("groups lines by receipt and maps headers with fallback timestamps", () => {
    const grouped = groupReceiptLines([
      { receipt_id: "r-1", order_line_id: "l-1", quantity: "1.500" },
      { receipt_id: "r-1", order_line_id: "l-2", quantity: "2.000" },
      { receipt_id: "r-2", order_line_id: "l-1", quantity: "0.500" },
      { receipt_id: null, order_line_id: "l-9", quantity: "9.000" },
    ]);

    const receipts = mapReceipts(
      [
        { receipt_id: "r-1", reference: "REF-1", received_at: "2026-08-16T08:00:00Z" },
        { receipt_id: "r-2", reference: null, received_at: null, created_at: "2026-08-15T10:00:00Z" },
      ],
      grouped,
    );

    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual({
      id: "r-1",
      receiptNumber: "REF-1",
      receivedAt: "2026-08-16T08:00:00Z",
      lines: [
        { orderLineId: "l-1", quantityMilli: 1500 },
        { orderLineId: "l-2", quantityMilli: 2000 },
      ],
    });
    // Missing received_at falls back to created_at; null reference kept null.
    expect(receipts[1]?.receivedAt).toBe("2026-08-15T10:00:00Z");
    expect(receipts[1]?.receiptNumber).toBeNull();
    // Rows without a receipt id are dropped, never misattributed.
    expect(receipts.flatMap((r) => r.lines)).not.toContainEqual({
      orderLineId: "l-9",
      quantityMilli: 9000,
    });
  });
});

describe("countOutstandingDeliveries", () => {
  const lines = [
    { remainingQuantityMilli: 0 },
    { remainingQuantityMilli: 1000 },
    { remainingQuantityMilli: 500 },
  ];

  it("counts lines with remaining quantity on live orders", () => {
    expect(countOutstandingDeliveries("CONFIRMED", lines)).toBe(2);
    expect(countOutstandingDeliveries("PARTIALLY_RECEIVED", lines)).toBe(2);
  });

  it("is zero by definition on terminal orders", () => {
    expect(countOutstandingDeliveries("RECEIVED", lines)).toBe(0);
    expect(countOutstandingDeliveries("CANCELLED", lines)).toBe(0);
  });
});
