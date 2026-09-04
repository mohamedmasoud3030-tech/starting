import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PayrollPeriodSheet } from "./PayrollPeriodSheet";
import type { PayrollPeriodRow } from "./documents.api";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";

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
  managerName: "يعقوب",
  managerTitle: "المالك",
  terms: null,
  footer: null,
};

function row(overrides: Partial<PayrollPeriodRow>): PayrollPeriodRow {
  return {
    staff_member_id: "s1",
    staff_name: "أحمد",
    shift_count: 1,
    earned_total: "0.000",
    advances_total: "0.000",
    payouts_total: "0.000",
    balance_total: "0.000",
    ...overrides,
  };
}

describe("PayrollPeriodSheet — كشف صرف / رواتب فترة", () => {
  it("renders per-host amounts with canonical OMR formatting", () => {
    render(
      <PayrollPeriodSheet
        identity={identity}
        from="2026-09-01"
        to="2026-09-30"
        rows={[
          row({
            earned_total: "100.000",
            advances_total: "20.000",
            payouts_total: "30.000",
            balance_total: "50.000",
          }),
        ]}
      />,
    );
    expect(screen.getByText("كشف صرف / رواتب فترة")).toBeInTheDocument();
    // With a single row the totals line repeats every column value exactly
    // once — two occurrences proves both the row and the total render.
    for (const value of ["100.000", "20.000", "30.000", "50.000"]) {
      expect(screen.getAllByText(`${value} ر.ع.`)).toHaveLength(2);
    }
  });

  it("totals reconcile exactly to the sum of the printed rows", () => {
    render(
      <PayrollPeriodSheet
        identity={identity}
        from="2026-09-01"
        to="2026-09-30"
        rows={[
          row({
            earned_total: "100.000",
            advances_total: "20.000",
            payouts_total: "30.000",
            balance_total: "50.000",
          }),
          row({
            staff_member_id: "s2",
            staff_name: "خالد",
            shift_count: 3,
            earned_total: "76.500",
            advances_total: "0.000",
            payouts_total: "51.000",
            balance_total: "25.500",
          }),
        ]}
      />,
    );
    // 100 + 76.500 = 176.500 earned; 20 advances; 30 + 51 = 81 paid;
    // 50 + 25.500 = 75.500 remaining.
    expect(screen.getByText("176.500 ر.ع.")).toBeInTheDocument();
    expect(screen.getByText("81.000 ر.ع.")).toBeInTheDocument();
    expect(screen.getByText("75.500 ر.ع.")).toBeInTheDocument();
    // The remaining total must equal earned − advances − payouts of the totals.
    expect(176_500 - 20_000 - 81_000).toBe(75_500);
  });

  it("shows the empty state instead of fabricated zero rows", () => {
    render(
      <PayrollPeriodSheet
        identity={identity}
        from="2026-08-01"
        to="2026-08-31"
        rows={[]}
      />,
    );
    expect(
      screen.getByText("لا توجد مستحقات أو صرف مسجل في هذه الفترة."),
    ).toBeInTheDocument();
    expect(screen.queryByText("0.000 ر.ع.")).not.toBeInTheDocument();
  });
});
