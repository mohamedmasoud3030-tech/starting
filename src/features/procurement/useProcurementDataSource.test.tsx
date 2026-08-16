/**
 * Regression tests for cross-feature cache synchronisation.
 *
 * CONFIRMED DEFECT: procurement commands change server truth that OTHER
 * features read through TanStack Query, but the procurement feature (which
 * deliberately manages its own reload cycle) never told the query cache:
 *
 *  - receiving a CONSUMABLE order line records an authoritative stock IN
 *    movement (migration 0030) → `consumable_stock_summary` changes, yet the
 *    central stock screen kept serving its stale cached quantity;
 *  - lifecycle changes / receipts on an event-linked order change
 *    `event_finance_summaries.committed_cost` / `delivered_cost`
 *    (migration 0037), yet the event finance panel was never refreshed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProcurementOrderDetail } from "./contracts";
import { useProcurementDataSource } from "./useProcurementDataSource";
import { createSupabaseProcurementDataSource } from "./supabaseDataSource";

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "منشأة الاختبار" },
    currentRole: "OWNER",
  }),
}));

vi.mock("./supabaseDataSource", () => ({
  createSupabaseProcurementDataSource: vi.fn(),
}));

function orderDetail(overrides: Partial<ProcurementOrderDetail> = {}): ProcurementOrderDetail {
  return {
    id: "order-1",
    orderNumber: "PO-1",
    supplier: { id: "sup-1", name: "مورد" },
    event: { id: "event-9", title: "مناسبة", eventNumber: "EV-9" },
    orderedAt: "2026-08-16T08:00:00Z",
    deliveryDueAt: null,
    status: "CONFIRMED",
    negotiatedTotalMilli: null,
    outstandingDeliveryCount: 1,
    capabilities: {
      approve: { allowed: false },
      send: { allowed: false },
      confirm: { allowed: false },
      cancel: { allowed: false },
      receive: { allowed: true },
    },
    notes: null,
    lines: [
      {
        id: "line-1",
        description: "قهوة",
        kind: "CONSUMABLE",
        unit: "كجم",
        orderedQuantityMilli: 5000,
        receivedQuantityMilli: 0,
        remainingQuantityMilli: 5000,
        receive: { allowed: true },
      },
    ],
    receipts: [],
    ...overrides,
  };
}

const innerSource = {
  getAccess: vi.fn(),
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deactivateSupplier: vi.fn(),
  listConsumableOptions: vi.fn(),
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  createOrder: vi.fn(),
  approveOrder: vi.fn(),
  sendOrder: vi.fn(),
  confirmOrder: vi.fn(),
  cancelOrder: vi.fn(),
  recordReceipt: vi.fn(),
  getEventProcurement: vi.fn(),
};

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function invalidatedKeys(): unknown[][] {
  return invalidateSpy.mock.calls.map(
    (call: unknown[]) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSupabaseProcurementDataSource).mockReturnValue(
    innerSource as never,
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
});

describe("useProcurementDataSource — cross-feature cache sync", () => {
  it("refreshes consumable stock and event finance after receiving a consumable line", async () => {
    innerSource.recordReceipt.mockResolvedValue({
      id: "receipt-1",
      receivedAt: "2026-08-16T09:00:00Z",
      lines: [{ orderLineId: "line-1", quantityMilli: 5000 }],
    });
    innerSource.getOrder.mockResolvedValue(orderDetail());

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.recordReceipt({
      orderId: "order-1",
      receivedAt: "2026-08-16T09:00:00Z",
      reference: null,
      notes: null,
      lines: [{ orderLineId: "line-1", quantityMilli: 5000 }],
      idempotencyKey: "key-1",
    });

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["consumable-stock", "org-1"]);
    expect(keys).toContainEqual(["event-finance", "org-1", "event-9"]);
  });

  it("does not touch consumable stock for a receipt without consumable lines", async () => {
    innerSource.recordReceipt.mockResolvedValue({
      id: "receipt-2",
      receivedAt: "2026-08-16T09:00:00Z",
      lines: [],
    });
    innerSource.getOrder.mockResolvedValue(
      orderDetail({
        lines: [
          {
            id: "line-svc",
            description: "خدمة ضيافة",
            kind: "CATERING_SERVICE",
            unit: "خدمة",
            orderedQuantityMilli: 1000,
            receivedQuantityMilli: 0,
            remainingQuantityMilli: 1000,
            receive: { allowed: true },
          },
        ],
      }),
    );

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.recordReceipt({
      orderId: "order-1",
      receivedAt: "2026-08-16T09:00:00Z",
      reference: null,
      notes: null,
      lines: [{ orderLineId: "line-svc", quantityMilli: 1000 }],
      idempotencyKey: "key-2",
    });

    const keys = invalidatedKeys();
    expect(keys).not.toContainEqual(["consumable-stock", "org-1"]);
    expect(keys).toContainEqual(["event-finance", "org-1", "event-9"]);
  });

  it("refreshes stock AND org-wide event finance when the order cannot be re-read after a receipt", async () => {
    // The receipt is committed server-side BEFORE the follow-up getOrder
    // lookup, and it may have changed event_finance_summaries.delivered_cost
    // for an event we can no longer identify. The fallback must therefore
    // refresh stock and prefix-invalidate ["event-finance", orgId] — never
    // leave a stale delivered cost presented as fact.
    innerSource.recordReceipt.mockResolvedValue({
      id: "receipt-3",
      receivedAt: "2026-08-16T09:00:00Z",
      lines: [{ orderLineId: "line-1", quantityMilli: 1000 }],
    });
    innerSource.getOrder.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    const receipt = await result.current!.recordReceipt({
      orderId: "order-1",
      receivedAt: "2026-08-16T09:00:00Z",
      reference: null,
      notes: null,
      lines: [{ orderLineId: "line-1", quantityMilli: 1000 }],
      idempotencyKey: "key-3",
    });

    // The receipt itself must not fail…
    expect(receipt.id).toBe("receipt-3");
    const keys = invalidatedKeys();
    // …stock must still be refreshed rather than risk a stale quantity…
    expect(keys).toContainEqual(["consumable-stock", "org-1"]);
    // …and event finance must be refreshed org-wide (prefix key, no event id).
    expect(keys).toContainEqual(["event-finance", "org-1"]);
  });

  it("prefix-invalidates every cached event-finance entry of the tenant in the fallback", async () => {
    // Prove the prefix semantics end-to-end: a concrete per-event
    // ["event-finance", org, event] cache entry must be marked invalidated
    // by the org-wide ["event-finance", org] fallback invalidation.
    queryClient.setQueryData(["event-finance", "org-1", "event-9"], {
      eventId: "event-9",
      deliveredCostMilli: 0,
    });
    innerSource.recordReceipt.mockResolvedValue({
      id: "receipt-4",
      receivedAt: "2026-08-16T09:00:00Z",
      lines: [{ orderLineId: "line-1", quantityMilli: 1000 }],
    });
    innerSource.getOrder.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.recordReceipt({
      orderId: "order-1",
      receivedAt: "2026-08-16T09:00:00Z",
      reference: null,
      notes: null,
      lines: [{ orderLineId: "line-1", quantityMilli: 1000 }],
      idempotencyKey: "key-4",
    });

    const state = queryClient.getQueryState(["event-finance", "org-1", "event-9"]);
    expect(state?.isInvalidated).toBe(true);
  });

  it.each(["approveOrder", "sendOrder", "confirmOrder"] as const)(
    "refreshes event finance after %s on an event-linked order",
    async (method) => {
      innerSource[method].mockResolvedValue(orderDetail());

      const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
      await result.current![method]("order-1", "key-x");

      expect(invalidatedKeys()).toContainEqual(["event-finance", "org-1", "event-9"]);
    },
  );

  it("refreshes event finance after cancelOrder on an event-linked order", async () => {
    innerSource.cancelOrder.mockResolvedValue(orderDetail());

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.cancelOrder("order-1", "سبب واضح", "key-c");

    expect(invalidatedKeys()).toContainEqual(["event-finance", "org-1", "event-9"]);
  });

  it("does not invalidate event finance for an order with no event linkage", async () => {
    innerSource.approveOrder.mockResolvedValue(orderDetail({ event: null }));

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.approveOrder("order-1", "key-y");

    expect(
      invalidatedKeys().filter((k) => k[0] === "event-finance"),
    ).toHaveLength(0);
  });

  it("passes the idempotency key through unchanged to the inner command", async () => {
    innerSource.approveOrder.mockResolvedValue(orderDetail());

    const { result } = renderHook(() => useProcurementDataSource(), { wrapper });
    await result.current!.approveOrder("order-1", "stable-intent-key");

    expect(innerSource.approveOrder).toHaveBeenCalledWith(
      "order-1",
      "stable-intent-key",
    );
  });
});
