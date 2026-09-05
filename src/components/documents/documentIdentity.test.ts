import { describe, expect, it } from "vitest";
import type { OrganizationRow, OrganizationSettingsRow } from "@/lib/dbTypes";
import { buildDocumentIdentity } from "./documentIdentity";

const org: OrganizationRow = {
  id: "org-1",
  name: "مشاريع جودة الإنطلاقة",
  display_name: null,
  default_currency: "OMR",
  timezone: "Asia/Muscat",
  is_active: true,
  created_at: "",
  updated_at: "",
};

const settings: OrganizationSettingsRow = {
  organization_id: "org-1",
  name_en: "Masharie Jiwdat Alantalaqah",
  logo_url: "https://example.com/logo.png",
  primary_color: null,
  accent_color: null,
  phone_primary: "98203088",
  phone_secondary: null,
  whatsapp: null,
  email: null,
  commercial_registration: "1466316",
  postal_code: "611",
  po_box: null,
  address_line1: null,
  city: null,
  region: null,
  country: "سلطنة عمان",
  document_terms: "الشروط العامة",
  document_footer: null,
  quotation_number_prefix: "QT",
  invoice_number_prefix: "INV",
  event_number_prefix: "EV",
  manager_name: "يعقوب الخصيبي",
  manager_title: "المالك",
  vat_registered: true,
  vat_percent: 5,
  vat_registration_number: "OM-VAT-1",
  accounting_cutover_at: null,
  accounting_cutover_by: null,
  accounting_cutover_vat_payable: null,
  created_at: "",
  updated_at: "",
};

describe("buildDocumentIdentity", () => {
  it("merges the tenant name with the settings identity", () => {
    const id = buildDocumentIdentity(org, settings);
    expect(id.nameAr).toBe("مشاريع جودة الإنطلاقة");
    expect(id.nameEn).toBe("Masharie Jiwdat Alantalaqah");
    expect(id.phonePrimary).toBe("98203088");
    expect(id.commercialRegistration).toBe("1466316");
    expect(id.managerName).toBe("يعقوب الخصيبي");
  });

  it("falls back to a neutral name and never invents contact data", () => {
    const id = buildDocumentIdentity(null, null);
    expect(id.nameAr).toBe("منشأة الضيافة");
    expect(id.nameEn).toBeNull();
    expect(id.phonePrimary).toBeNull();
    expect(id.commercialRegistration).toBeNull();
  });

  it("uses display_name as the English name when settings has none", () => {
    const id = buildDocumentIdentity(
      { ...org, display_name: "Company EN" },
      { ...settings, name_en: null },
    );
    expect(id.nameEn).toBe("Company EN");
  });
});
