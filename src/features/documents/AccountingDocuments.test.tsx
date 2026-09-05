import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SupplierStatement } from "./SupplierStatement";
import { AccountingCustomerStatement } from "./AccountingCustomerStatement";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import type {
  CustomerStatementRow,
  SupplierStatementRow,
} from "@/features/accounting/accounting.api";

const identity: DocumentIdentity = {
  nameAr: "منشأة الضيافة",
  nameEn: null,
  logoUrl: null,
  phonePrimary: null,
  phoneSecondary: null,
  whatsapp: null,
  email: null,
  commercialRegistration: null,
  postalCode: null,
  poBox: null,
  addressLine1: null,
  city: null,
  region: null,
  country: null,
  managerName: "محمد المدير",
  managerTitle: "المالك",
  terms: null,
  footer: null,
};

describe("SupplierStatement — كشف حساب مورد", () => {
  const rows: SupplierStatementRow[] = [
    {
      entry_date: "2026-09-01",
      created_at: "2026-09-01T10:00:00+04:00",
      entry_number: "JE-1",
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

  it("renders the supplier identity, debit/credit columns and ending balance", () => {
    render(
      <SupplierStatement
        identity={identity}
        supplierName="مؤسسة التوريدات"
        asOf="2026-09-05T08:00:00+04:00"
        rows={rows}
      />,
    );
    expect(screen.getByText("كشف حساب مورد")).toBeInTheDocument();
    expect(screen.getByText("مؤسسة التوريدات")).toBeInTheDocument();
    expect(screen.getByText("فاتورة مورد")).toBeInTheDocument();
    expect(screen.getByText("SI-1")).toBeInTheDocument();
    // 500.000 appears both in the credit column and in the ending balance.
    expect(screen.getAllByText("500.000 ر.ع.")).not.toHaveLength(0);
  });

  it("renders an explicit empty state without fabricating zeros", () => {
    render(
      <SupplierStatement
        identity={identity}
        supplierName="مؤسسة التوريدات"
        asOf="2026-09-05T08:00:00+04:00"
        rows={[]}
      />,
    );
    expect(screen.getByText("لا توجد حركات مسجّلة لهذا المورد.")).toBeInTheDocument();
  });
});

describe("AccountingCustomerStatement — كشف حساب عميل (محاسبي)", () => {
  const rows: CustomerStatementRow[] = [
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

  it("renders impact, running balance and the allocation detail", () => {
    render(
      <AccountingCustomerStatement
        identity={identity}
        customerName="عميل الخير"
        asOf="2026-09-05T08:00:00+04:00"
        rows={rows}
      />,
    );
    expect(screen.getByText("كشف حساب عميل")).toBeInTheDocument();
    expect(screen.getByText("دفعة عميل")).toBeInTheDocument();
    expect(screen.getByText("تفاصيل التخصيص:")).toBeInTheDocument();
    expect(screen.getByText(/دفعة PAY-1 — فاتورة INV-9/)).toBeInTheDocument();
    // -500.000 appears both in the impact column and in the running balance.
    expect(screen.getAllByText(/-500\.000 ر\.ع\./)).not.toHaveLength(0);
  });

  it("documents the prepayment sign convention", () => {
    render(
      <AccountingCustomerStatement
        identity={identity}
        customerName="عميل الخير"
        asOf="2026-09-05T08:00:00+04:00"
        rows={rows}
      />,
    );
    expect(screen.getByText(/الرصيد الموجب يعني مبلغاً مستحقاً على العميل/)).toBeInTheDocument();
  });
});
