import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuotationDocument } from "./QuotationDocument";
import type { QuotationDocumentData } from "./QuotationDocument";
import type { QuotationLineRow } from "./quotes.api";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";

const identity: DocumentIdentity = {
  nameAr: "منشأة الضيافة",
  nameEn: null,
  logoUrl: null,
  phonePrimary: "98203088",
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
  managerName: null,
  managerTitle: null,
  terms: null,
  footer: null,
};

function data(overrides: Partial<QuotationDocumentData> = {}): QuotationDocumentData {
  return {
    quotationNumber: "QT-2026-00001",
    customerName: "عميل",
    customerPhone: null,
    eventTitle: "حفل",
    guestCount: 10,
    startAt: "2026-09-01T10:00:00+04:00",
    venue: "قاعة",
    subtotal: "110.000",
    transportAmount: 0,
    transportNote: null,
    surchargeAmount: 0,
    discountAmount: 0,
    totalSelling: "115.500",
    preVatTotal: "110.000",
    vatRegistered: true,
    vatPercent: 5,
    vatAmount: "5.500",
    vatRegistrationNumber: "OM-VAT-1",
    revision: 1,
    issuedAt: "2026-08-20T10:00:00+04:00",
    validUntil: null,
    ...overrides,
  };
}

const lines: QuotationLineRow[] = [
  {
    id: "l1",
    organization_id: "org",
    quotation_id: "q1",
    source_catalog_item_id: null,
    source_package_id: null,
    description: "خدمة ضيافة",
    item_type: "SERVICE",
    unit: "مناسبة",
    pricing_method: "FIXED",
    quantity: "1",
    unit_selling_price: "110.000",
    expected_unit_cost: null,
    total_selling: "110.000",
    total_expected_cost: null,
    is_custom: true,
    notes: null,
    sort_order: 0,
  },
];

describe("QuotationDocument — VAT snapshot rendering", () => {
  it("renders the stored VAT snapshot for a VAT-registered quotation", () => {
    render(<QuotationDocument identity={identity} data={data()} lines={lines} />);
    expect(screen.getByText(/المجموع قبل الضريبة/)).toBeInTheDocument();
    expect(screen.getByText(/ضريبة القيمة المضافة \(5%\)/)).toBeInTheDocument();
    expect(screen.getByText(/OM-VAT-1/)).toBeInTheDocument();
    expect(screen.getAllByText(/115\.500/).length).toBeGreaterThan(0);
  });

  it("does not render VAT rows for a VAT-disabled quotation", () => {
    render(
      <QuotationDocument
        identity={identity}
        data={data({ vatRegistered: false, vatPercent: 0, vatAmount: "0.000" })}
        lines={lines}
      />,
    );
    expect(screen.queryByText(/المجموع قبل الضريبة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ضريبة القيمة المضافة/)).not.toBeInTheDocument();
  });
});
