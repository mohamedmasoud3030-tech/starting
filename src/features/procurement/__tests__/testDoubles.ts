import { vi } from "vitest";
import type {
  EventProcurementSummary,
  ProcurementAccess,
  ProcurementConsumableOption,
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

export const consumableOptions: ProcurementConsumableOption[] = [
  { id: "catalog-consumable-coffee", name: "قهوة عمانية", unit: "كجم" },
  { id: "catalog-consumable-water", name: "مياه معدنية", unit: "كرتون" },
];

export function supplierFixture(overrides: Partial<SupplierDetail> = {}): SupplierDetail {
  return {
    id: "supplier-internal-id",
    name: "مؤسسة النخبة للضيافة",
    kind: "CATERING_RESTAURANT",
    phone: "+968 9000 1111",
    whatsapp: "+968 9000 1111",
    email: "info@nokhba.om",
    commercialRegistrationNumber: "CR-12345",
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
  const receivable = ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(status);
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
      send: status === "APPROVED" ? allowed : denied,
      confirm: status === "SENT" ? allowed : denied,
      cancel: ["DRAFT", "APPROVED", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(status) ? allowed : denied,
      receive: receivable ? allowed : denied,
    },
    notes: "التسليم صباحاً",
    lines: [
      {
        id: "line-consumable-internal",
        description: "قهوة عمانية",
        kind: "CONSUMABLE",
        catalogItemId: "catalog-consumable-coffee",
        unit: "كجم",
        orderedQuantityMilli: 10_000,
        receivedQuantityMilli: status === "PARTIALLY_RECEIVED" ? 4_000 : status === "RECEIVED" ? 10_000 : 0,
        remainingQuantityMilli: status === "PARTIALLY_RECEIVED" ? 6_000 : status === "RECEIVED" ? 0 : 10_000,
        unitCostMilli: 1_235,
        lineTotalMilli: 12_350,
        receive: receivable ? allowed : denied,
      },
      {
        id: "line-service-internal",
        description: "خدمة تقديم القهوة",
        kind: "CATERING_SERVICE",
        catalogItemId: null,
        unit: "خدمة",
        orderedQuantityMilli: 1_000,
        receivedQuantityMilli: 0,
        remainingQuantityMilli: 1_000,
        unitCostMilli: 20_000,
        lineTotalMilli: 20_000,
        receive: receivable ? allowed : denied,
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
  consumables: ProcurementConsumableOption[];
  access: ProcurementAccess;
  eventSummary: EventProcurementSummary;
  failures: Partial<Record<keyof ProcurementDataSource, unknown>>;
  calls: {
    receipt: ReturnType<typeof vi.fn>;
    createSupplier: ReturnType<typeof vi.fn>;
    updateSupplier: ReturnType<typeof vi.fn>;
    deactivateSupplier: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
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
  consumables?: ProcurementConsumableOption[];
  access?: ProcurementAccess;
  eventSummary?: EventProcurementSummary;
}): TestSourceControls {
  const suppliers = options?.suppliers ?? [supplierFixture()];
  const orders = options?.orders ?? [orderFixture()];
  const consumables = options?.consumables ?? [...consumableOptions];
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
    deactivateSupplier: vi.fn(),
    approve: vi.fn(),
    send: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    createOrder: vi.fn(),
  };

  function replaceOrder(id: string, status: ProcurementOrderStatus): ProcurementOrderDetail {
    const index = orders.findIndex((order) => order.id === id);
    const current = orders[index];
    if (index < 0 || !current) throw new Error("NOT_FOUND");
    const item = orderFixture(status, {
      ...current,
      status,
      capabilities: orderFixture(status).capabilities,
      lines: current.lines.map((line) => ({
        ...line,
        receive: orderFixture(status).lines.find((candidate) => candidate.kind === line.kind)?.receive ?? denied,
      })),
    });
    orders[index] = item;
    return item;
  }

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
        whatsapp: input.whatsapp ?? null,
        email: input.email ?? null,
        commercialRegistrationNumber: input.commercialRegistrationNumber ?? null,
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
      const item = {
        ...current,
        name: input.name,
        kind: input.kind,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        email: input.email ?? null,
        commercialRegistrationNumber: input.commercialRegistrationNumber ?? null,
        contactName: input.contactName,
        notes: input.notes,
      };
      suppliers[index] = item;
      return item;
    },
    async deactivateSupplier(id, idempotencyKey) {
      failIfSet(failures, "deactivateSupplier");
      calls.deactivateSupplier(id, idempotencyKey);
      const index = suppliers.findIndex((supplier) => supplier.id === id);
      const current = suppliers[index];
      if (index < 0 || !current) throw new Error("NOT_FOUND");
      const item = { ...current, status: "INACTIVE" as const };
      suppliers[index] = item;
      return item;
    },
    async listConsumableOptions() {
      failIfSet(failures, "listConsumableOptions");
      return consumables;
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
    async approveOrder(id, idempotencyKey) {
      failIfSet(failures, "approveOrder");
      calls.approve(id, idempotencyKey);
      return replaceOrder(id, "APPROVED");
    },
    async sendOrder(id, idempotencyKey) {
      failIfSet(failures, "sendOrder");
      calls.send(id, idempotencyKey);
      return replaceOrder(id, "SENT");
    },
    async confirmOrder(id, idempotencyKey) {
      failIfSet(failures, "confirmOrder");
      calls.confirm(id, idempotencyKey);
      return replaceOrder(id, "CONFIRMED");
    },
    async cancelOrder(id, reason, idempotencyKey) {
      failIfSet(failures, "cancelOrder");
      calls.cancel(id, reason, idempotencyKey);
      return replaceOrder(id, "CANCELLED");
    },
    async recordReceipt(input) {
      failIfSet(failures, "recordReceipt");
      calls.receipt(input);
      return {
        id: "receipt-internal-id",
        receiptNumber: "REC-100",
        receivedAt: input.receivedAt,
        lines: input.lines,
      };
    },
    async getEventProcurement() {
      failIfSet(failures, "getEventProcurement");
      return eventSummary;
    },
  };

  return { source, suppliers, orders, consumables, access, eventSummary, failures, calls };
}
