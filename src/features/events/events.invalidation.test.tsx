/**
 * Regression tests for event mutation invalidation.
 *
 * CONFIRMED DEFECT: the operational dashboard reads readiness through the
 * STANDALONE `["event-readiness", org, event]` key (`eventReadinessQuery`),
 * not through the workspace aggregate. Workspace commands that change
 * readiness (assign staff, reserve equipment, transitions) only refreshed
 * the aggregate + event keys, so the Home dashboard kept showing stale
 * readiness for up to `staleTime` after the operator fixed a shortage.
 *
 * Also pins:
 *  - tenant scope: every invalidated key carries the org id (PR #23 isolation),
 *  - conversion refresh: converting a prospect quotation CREATES a customer
 *    row (migration 0051), so the customers list must be refreshed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEventCommand } from "./events.api";
import { useConvertQuotation } from "@/features/quotes/quotes.api";

vi.mock("@/lib/rpc", () => ({
  callRpc: vi.fn().mockResolvedValue({ id: "row-1" }),
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

describe("useEventCommand invalidation", () => {
  it("refreshes the standalone readiness key used by the operational dashboard", async () => {
    const { result } = renderHook(() => useEventCommand(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({
      name: "assign_event_staff",
      args: { p_staff_member_id: "staff-1" },
    });

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["event-readiness", ORG, EVENT]);
    // The workspace aggregate and list refreshes must be preserved.
    expect(keys).toContainEqual(["event-workspace", ORG, EVENT]);
    expect(keys).toContainEqual(["event", ORG, EVENT]);
    expect(keys).toContainEqual(["events", ORG]);
  });

  it("keeps every invalidated key organization-scoped (tenant isolation)", async () => {
    const { result } = renderHook(() => useEventCommand(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({
      name: "transition_event_status",
      args: { p_to: "PREPARING", p_reason: null },
    });

    for (const key of invalidatedKeys()) {
      expect(key).toContain(ORG);
    }
  });
});

describe("useConvertQuotation invalidation", () => {
  it("refreshes the customers list because conversion can create a customer", async () => {
    const { result } = renderHook(() => useConvertQuotation(ORG), { wrapper });
    await result.current.mutateAsync({ quotationId: "q-1" });

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["customers", ORG]);
    expect(keys).toContainEqual(["events", ORG]);
    expect(keys).toContainEqual(["quotations", ORG]);
  });
});
