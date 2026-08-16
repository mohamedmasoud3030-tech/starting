import { describe, expect, it } from "vitest";
import type { ProcurementOrderListItem } from "./contracts";
import { filterOrders, hasActiveFilters } from "./orderList.model";

const capability = { allowed: true, reason: undefined };
const capabilities = {
  approve: capability,
  send: capability,
  confirm: capability,
  cancel: capability,
  receive: capability,
};

function order(overrides: Partial<ProcurementOrderListItem>): ProcurementOrderListItem {
  return {
    id: "o1",
    orderNumber: "PO-100",
    status: "DRAFT",
    orderedAt: "2026-08-01T10:00:00Z",
    deliveryDueAt: "2026-08-10T10:00:00Z",
    outstandingDeliveryCount: 1,
    negotiatedTotalMilli: null,
    capabilities,
    supplier: { id: "s1", name: "مورد النور" },
    event: { id: "e1", title: "زفاف مريم" },
    ...overrides,
  };
}

describe("orderList.model", () => {
  const orders = [
    order({ id: "1", orderNumber: "PO-100", status: "DRAFT", supplier: { id: "s1", name: "مورد النور" } }),
    order({ id: "2", orderNumber: "PO-101", status: "SENT", supplier: { id: "s2", name: "مطعم الريان" } }),
    order({ id: "3", orderNumber: "PO-102", status: "DRAFT", supplier: { id: "s3", name: "شركة الساحل" }, event: null }),
  ];

  it("returns all orders when no filters are active", () => {
    expect(filterOrders(orders, "", "ALL")).toHaveLength(3);
    expect(hasActiveFilters("", "ALL")).toBe(false);
  });

  it("filters by search across number, supplier and event title", () => {
    expect(filterOrders(orders, "po-101", "ALL").map((o) => o.id)).toEqual(["2"]);
    expect(filterOrders(orders, "الريان", "ALL").map((o) => o.id)).toEqual(["2"]);
    expect(filterOrders(orders, "زفاف مريم", "ALL").map((o) => o.id)).toEqual(["1", "2"]);
    expect(hasActiveFilters("الريان", "ALL")).toBe(true);
  });

  it("filters by status", () => {
    expect(filterOrders(orders, "", "DRAFT").map((o) => o.id)).toEqual(["1", "3"]);
    expect(hasActiveFilters("", "DRAFT")).toBe(true);
  });

  it("combines search and status", () => {
    expect(filterOrders(orders, "الريان", "SENT").map((o) => o.id)).toEqual(["2"]);
    expect(filterOrders(orders, "الساحل", "SENT")).toEqual([]);
  });
});
