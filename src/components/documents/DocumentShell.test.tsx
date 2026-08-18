import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentShell } from "./DocumentShell";
import type { DocumentIdentity } from "./documentIdentity";

const identity: DocumentIdentity = {
  nameAr: "مشاريع جودة الإنطلاقة",
  nameEn: "Masharie Jiwdat Alantalaqah",
  logoUrl: null,
  phonePrimary: "98203088",
  phoneSecondary: null,
  whatsapp: null,
  email: null,
  commercialRegistration: "1466316",
  postalCode: "611",
  poBox: null,
  addressLine1: null,
  city: "نزوى",
  region: null,
  country: "سلطنة عمان",
  managerName: "يعقوب الخصيبي",
  managerTitle: "المالك",
  terms: "الشروط العامة",
  footer: null,
};

describe("DocumentShell", () => {
  it("renders the letterhead identity and the document meta", () => {
    render(
      <DocumentShell
        identity={identity}
        title="عرض سعر"
        documentNumber="QT-2026-00001"
        dateText="18/08/2026"
      >
        <p>بنود العرض</p>
      </DocumentShell>,
    );

    expect(screen.getByText("مشاريع جودة الإنطلاقة")).toBeInTheDocument();
    expect(screen.getByText("Masharie Jiwdat Alantalaqah")).toBeInTheDocument();
    expect(screen.getByText("98203088")).toBeInTheDocument();
    expect(screen.getByText("1466316")).toBeInTheDocument();
    expect(screen.getByText("عرض سعر")).toBeInTheDocument();
    expect(screen.getByText("QT-2026-00001")).toBeInTheDocument();
    expect(screen.getByText("بنود العرض")).toBeInTheDocument();
  });

  it("renders the signature block from the manager identity", () => {
    render(
      <DocumentShell identity={identity} title="عرض سعر">
        <p />
      </DocumentShell>,
    );
    expect(screen.getByText("يعقوب الخصيبي")).toBeInTheDocument();
    expect(screen.getByText("المالك")).toBeInTheDocument();
  });

  it("omits the contact/legal band when no contact data is configured", () => {
    const bare: DocumentIdentity = { ...identity, phonePrimary: null, commercialRegistration: null, postalCode: null, city: null, country: null };
    render(
      <DocumentShell identity={bare} title="عرض سعر" signature={false}>
        <p />
      </DocumentShell>,
    );
    expect(screen.queryByText(/السجل التجاري/)).not.toBeInTheDocument();
  });
});
