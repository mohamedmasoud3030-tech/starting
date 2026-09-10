import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Customer360Row } from "@/features/intelligence/intelligence.api";
import { CustomerDetail } from "./CustomerDetail";

/**
 * Customer 360 (ملف العميل).
 *
 * Pins the honest-facts contract: real counts and OMR figures from the server
 * projection, the repeat-customer badge, the missing-customer empty state, and
 * that the financial block is gated by cost visibility (never shown to a role
 * without it). No fabricated score is rendered anywhere.
 */

const state = vi.hoisted(() => ({
  customerId: "cu-1",
  canReadCost: true,
  rows: [] as Customer360Row[],
  isLoading: false,
  error: null as unknown,
  statementRows: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ customerId: state.customerId }),
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canReadCost: state.canReadCost,
  }),
}));

vi.mock("@/features/intelligence/intelligence.api", () => ({
  useCustomer360: () => ({
    data: state.rows,
    isLoading: state.isLoading,
    error: state.error,
    refetch: () => {},
  }),
}));

vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/features/documents/documents.api", () => ({
  useCustomerStatement: () => ({ data: state.statementRows, isLoading: false }),
}));

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerDetail />
    </QueryClientProvider>,
  );
}

function c360(overrides: Partial<Customer360Row> = {}): Customer360Row {
  return {
    customer_id: "cu-1",
    name: "مريم بنت سعيد",
    phone: "+96891112222",
    whatsapp: null,
    customer_type: "INDIVIDUAL",
    notes: null,
    is_active: true,
    first_interaction_at: "2026-01-05T00:00:00.000Z",
    last_interaction_at: "2026-08-01T00:00:00.000Z",
    quotes_count: 4,
    accepted_quotes: 3,
    rejected_quotes: 1,
    events_count: 3,
    upcoming_events: 1,
    completed_events: 2,
    last_event_at: "2026-08-01T00:00:00.000Z",
    total_commercial_value: 1500,
    total_collected: 1000,
    outstanding: 500,
    gross_profit: 400,
    days_since_last_event: 12,
    ...overrides,
  };
}

beforeEach(() => {
  state.customerId = "cu-1";
  state.canReadCost = true;
  state.rows = [];
  state.isLoading = false;
  state.error = null;
  state.statementRows = [];
});

describe("CustomerDetail — states", () => {
  it("shows a loading state while the 360 projection loads", () => {
    state.isLoading = true;
    renderDetail();
    expect(screen.getByText("جارٍ تحميل بيانات العميل…")).toBeInTheDocument();
  });

  it("shows a retryable error state when the projection fails", () => {
    state.error = new Error("boom");
    renderDetail();
    expect(screen.getByText("تعذّر تحميل بيانات العميل")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
  });

  it("explains an unknown customer instead of rendering blank facts", () => {
    state.customerId = "cu-missing";
    state.rows = [c360({ customer_id: "cu-1" })];
    renderDetail();

    expect(screen.getByText("العميل غير موجود")).toBeInTheDocument();
    expect(
      screen.getByText("قد يكون العميل قد حُذف أو أنك لست ضمن المنشأة الصحيحة."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العملاء" })).toHaveAttribute(
      "href",
      "/customers",
    );
  });
});

describe("CustomerDetail — the customer's real facts", () => {
  it("renders the relationship and commercial history counts", () => {
    state.rows = [c360()];
    renderDetail();

    expect(screen.getByRole("heading", { name: "مريم بنت سعيد" })).toBeInTheDocument();
    expect(screen.getByText("العلاقة")).toBeInTheDocument();
    expect(screen.getByText("التاريخ التجاري")).toBeInTheDocument();

    const relation = screen.getByText("العلاقة").closest("div") as HTMLElement;
    expect(within(relation).getByText("عدد المناسبات")).toBeInTheDocument();
    expect(within(relation).getByText("3")).toBeInTheDocument();
    expect(within(relation).getByText("مناسبات قادمة")).toBeInTheDocument();
    expect(within(relation).getByText("مناسبات مكتملة")).toBeInTheDocument();

    const commercial = screen.getByText("التاريخ التجاري").closest("div") as HTMLElement;
    expect(within(commercial).getByText("عروض الأسعار")).toBeInTheDocument();
    expect(within(commercial).getByText("4")).toBeInTheDocument();
    expect(within(commercial).getByText("عروض معتمدة")).toBeInTheDocument();
    expect(within(commercial).getByText("عروض مرفوضة")).toBeInTheDocument();
  });

  it("marks a repeat customer (2+ events) and not a first-timer", () => {
    state.rows = [c360({ events_count: 3 })];
    const { unmount } = renderDetail();
    expect(within(screen.getByText("عميل متكرر").closest("div") as HTMLElement).getByText("نعم")).toBeInTheDocument();
    unmount();

    state.rows = [c360({ events_count: 1 })];
    renderDetail();
    expect(within(screen.getByText("عميل متكرر").closest("div") as HTMLElement).getByText("لا")).toBeInTheDocument();
  });

  it("shows days since the last event in Arabic", () => {
    state.rows = [c360({ days_since_last_event: 12 })];
    renderDetail();
    expect(screen.getByText("12 يوم")).toBeInTheDocument();
  });

  it("offers call and WhatsApp actions for a valid Omani number", () => {
    state.rows = [c360({ phone: "+96891112222" })];
    renderDetail();

    expect(screen.getByRole("link", { name: /اتصال/ })).toHaveAttribute("href", "tel:+96891112222");
    expect(screen.getByRole("link", { name: /واتساب/ })).toHaveAttribute(
      "href",
      "https://wa.me/96891112222",
    );
  });
});

describe("CustomerDetail — financial relationship (cost-visible roles only)", () => {
  it("renders revenue / collected / outstanding / profit as separate OMR facts", () => {
    state.rows = [c360()];
    renderDetail();

    expect(screen.getByText("العلاقة المالية")).toBeInTheDocument();
    expect(screen.getByText("إجمالي القيمة")).toBeInTheDocument();
    expect(screen.getByText("المحصل")).toBeInTheDocument();
    expect(screen.getByText("المتبقي")).toBeInTheDocument();
    expect(screen.getByText("الربح المحقق")).toBeInTheDocument();

    // PostgREST transports numeric(12,3) as a decimal: 1500 → "1500.000 ر.ع.".
    // The money layer re-derives exact milli-OMR and never rounds or groups.
    expect(screen.getByText("1500.000 ر.ع.")).toBeInTheDocument();
    expect(screen.getByText("1000.000 ر.ع.")).toBeInTheDocument();
    expect(screen.getByText("500.000 ر.ع.")).toBeInTheDocument();
    expect(screen.getByText("400.000 ر.ع.")).toBeInTheDocument();
  });

  it("hides every financial figure from a role without cost visibility", () => {
    state.canReadCost = false;
    state.rows = [c360()];
    renderDetail();

    expect(screen.queryByText("العلاقة المالية")).not.toBeInTheDocument();
    expect(screen.queryByText("المحصل")).not.toBeInTheDocument();
    expect(screen.queryByText("الربح المحقق")).not.toBeInTheDocument();
    // The non-financial facts are still readable.
    expect(screen.getByText("العلاقة")).toBeInTheDocument();
    expect(screen.getByText("التاريخ التجاري")).toBeInTheDocument();
  });

  it("opens the account statement on demand", async () => {
    state.rows = [c360()];
    state.statementRows = [];
    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /كشف الحساب/ }));

    expect(await screen.findByText("لا توجد حركات")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /طباعة \/ حفظ PDF/ })).toBeInTheDocument();
  });
});
