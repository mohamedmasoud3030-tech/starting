/**
 * Regression tests for attendance mutation invalidation.
 *
 * CONFIRMED DEFECT: the operational dashboard's "attendance gaps" alert
 * reads the `["attendance-gaps", orgId]` key (RPC today_attendance_gaps).
 * Recording attendance CLOSES a gap and voiding it REOPENS one, but neither
 * mutation refreshed that key — the Home screen kept alerting the owner
 * about a gap that had already been fixed (or hid one that had reappeared)
 * until an unrelated refetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordAttendance, useVoidAttendance } from "./staff.api";

vi.mock("@/lib/rpc", () => ({
  callRpc: vi.fn().mockResolvedValue({ id: "attendance-1" }),
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

describe("attendance mutations refresh the dashboard gap count", () => {
  it("useRecordAttendance refreshes attendance-gaps alongside the event read models", async () => {
    const { result } = renderHook(() => useRecordAttendance(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({
      staffMemberId: "staff-1",
      assignmentId: null,
      attendanceDate: "2026-08-16",
      shift: "MORNING",
      checkIn: null,
      checkOut: null,
      breakMinutes: 0,
      status: "PRESENT",
      wageMethod: "PER_EVENT",
      wageRateMilli: 10_000,
      notes: "",
    });

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["attendance-gaps", ORG]);
    expect(keys).toContainEqual(["event-attendance", ORG, EVENT]);
    expect(keys).toContainEqual(["event-payroll", ORG, EVENT]);
    expect(keys).toContainEqual(["org-payroll-archive", ORG]);
  });

  it("useVoidAttendance refreshes attendance-gaps alongside the event read models", async () => {
    const { result } = renderHook(() => useVoidAttendance(ORG, EVENT), { wrapper });
    await result.current.mutateAsync({ attendanceId: "attendance-1", reason: "خطأ إدخال" });

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["attendance-gaps", ORG]);
    expect(keys).toContainEqual(["event-attendance", ORG, EVENT]);
  });
});
