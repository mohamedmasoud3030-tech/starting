import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ManagementAlert } from "./intelligence.api";
import { ManagementDashboard } from "./ManagementDashboard";

/**
 * Management dashboard (لوحة الإدارة) — attention queue + server-computed KPIs.
 *
 * Pins the honesty rules the owner relies on: every figure comes from the
 * canonical SQL projection, revenue / collected / outstanding / cost / profit
 * stay distinct and drillable, an empty attention queue says so plainly, and
 * the money block is gated by cost visibility.
 */

const state = vi.hoisted(() => ({
  canReadCost: true,
  alerts: [] as ManagementAlert[],
  metrics: null as Record<string, unknown> | null,
  alertsLoading: false,
  metricsLoading: false,
  metricsError: null as unknown,
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canReadCost: state.canReadCost,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("./intelligence.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intelligence.api")>();
  return {
    ...actual,
    useManagementAlerts: () => ({
      data: state.alerts,
      isLoading: state.alertsLoading,
    }),
    useManagementMetrics: () => ({
      data: state.metrics,
      isLoading: state.metricsLoading,
      error: state.metricsError,
      refetch: () => {},
    }),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderDashboard() {
  return render(<ManagementDashboard />, { wrapper });
}

function alert(overrides: Partial<ManagementAlert> = {}): ManagementAlert {
  return {
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
    ...overrides,
  };
}

function metrics(overrides: Record<string, unknown> = {}) {
  return {
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
    avg_quote_value: 400_000,
    top_packages: [{ name: "باقة القهوة", count: 2 }],
    revenue: 1_250_000,
    collected: 800_000,
    outstanding: 450_000,
    actual_cost: 600_000,
    gross_profit: 650_000,
    margin_percent: 52,
    financially_open_completed: 1,
    overdue_balance: 100_000,
    ready_to_close: 1,
    close_blocked: 1,
    ...overrides,
  };
}

beforeEach(() => {
  state.canReadCost = true;
  state.alerts = [];
  state.metrics = null;
  state.alertsLoading = false;
  state.metricsLoading = false;
  state.metricsError = null;
});

describe("ManagementDashboard — attention queue", () => {
  it("says plainly when nothing needs intervention", () => {
    state.metrics = metrics();
    renderDashboard();
    expect(screen.getByText("لا توجد عناصر تحتاج تدخلاً الآن.")).toBeInTheDocument();
  });

  it("shows a progress line while the alert scan runs", () => {
    state.alertsLoading = true;
    state.metrics = metrics();
    renderDashboard();
    expect(screen.getByText("جارٍ فحص التنبيهات…")).toBeInTheDocument();
  });

  it("surfaces each alert with its Arabic severity and a drill-down link", () => {
    state.metrics = metrics();
    state.alerts = [
      alert({ severity: "CRITICAL", title: "مناسبة — الفريق ناقص 2" }),
      alert({ severity: "INFO", entity_id: "evt-2", title: "عرض ينتهي قريباً", destination: "/quotes" }),
    ];
    renderDashboard();

    expect(screen.getByText("مناسبة — الفريق ناقص 2")).toBeInTheDocument();
    expect(screen.getByText("حرج")).toBeInTheDocument();
    expect(screen.getByText("معلومة")).toBeInTheDocument();
    expect(screen.getByText("عرض ينتهي قريباً")).toBeInTheDocument();

    const queue = screen.getByRole("region", { name: "ما يحتاج انتباهي" });
    expect(within(queue).getAllByRole("link")[0]).toHaveAttribute("href", "/events/evt-1");
  });

  it("never labels an alert with a raw English severity", () => {
    state.metrics = metrics();
    state.alerts = [alert({ severity: "WARNING" })];
    renderDashboard();

    expect(screen.getByText("تنبيه")).toBeInTheDocument();
    expect(screen.queryByText("WARNING")).not.toBeInTheDocument();
  });
});

describe("ManagementDashboard — KPIs", () => {
  it("keeps revenue / collected / outstanding / cost / profit as distinct numbers", async () => {
    state.alerts = [alert()];
    state.metrics = metrics();
    renderDashboard();

    expect(await screen.findByText("مناسبة — الفريق ناقص 2")).toBeInTheDocument();

    const finance = (await screen.findByRole("heading", { name: "المالية" })).closest("div") as HTMLElement;
    expect(within(finance).getByText("1250.000 ر.ع.")).toBeInTheDocument();
    expect(within(finance).getByText("800.000 ر.ع.")).toBeInTheDocument();
    expect(within(finance).getByText("450.000 ر.ع.")).toBeInTheDocument();
    expect(within(finance).getByText("600.000 ر.ع.")).toBeInTheDocument();
    expect(within(finance).getByText("650.000 ر.ع.")).toBeInTheDocument();
    expect(within(finance).getByText("100.000 ر.ع.")).toBeInTheDocument();
  });

  it("renders the margin and quote conversion as percentages", async () => {
    state.metrics = metrics();
    renderDashboard();

    expect(await screen.findByText("52.0%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("lists the most-used packages with their counts", async () => {
    state.metrics = metrics();
    renderDashboard();

    const block = (await screen.findByText("الباقات الأكثر استخداماً")).parentElement as HTMLElement;
    expect(within(block).getByText("باقة القهوة")).toBeInTheDocument();
    expect(within(block).getByText("2")).toBeInTheDocument();
  });

  it("sends the owner to the operational and reporting sources", async () => {
    state.metrics = metrics();
    renderDashboard();

    const todayLinks = await screen.findAllByRole("link", { name: /مناسبات اليوم/ });
    expect(todayLinks.map((l) => l.getAttribute("href"))).toContain("/operations");
    const outstandingKpi = screen.getByRole("link", { name: /متبقٍ \(ذمم\)/ });
    expect(outstandingKpi).toHaveAttribute("href", "/reports");
    expect(screen.getByRole("link", { name: /ربح الفترة/ })).toHaveAttribute("href", "/reports");
  });

  it("shows a retryable error instead of invented KPIs when metrics fail", () => {
    state.metricsError = new Error("boom");
    renderDashboard();

    expect(screen.getByText("تعذّر تحميل المؤشرات")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
  });
});

describe("ManagementDashboard — cost visibility", () => {
  it("hides the whole financial block from a role without cost visibility", async () => {
    state.canReadCost = false;
    // Mirrors the RPC exactly: without cost.visibility (0071) every financial
    // column comes back NULL, so the page must read "—" — never a number.
    state.metrics = metrics({
      revenue: null,
      collected: null,
      outstanding: null,
      actual_cost: null,
      gross_profit: null,
      overdue_balance: null,
      margin_percent: null,
    });
    renderDashboard();

    // Operational reading still works.
    expect(await screen.findByRole("heading", { name: "التشغيل" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "المبيعات" })).toBeInTheDocument();
    // No financial detail block at all.
    expect(screen.queryByRole("heading", { name: "المالية" })).not.toBeInTheDocument();
    // And not a single monetary figure anywhere on the page.
    expect(screen.queryByText(/ر\\.ع\\./)).not.toBeInTheDocument();
  });

  /**
   * Regression guard for a real defect: `management_metrics` (0071) leaves the
   * financial columns NULL for a caller without `cost.visibility`, and the hook
   * used to coerce that NULL to 0 — rendering a fabricated «0.000 ر.ع.» as if
   * it were a verified figure. An unreadable amount must read «—».
   */
  it("never turns an unreadable amount into a fabricated zero", async () => {
    state.canReadCost = false;
    state.metrics = metrics({
      revenue: null,
      collected: null,
      outstanding: null,
      actual_cost: null,
      gross_profit: null,
      overdue_balance: null,
      margin_percent: null,
    });
    renderDashboard();

    await screen.findByRole("heading", { name: "التشغيل" });

    // The money-bearing KPI cards state "not readable", not "zero".
    expect(within(screen.getByRole("link", { name: /متبقٍ \(ذمم\)/ })).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /ربح الفترة/ })).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.000 ر.ع.")).not.toBeInTheDocument();
  });

  it("still shows a genuine zero when the server really returned zero", async () => {
    state.metrics = metrics({ revenue: 0, outstanding: 0, gross_profit: 0 });
    renderDashboard();

    const finance = (await screen.findByRole("heading", { name: "المالية" })).closest("div") as HTMLElement;
    expect(within(finance).getAllByText("0.000 ر.ع.").length).toBeGreaterThanOrEqual(3);
  });
});
