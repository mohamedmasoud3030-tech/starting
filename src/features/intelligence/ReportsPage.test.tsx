import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ReportCustomerRow,
  ReportEventRow,
  ReportPackageRow,
} from "./intelligence.api";
import { ReportsPage } from "./ReportsPage";

/**
 * Reports (التقارير).
 *
 * Pins the reporting contract the owner reads money from: revenue / collected /
 * outstanding / cost / profit stay SEPARATE columns, event status is Arabic
 * (never a raw enum), margins render as percentages, the time filter is
 * switchable, and an unknown status is shown honestly rather than hidden.
 */

const state = vi.hoisted(() => ({
  events: [] as ReportEventRow[],
  customers: [] as ReportCustomerRow[],
  packages: [] as ReportPackageRow[],
  isLoading: false,
  error: null as unknown,
  lastFilter: "" as string,
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ currentOrganization: { id: "org-1", name: "دار الضيافة" } }),
}));

vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({ data: null, isLoading: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("./intelligence.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intelligence.api")>();
  return {
    ...actual,
    rangeForFilter: (filter: string) => {
      state.lastFilter = filter;
      return { from: "2026-09-01", to: "2026-09-30" };
    },
    useReportEvents: () => ({
      data: state.events,
      isLoading: state.isLoading,
      error: state.error,
      refetch: () => {},
    }),
    useReportCustomers: () => ({ data: state.customers, refetch: () => {} }),
    useReportPackages: () => ({ data: state.packages, refetch: () => {} }),
  };
});

function renderReports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

function eventRow(overrides: Partial<ReportEventRow> = {}): ReportEventRow {
  return {
    event_id: "ev-1",
    event_number: "EV-1001",
    title: "حفل زفاف",
    status: "CONFIRMED",
    start_at: "2026-09-12T14:00:00.000Z",
    guest_count: 120,
    revenue: 1500,
    collected: 1000,
    outstanding: 500,
    actual_cost: 700,
    gross_profit: 800,
    margin_percent: 53.3,
    ...overrides,
  };
}

beforeEach(() => {
  state.events = [];
  state.customers = [];
  state.packages = [];
  state.isLoading = false;
  state.error = null;
  state.lastFilter = "";
});

