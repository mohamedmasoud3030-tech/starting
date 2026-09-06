import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountingPage } from "./AccountingPage";

// Mock auth: a cost-visible member in an organization.
vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canReadCost: true,
  }),
}));

vi.mock("@/lib/rpc", () => ({
  callRpc: async (name: string) => {
    switch (name) {
      case "accounting_ar_aging":
        return [
          {
            event_id: "e1",
            event_number: "EV-2026-0001",
            customer_id: "c1",
            customer_name: "عميل الخير",
            ar_gross: 1050.5,
            ar_origin_date: "2026-08-01",
            age_days: 35,
            aging_bucket: "DAYS_31_60",
          },
        ];
      case "accounting_ap_aging":
        return [
          {
            supplier_id: "s1",
            supplier_name: "مؤسسة التوريدات",
            ap_balance: 500,
            ap_origin_date: "2026-07-01",
            age_days: 66,
            aging_bucket: "DAYS_61_90",
          },
        ];
      case "accounting_contract_asset_aging":
        return [
          {
            event_id: "e2",
            event_number: "EV-2026-0002",
            customer_id: "c1",
            customer_name: "عميل الخير",
            contract_asset_gross: 315.25,
            recognition_date: "2026-09-01",
            age_days: 4,
            aging_bucket: "CURRENT",
          },
        ];
      case "accounting_supplier_positions":
        return [
          {
            supplier_id: "s1",
            supplier_name: "مؤسسة التوريدات",
            ap_balance: 500,
            open_invoice_count: 1,
            last_posting_date: "2026-09-01",
          },
        ];
      case "accounting_customer_statement":
        return [
          {
            entry_date: "2026-09-01",
            created_at: "2026-09-01T10:00:00+04:00",
            entry_number: "JE-1",
            source_type: "CUSTOMER_PAYMENT",
            is_reversal: false,
            event_id: "e1",
            event_number: "EV-2026-0001",
            customer_id: "c1",
            customer_name: "عميل الخير",
            document_number: "PAY-1",
            impact_on_outstanding: -500,
            running_outstanding: -500,
            allocations: [
              {
                payment_reference: "PAY-1",
                invoice_number: "INV-9",
                gross_amount: 500,
                net_amount: 476.19,
                vat_amount: 23.81,
              },
            ],
            memo: null,
          },
        ];
      case "accounting_supplier_statement":
        return [
          {
            entry_date: "2026-09-01",
            created_at: "2026-09-01T10:00:00+04:00",
            entry_number: "JE-2",
            source_type: "SUPPLIER_INVOICE",
            is_reversal: false,
            document_number: "SI-1",
            document_date: "2026-09-01",
            event_id: null,
            event_number: null,
            ap_debit: 0,
            ap_credit: 500,
            running_balance: 500,
            memo: null,
          },
        ];
      default:
        return [];
    }
  },
}));

// Mock supabase for useCustomers + useOrganizationSettings.
function chainable(result: { data: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: result.data, error: null, count: result.count ?? null }),
  };
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.range = () => builder;
  builder.maybeSingle = () => ({
    then: (resolve: (v: unknown) => void) => resolve({ data: result.data, error: null }),
  });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "customers") {
        return chainable({
          data: [{ id: "c1", name: "عميل الخير", phone: null }],
          count: 1,
        });
      }
      if (table === "organization_settings") {
        return chainable({ data: null });
      }
      return chainable({ data: [] });
    },
    rpc: async () => ({ data: [], error: null }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("AccountingPage", () => {
  it("renders AR / AP / contract-asset aging with buckets and gross totals", async () => {
    render(<AccountingPage />, { wrapper });

    expect(await screen.findByText("أعمار الذمم المدينة (العملاء)")).toBeInTheDocument();
    expect(screen.getByText("أعمار الذمم الدائنة (الموردون)")).toBeInTheDocument();
    expect(screen.getByText("أعمار أصول العقود (إيراد غير مفوتر)")).toBeInTheDocument();

    // 1050.500 appears both in the AR row and in the AR card total.
    expect(await screen.findAllByText("1050.500 ر.ع.")).not.toHaveLength(0);
    expect(screen.getByText("31–60 يوم")).toBeInTheDocument();
    expect(screen.getByText("61–90 يوم")).toBeInTheDocument();
    expect(screen.getByText("حالية")).toBeInTheDocument();
  });

  it("shows the customer statement with allocation detail after choosing a customer", async () => {
    const user = userEvent.setup();
    render(<AccountingPage />, { wrapper });

    await user.click(screen.getByRole("button", { name: "كشف حساب عميل" }));
    await user.selectOptions(
      await screen.findByLabelText("العميل"),
      "c1",
    );

    expect(await screen.findByText("دفعة عميل")).toBeInTheDocument();
    expect(screen.getByText(/تفاصيل التخصيص \(1\)/)).toBeInTheDocument();

    // The allocation line carries payment/invoice references and gross/net/VAT.
    await user.click(screen.getByText(/تفاصيل التخصيص \(1\)/));
    await waitFor(() => {
      expect(screen.getByText(/دفعة PAY-1 — فاتورة INV-9/)).toBeInTheDocument();
    });
  });

  it("switches to the supplier statement after choosing a supplier", async () => {
    const user = userEvent.setup();
    render(<AccountingPage />, { wrapper });

    await user.click(screen.getByRole("button", { name: "كشف حساب مورد" }));
    await user.selectOptions(
      await screen.findByLabelText("المورد"),
      "s1",
    );

    expect(await screen.findByText("فاتورة مورد")).toBeInTheDocument();
  });
});
