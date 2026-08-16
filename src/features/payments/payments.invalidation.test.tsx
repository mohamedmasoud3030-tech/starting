/**
 * Regression tests for payment mutation invalidation.
 *
 * CONFIRMED DEFECT: `invoice_summaries.paid_total` / `remaining_balance` and
 * each installment's derived `effective_status` are computed from RECORDED
 * customer payments (migration 0043) — the payments ledger is the single
 * money source of truth. Recording or voiding a payment therefore changes
 * the INVOICE read models, but the mutations only refreshed
 * `event-payments` + `event-finance`, leaving the invoice panel showing a
 * stale paid/remaining until an unrelated refetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordPayment, useVoidPayment } from "./payments.api";

vi.mock("@/lib/rpc", () => ({
  callRpc: vi.fn().mockResolvedValue({ id: "payment-1" }),
}));

const ORG = "org-1";
const EVENT = "event-1";

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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
});

const EXPECTED_KEYS = [
  ["event-payments", ORG, EVENT],
  ["event-finance", ORG, EVENT],
  ["event-invoice", ORG, EVENT],
  ["event-installments", ORG, EVENT],
];

describe("payment mutations refresh every ledger-derived read model", () => {
  it("useRecordPayment refreshes payments, finance, invoice and installments", async () => {
    const { result } = renderHook(() => useRecordPayment(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({
      amountMilli: 100_000,
      method: "CASH",
      reference: "",
      notes: "",
    });

    const keys = invalidatedKeys();
    for (const expected of EXPECTED_KEYS) {
      expect(keys).toContainEqual(expected);
    }
  });

  it("useVoidPayment refreshes payments, finance, invoice and installments", async () => {
    const { result } = renderHook(() => useVoidPayment(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({ paymentId: "payment-1", reason: "خطأ" });

    const keys = invalidatedKeys();
    for (const expected of EXPECTED_KEYS) {
      expect(keys).toContainEqual(expected);
    }
  });
});