describe("ReportsPage — states & filters", () => {
  it("renders the heading and the four Muscat-safe time filters", () => {
    renderReports();

    expect(screen.getByRole("heading", { name: "التقارير" })).toBeInTheDocument();
    for (const label of ["اليوم", "الأسبوع", "الشهر", "الكل"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("defaults to the month filter", () => {
    renderReports();
    expect(state.lastFilter).toBe("month");
  });

  it("re-queries when the owner switches the period", async () => {
    renderReports();
    await userEvent.click(screen.getByRole("button", { name: "الأسبوع" }));
    expect(state.lastFilter).toBe("week");
  });

  it("shows a loading state while the report is prepared", () => {
    state.isLoading = true;
    renderReports();
    expect(screen.getByText("جارٍ تجهيز التقرير…")).toBeInTheDocument();
  });

  it("shows a retryable error instead of a partial report", () => {
    state.error = new Error("boom");
    renderReports();
    expect(screen.getByText("تعذّر تجهيز التقرير")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
  });

  it("states empty reasons per table instead of rendering a broken table", () => {
    renderReports();

    expect(screen.getByText("لا توجد مناسبات في هذه الفترة.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد باقات.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد بيانات.")).toBeInTheDocument();
  });
});

describe("ReportsPage — revenue & profitability table", () => {
  it("keeps revenue, collected, outstanding, cost and profit in separate columns", () => {
    state.events = [eventRow()];
    renderReports();

    const table = screen.getAllByRole("table")[0]!;
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual([
      "المناسبة",
      "الحالة",
      "الإيراد",
      "المحصل",
      "المتبقي",
      "التكاليف",
      "الربح",
      "الهامش",
    ]);
  });

  it("renders every OMR figure exactly (no rounding, no grouping)", () => {
    state.events = [eventRow()];
    renderReports();

    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("1500.000 ر.ع.")).toBeInTheDocument();
    expect(within(table).getByText("1000.000 ر.ع.")).toBeInTheDocument();
    expect(within(table).getByText("500.000 ر.ع.")).toBeInTheDocument();
    expect(within(table).getByText("700.000 ر.ع.")).toBeInTheDocument();
    expect(within(table).getByText("800.000 ر.ع.")).toBeInTheDocument();
  });

  it("renders the event status in Arabic, never the raw enum", () => {
    state.events = [
      eventRow({ event_id: "e1", title: "أ", status: "CONFIRMED" }),
      eventRow({ event_id: "e2", title: "ب", status: "CANCELLED" }),
      eventRow({ event_id: "e3", title: "ج", status: "PREPARING" }),
    ];
    renderReports();

    expect(screen.getByText("مؤكدة")).toBeInTheDocument();
    expect(screen.getByText("ملغاة")).toBeInTheDocument();
    expect(screen.getByText("قيد التجهيز")).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByText("CANCELLED")).not.toBeInTheDocument();
  });

  it("shows an unknown status honestly rather than blanking the cell", () => {
    state.events = [eventRow({ status: "SOMETHING_NEW" })];
    renderReports();
    expect(screen.getByText("SOMETHING_NEW")).toBeInTheDocument();
  });

  it("formats the margin as a one-decimal percentage, and a dash when absent", () => {
    state.events = [
      eventRow({ event_id: "e1", title: "بهامش", margin_percent: 53.25 }),
      eventRow({ event_id: "e2", title: "بلاهامش", margin_percent: null }),
    ];
    renderReports();

    expect(screen.getByText("53.3%")).toBeInTheDocument();
    // Rounded to ONE decimal — the raw two-decimal figure is never rendered.
    expect(screen.queryByText("53.25%")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("links each event row to its workspace", () => {
    state.events = [eventRow({ event_id: "ev-42", title: "حفل زفاف" })];
    renderReports();

    expect(screen.getByRole("link", { name: "حفل زفاف" })).toHaveAttribute(
      "href",
      "/events/$eventId",
    );
  });
});

describe("ReportsPage — packages & top customers", () => {
  it("reports package usage against profitability", () => {
    state.packages = [
      {
        package_id: "p1",
        package_name: "باقة العرس الكاملة",
        usage_count: 7,
        commercial_value: 3500,
        actual_cost: 2300,
        gross_profit: 1200,
        margin_percent: 34.285,
      },
    ];
    renderReports();

    const packagesTable = screen
      .getByText("الباقات — الاستخدام مقابل الربحية")
      .closest("div")!
      .querySelector("table")!;
    expect(within(packagesTable).getByText("باقة العرس الكاملة")).toBeInTheDocument();
    expect(within(packagesTable).getByText("7")).toBeInTheDocument();
    expect(within(packagesTable).getByText("3500.000 ر.ع.")).toBeInTheDocument();
    expect(within(packagesTable).getByText("1200.000 ر.ع.")).toBeInTheDocument();
    expect(within(packagesTable).getByText("34.3%")).toBeInTheDocument();
  });

  it("lists the highest-value customers and links to each profile", () => {
    state.customers = [
      {
        customer_id: "cu-9",
        name: "شركة الفجر",
        events_count: 5,
        total_value: 9000,
        collected: 7500,
        outstanding: 1500,
        actual_cost: 6400,
        gross_profit: 2600,
      },
    ];
    renderReports();

    const customersTable = screen
      .getByText("العملاء — الأعلى قيمة")
      .closest("div")!
      .querySelector("table")!;
    expect(within(customersTable).getByRole("link", { name: "شركة الفجر" })).toHaveAttribute(
      "href",
      "/customers/$customerId",
    );
    expect(within(customersTable).getByText("9000.000 ر.ع.")).toBeInTheDocument();
    expect(within(customersTable).getByText("1500.000 ر.ع.")).toBeInTheDocument();
    expect(within(customersTable).getByText("2600.000 ر.ع.")).toBeInTheDocument();
  });
});
