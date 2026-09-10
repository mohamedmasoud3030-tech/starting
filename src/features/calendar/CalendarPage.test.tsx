import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarPage } from "./CalendarPage";

/**
 * Calendar (التقويم).
 *
 * Pins the day/month reading rules: the seven Arabic weekday headers, the
 * month/day view switch, the honest empty-day message, that a day's events are
 * listed with both their readiness and their Arabic lifecycle status, and that
 * the page degrades to an error notice instead of a blank grid.
 */

type Row = {
  id: string;
  title: string;
  start_at: string;
  venue_name: string;
  status: string;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  readiness: [] as Array<{ event_id: string; status: string }>,
  isLoading: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ currentOrganization: { id: "org-1", name: "دار الضيافة" } }),
}));

vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/features/events/events.api", () => ({
  useEvents: () => ({
    data: { rows: state.rows },
    isLoading: state.isLoading,
    error: state.error,
    refetch: state.refetch,
  }),
}));

vi.mock("@/lib/rpc", () => ({
  callRpc: async () => state.readiness,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function renderCalendar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

/** An ISO timestamp inside the CURRENT month, at local noon. */
function todayNoonIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

beforeEach(() => {
  state.rows = [];
  state.readiness = [];
  state.isLoading = false;
  state.error = null;
  state.refetch.mockClear();
});

describe("CalendarPage — month grid", () => {
  it("renders the heading, the seven Arabic weekdays and the view switch", () => {
    renderCalendar();

    expect(screen.getByRole("heading", { name: "التقويم" })).toBeInTheDocument();
    for (const day of ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "الشهر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "اليوم" })).toBeInTheDocument();
  });

  it("says honestly that the selected day has no events", () => {
    renderCalendar();
    expect(screen.getByText("لا توجد مناسبات في هذا اليوم.")).toBeInTheDocument();
  });

  it("lists the selected day's events with a link to the workspace", async () => {
    state.rows = [
      { id: "ev-1", title: "حفل زفاف", start_at: todayNoonIso(), venue_name: "قاعة السلام", status: "CONFIRMED" },
    ];
    renderCalendar();

    const link = await screen.findByRole("link", { name: /حفل زفاف/ });
    expect(link).toHaveAttribute("href", "/events/$eventId");
  });
});

describe("CalendarPage — view switch & status", () => {
  it("switches to the day view and keeps showing today's events", async () => {
    state.rows = [
      { id: "ev-1", title: "مؤتمر", start_at: todayNoonIso(), venue_name: "فندق الخليج", status: "PREPARING" },
    ];
    renderCalendar();

    await userEvent.click(screen.getByRole("button", { name: "اليوم" }));

    expect(await screen.findByText("مؤتمر")).toBeInTheDocument();
  });

  it("labels an event with its Arabic lifecycle status, never the raw enum", async () => {
    state.rows = [
      { id: "ev-1", title: "حفل زفاف", start_at: todayNoonIso(), venue_name: "قاعة", status: "CONFIRMED" },
    ];
    renderCalendar();

    expect(await screen.findByText("مؤكدة")).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
  });

  it("shows the readiness chip once the batched readiness resolves", async () => {
    state.rows = [
      { id: "ev-1", title: "حفل زفاف", start_at: todayNoonIso(), venue_name: "قاعة", status: "CONFIRMED" },
    ];
    state.readiness = [{ event_id: "ev-1", status: "READY" }];
    renderCalendar();

    expect(await screen.findByText("جاهزة")).toBeInTheDocument();
  });

  it("shows a not-ready chip for a short event", async () => {
    state.rows = [
      { id: "ev-1", title: "عقيقة", start_at: todayNoonIso(), venue_name: "قاعة", status: "CONFIRMED" },
    ];
    state.readiness = [{ event_id: "ev-1", status: "NOT_READY" }];
    renderCalendar();

    expect(await screen.findByText("غير جاهزة")).toBeInTheDocument();
  });
});

describe("CalendarPage — failure handling", () => {
  it("shows a retryable error instead of an empty grid when loading fails", async () => {
    state.error = new Error("boom");
    renderCalendar();

    expect(screen.getByText("تعذّر تحميل المناسبات")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /إعادة المحاولة/ }));
    expect(state.refetch).toHaveBeenCalled();
  });
});
