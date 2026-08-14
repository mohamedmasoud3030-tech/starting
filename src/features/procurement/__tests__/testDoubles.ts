import { vi } from "vitest";
import type {
  EventProcurementSummary,
  ProcurementAccess,
  ProcurementDataSource,
  ProcurementOrderDetail,
  ProcurementOrderListItem,
  ProcurementOrderStatus,
  SupplierDetail,
  SupplierListItem,
} from "../contracts";

const allowed = { allowed: true } as const;
const denied = { allowed: false, reason: "INVALID_LIFECYCLE" } as const;

export const fullAccess: ProcurementAccess = {
  canViewCommercialAmounts: true,
  canCreateSupplier: true,
  canCreateOrder: true,
};

export function supplierFixture(overrides: Partial<SupplierDetail> = {}): SupplierDetail {
  return {
    id: "supplier-internal-id",
    name: "مؤسسة النخبة للضيافة",
    kind: "CATERING",
    phone: "+968 9000 1111",
    status: "ACTIVE",
    lastOrderAt: "2026-08-12T08:00:00Z",
    openOrderCount: 2,
    contactName: "أحمد",
    notes: "التوصيل من البوابة الخلفية",
    capabilities: { edit: allowed, deactivate: allowed },
    ...overrides,
  };
}

export function orderFixture(
  status: ProcurementOrderStatus = "DRAFT",
  overrides: Partial<ProcurementOrderDetail> = {},
): ProcurementOrderDetail {
  return {
    id: `order-internal-${status}`,
    orderNumber: `PO-${status}`,
    supplier: { id: "supplier-internal-id", name: "مؤسسة النخبة للضيافة" },
    event: { id: "event-internal-id", title: "حفل الاستقبال", eventNumber: "EV-104" },
    orderedAt: "2026-08-12T08:00:00Z",
    deliveryDueAt: "2026-08-15T06:30:00Z",
    status,
    negotiatedTotalMilli: 12_345,
    outstandingDeliveryCount: status === "RECEIVED" ? 0 : 1,
    capabilities: {
      approve: status === "DRAFT" ? allowed : denied,
      cancel: ["DRAFT", "APPROVED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(status) ? allowed : denied,
      receive: ["APPROVED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(status) ? allowed : denied,
    },
    notes: "التسليم صباحاً",
    lines: [
      {
        id: "line-consumable-internal",
        description: "قهوة عمانية",
        kind: "CONSUMABLE",
        unit: "كجم",
        orderedQuantityMilli: 10_000,
        receivedQuantityMilli: status === "PARTIALLY_RECEIVED" ? 4_000 : status === "RECEIVED" ? 10_000 : 0,
        remainingQuantityMilli: status === "PARTIALLY_RECEIVED" ? 6_000 : status === "RECEIVED" ? 0 : 10_000,
        unitCostMilli: 1_235,
        lineTotalMilli: 12_350,
        receive: ["APPROVED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(status) ? allowed : denied,
      },
      {
        id: "line-service-internal",
        description: "خدمة تقديم القهوة",
        kind: "CATERING_SERVICE",
        unit: "خدمة",
        orderedQuantityMilli: 1_000,
        receivedQuantityMilli: 0,
        remainingQuantityMilli: 1_000,
        unitCostMilli: 20_000,
        lineTotalMilli: 20_000,
        receive: ["APPROVED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(status) ? allowed : denied,
      },
    ],
    receipts: [],
    ...overrides,
  };
}

export interface TestSourceControls {
  source: ProcurementDataSource;
  suppliers: SupplierDetail[];
  orders: ProcurementOrderDetail[];
  access: ProcurementAccess;
  eventSummary: EventProcurementSummary;
  failures: Partial<Record<keyof ProcurementDataSource, unknown>>;
  calls: {
    receipt: ReturnType<typeof vi.fn>;
    createSupplier: ReturnType<typeof vi.fn>;
    updateSupplier: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    createOrder: ReturnType<typeof vi.fn>;
  };
}

function failIfSet(
  failures: TestSourceControls["failures"],
  method: keyof ProcurementDataSource,
) {
  const failure = failures[method];
  if (failure) throw failure;
}

export function createTestSource(options?: {
  suppliers?: SupplierDetail[];
  orders?: ProcurementOrderDetail[];
  access?: ProcurementAccess;
  eventSummary?: EventProcurementSummary;
}): TestSourceControls {
  const suppliers = options?.suppliers ?? [supplierFixture()];
  const orders = options?.orders ?? [orderFixture()];
  const access = options?.access ?? { ...fullAccess };
  const failures: TestSourceControls["failures"] = {};
  const eventSummary = options?.eventSummary ?? {
    eventId: "event-internal-id",
    orders,
    outstandingDeliveryCount: orders.reduce((sum, order) => sum + order.outstandingDeliveryCount, 0),
    negotiatedTotalMilli: 12_345,
  };
  const calls = {
    receipt: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    createOrder: vi.fn(),
  };

  const source: ProcurementDataSource = {
    async getAccess() {
      failIfSet(failures, "getAccess");
      return access;
    },
    async listSuppliers(): Promise<SupplierListItem[]> {
      failIfSet(failures, "listSuppliers");
      return suppliers;
    },
    async getSupplier(id) {
      failIfSet(failures, "getSupplier");
      const item = suppliers.find((supplier) => supplier.id === id);
      if (!item) throw new Error("NOT_FOUND");
      return item;
    },
    async createSupplier(input) {
      failIfSet(failures, "createSupplier");
      calls.createSupplier(input);
      const item = supplierFixture({
        id: "created-supplier-internal",
        name: input.name,
        kind: input.kind,
        phone: input.phone,
        contactName: input.contactName,
        notes: input.notes,
        lastOrderAt: null,
        openOrderCount: 0,
      });
      suppliers.push(item);
      return item;
    },
    async updateSupplier(id, input) {
      failIfSet(failures, "updateSupplier");
      calls.updateSupplier(id, input);
      const index = suppliers.findIndex((supplier) => supplier.id === id);
      if (index < 0) throw new Error("NOT_FOUND");
      const current = suppliers[index];
      if (!current) throw new Error("NOT_FOUND");
      const item = { ...current, ...input };
      suppliers[index] = item;
      return item;
    },
    async deactivateSupplier(id) {
      failIfSet(failures, "deactivateSupplier");
      const index = suppliers.findIndex((supplier) => supplier.id === id);
      const current = suppliers[index];
      if (index < 0 || !current) throw new Error("NOT_FOUND");
      const item = { ...current, status: "INACTIVE" as const };
      suppliers[index] = item;
      return item;
    },
    async listOrders(): Promise<ProcurementOrderListItem[]> {
      failIfSet(failures, "listOrders");
      return orders;
    },
    async getOrder(id) {
      failIfSet(failures, "getOrder");
      const item = orders.find((order) => order.id === id);
      if (!item) throw new Error("NOT_FOUND");
      return item;
    },
    async createOrder(input) {
      failIfSet(failures, "createOrder");
      calls.createOrder(input);
      const item = orderFixture("DRAFT", { id: "created-order-internal", orderNumber: "PO-NEW" });
      orders.push(item);
      return item;
    },
    async approveOrder(id) {
      failIfSet(failures, "approveOrder");
      calls.approve(id);
      const index = orders.findIndex((order) => order.id === id);
      const current = orders[index];
      if (index < 0 || !current) throw new Error("NOT_FOUND");
      const item = orderFixture("APPROVED", { ...current, status: "APPROVED", capabilities: orderFixture("APPROVED").capabilities });
      orders[index] = item;
      return item;
    },
    async cancelOrder(id) {
      failIfSet(failures, "cancelOrder");
      calls.cancel(id);
      const index = orders.findIndex((order) => order.id === id);
      const current = orders[index];
      if (index < 0 || !current) throw new Error("NOT_FOUND");
      const item = orderFixture("CANCELLED", { ...current, status: "CANCELLED", capabilities: orderFixture("CANCELLED").capabilities });
      orders[index] = item;
      return item;
    },
    async recordReceipt(input) {
      failIfSet(failures, "recordReceipt");
      calls.receipt(input);
      return {
        id: "receipt-internal-id",
        receiptNumber: "REC-100",
        receivedAt: "2026-08-14T10:00:00Z",
        lines: input.lines,
      };
    },
    async getEventProcurement() {
      failIfSet(failures, "getEventProcurement");
      return eventSummary;
    },
  };

  return { source, suppliers, orders, access, eventSummary, failures, calls };
}
