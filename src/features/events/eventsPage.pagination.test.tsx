import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEventsPage } from "./events.api";

const state = vi.hoisted(() => ({
  ranges: [] as Array<[number, number]>,
  rows: [] as Array<Record<string, unknown>>,
  total: 0,
}));

const range = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ range }) }) }),
    }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEventsPage (D21)", () => {
  beforeEach(() => {
    state.rows = [];
    state.total = 0;
    state.ranges = [];
    range.mockClear();
    range.mockImplementation((from: number, to: number) =>
      Promise.resolve({
        data: state.rows.slice(from, to + 1),
        error: null,
        count: state.total,
      }),
    );
  });

  it("loads the first page and reports more rows when the total exceeds it", async () => {
    state.rows = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, start_at: "2026-08-20T10:00:00+04:00" }));
    state.total = 120;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(range).toHaveBeenCalledWith(0, 49);
    expect(result.current.data?.rows).toHaveLength(50);
    expect(result.current.hasMore).toBe(true);
  });

  it("loadMore fetches the next slice and stops reporting more at the total", async () => {
    state.rows = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}` }));
    state.total = 60;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(range).toHaveBeenLastCalledWith(0, 99));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.data?.rows).toHaveLength(60);
  });
});
