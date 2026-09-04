import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => rpc(name, args) },
}));

import {
  eventProcurementOpsQueryKey,
  eventTeamSheetQueryKey,
  eventWorkOrderQueryKey,
  payrollPeriodQueryKey,
  useEventProcurementOpsLines,
  useEventTeamSheet,
  useEventWorkOrderHeader,
  usePayrollPeriodSheet,
} from "./documents.api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
});

describe("operational document read-models — server projection calls", () => {
  it("fetches the team sheet through the org-scoped RPC", async () => {
    rpc.mockResolvedValue({ data: [{ staff_member_id: "s1" }], error: null });
    const { result } = renderHook(
      () => useEventTeamSheet("org-1", "event-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("event_team_sheet", {
      p_org_id: "org-1",
      p_event_id: "event-1",
    });
    expect(result.current.data).toEqual([{ staff_member_id: "s1" }]);
  });

  it("stays disabled without organization or event (no unscoped fetch)", () => {
    renderHook(() => useEventTeamSheet("org-1", null), { wrapper });
    renderHook(() => useEventTeamSheet(null, "event-1"), { wrapper });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("unwraps the work order header to a single row or null", async () => {
    rpc.mockResolvedValueOnce({ data: [{ event_number: "EV-1" }], error: null });
    const { result } = renderHook(
      () => useEventWorkOrderHeader("org-1", "event-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("event_work_order_header", {
      p_org_id: "org-1",
      p_event_id: "event-1",
    });
    expect(result.current.data).toEqual({ event_number: "EV-1" });

    rpc.mockResolvedValueOnce({ data: [], error: null });
    const empty = renderHook(
      () => useEventWorkOrderHeader("org-1", "event-2"),
      { wrapper },
    );
    await waitFor(() => expect(empty.result.current.isSuccess).toBe(true));
    // An empty projection means "no visibility / no record" — never zeros.
    expect(empty.result.current.data).toBeNull();
  });

  it("propagates server refusals instead of rendering an empty document", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "NOT_AUTHORIZED" } });
    const { result } = renderHook(
      () => useEventProcurementOpsLines("org-1", "event-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("fetches the payroll period sheet with its exact date range", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => usePayrollPeriodSheet("org-1", "2026-09-01", "2026-09-30"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("payroll_period_sheet", {
      p_org_id: "org-1",
      p_from: "2026-09-01",
      p_to: "2026-09-30",
    });
  });

  it("keys every document query by organization so a tenant switch can never reuse rows", () => {
    expect(eventTeamSheetQueryKey("org-a", "e1")).not.toEqual(
      eventTeamSheetQueryKey("org-b", "e1"),
    );
    expect(eventWorkOrderQueryKey("org-a", "e1")).not.toEqual(
      eventWorkOrderQueryKey("org-b", "e1"),
    );
    expect(eventProcurementOpsQueryKey("org-a", "e1")).not.toEqual(
      eventProcurementOpsQueryKey("org-b", "e1"),
    );
    expect(payrollPeriodQueryKey("org-a", "2026-09-01", "2026-09-30")).not.toEqual(
      payrollPeriodQueryKey("org-b", "2026-09-01", "2026-09-30"),
    );
    // A different period is a different document.
    expect(payrollPeriodQueryKey("org-a", "2026-09-01", "2026-09-30")).not.toEqual(
      payrollPeriodQueryKey("org-a", "2026-08-01", "2026-08-31"),
    );
  });
});
