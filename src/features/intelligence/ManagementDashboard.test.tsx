import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManagementDashboard } from "./ManagementDashboard";

// Mock auth + supabase; the dashboard is a thin consumer of the canonical RPCs.
vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canReadCost: true,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (name: string) => {
      if (name === "management_alerts") {
        return {
          data: [
            {
              alert_type: "EVENT_STAFF_SHORTAGE",
              severity: "WARNING",
              entity_type: "event",
              entity_id: "evt-1",
              title: "مناسبة — الفريق ناقص 2",
              explanation: "الجاهزية غير مكتملة",
              destination: "/events/evt-1",
              event_id: "evt-1",
              customer_id: null,
              detected_at: "2026-08-18T00:00:00Z",
            },
          ],
          error: null,
        };
      }
      if (name === "management_metrics") {
        return {
          data: [
            {
              events_today: 3,
              events_tomorrow: 1,
              events_week: 7,
              confirmed_upcoming: 2,
              events_preparing: 1,
              events_in_progress: 1,
              events_waiting_return: 1,
              events_low_readiness: 1,
              quotes_draft: 2,
              quotes_waiting: 1,
              quotes_accepted: 1,
              quotes_expired: 0,
              quotes_rejected: 0,
              quote_conversion_rate: 50,
              avg_quote_value: 400,
              top_packages: [{ name: "باقة القهوة", count: 2 }],
              revenue: 1250,
              collected: 800,
              outstanding: 450,
              actual_cost: 600,
              gross_profit: 650,
              margin_percent: 52,
              financially_open_completed: 1,
              overdue_balance: 100,
              ready_to_close: 1,
              close_blocked: 1,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("ManagementDashboard", () => {
  it("surfaces the attention queue and keeps revenue/collected/outstanding separate", async () => {
    render(<ManagementDashboard />, { wrapper });

    // Attention queue (E2).
    expect(await screen.findByText(/الفريق ناقص 2/)).toBeInTheDocument();

    // KPIs (E1) — outstanding and profit are distinct, drillable numbers.
    expect(await screen.findAllByText(/450\.000/)).not.toHaveLength(0); // outstanding
    expect(screen.getAllByText(/650\.000/)).not.toHaveLength(0); // profit
  });
});
