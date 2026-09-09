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
      select: () => ({
        eq: () => ({ order: () => ({ order: () => ({ range }) }) }),
      }),
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

  it("loads the first page with an exact total and stable ordering", async () => {
    state.rows = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, start_at: "2026-08-20T10:00:00+04:00" }));
    state.total = 120;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(range).toHaveBeenCalledWith(0, 49);
    expect(result.current.data?.rows).toHaveLength(50);
    expect(result.current.page).toBe(0);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.hasPreviousPage).toBe(false);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("nextPage fetches the following 50-row window and stops at the last page", async () => {
    state.rows = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}` }));
    state.total = 120;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.nextPage();
    });
    await waitFor(() => expect(range).toHaveBeenLastCalledWith(50, 99));
    await waitFor(() => expect(result.current.page).toBe(1));

    act(() => {
      result.current.nextPage();
    });
    await waitFor(() => expect(range).toHaveBeenLastCalledWith(100, 149));
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));

    act(() => {
      result.current.nextPage();
    });
    await waitFor(() => expect(result.current.page).toBe(2));
  });

  it("previousPage returns to earlier windows and clamps at the first page", async () => {
    state.rows = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}` }));
    state.total = 120;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(result.current.page).toBe(2));

    act(() => {
      result.current.previousPage();
    });
    await waitFor(() => expect(range).toHaveBeenLastCalledWith(50, 99));
    expect(result.current.page).toBe(1);
    expect(result.current.hasPreviousPage).toBe(true);

    act(() => {
      result.current.previousPage();
    });
    await waitFor(() => expect(result.current.page).toBe(0));

    act(() => {
      result.current.previousPage();
    });
    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.hasPreviousPage).toBe(false);
  });

  it("goToPage clamps out-of-range targets to the last valid page", async () => {
    state.rows = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}` }));
    state.total = 120;

    const { result } = renderHook(() => useEventsPage("org-1", 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.goToPage(42);
    });
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(range).toHaveBeenLastCalledWith(100, 149);

    act(() => {
      result.current.goToPage(-3);
    });
    await waitFor(() => expect(result.current.page).toBe(0));
  });
});
