import { describe, expect, it } from "vitest";
import { financeError, mapClosure, mapExpense } from "./finance.api";

describe("mapExpense", () => {
  it("maps a raw expense row into exact milli-OMR", () => {
    const e = mapExpense({
      id: "ex-1",
      organization_id: "org",
      event_id: "evt",
      event_number: "EV-1",
      category: "TRANSPORT",
      amount: 25,
      expense_date: "2026-11-01",
      description: "نقل",
      payment_method: "CASH",
      payee: null,
      reference: null,
      status: "RECORDED",
      void_reason: null,
      voided_at: null,
      created_at: "2026-11-01T00:00:00Z",
    });
    expect(e.amountMilli).toBe(25000);
    expect(e.category).toBe("TRANSPORT");
    expect(e.status).toBe("RECORDED");
  });
});

describe("mapClosure", () => {
  it("maps a closure row, keeping the snapshot figures", () => {
    const c = mapClosure({
      id: "cl-1",
      organization_id: "org",
      event_id: "evt",
      closed_at: "2026-11-01T00:00:00Z",
      closed_by: "user-1",
      close_note: null,
      revenue_at_close: 400,
      collected_at_close: 400,
      outstanding_at_close: 0,
      costs_at_close: 25,
      profit_at_close: 375,
      margin_at_close: 93.75,
      reopened_at: null,
      reopened_by: null,
      reopen_reason: null,
      created_at: "2026-11-01T00:00:00Z",
    });
    expect(c.profitAtCloseMilli).toBe(375000);
    expect(c.reopenedAt).toBeNull();
  });
});

describe("financeError", () => {
  it("explains the close-time guards in Arabic", () => {
    expect(financeError(new Error("FINANCIAL_CLOSE_OUTSTANDING_BALANCE"))).toContain("مبلغ متبقٍ");
    expect(financeError(new Error("FINANCIAL_CLOSURE_BLOCKS_MUTATION"))).toContain("مغلقة ماليًا");
    expect(financeError(new Error("REOPEN_REASON_REQUIRED"))).toContain("سبب إعادة الفتح");
  });

  it("explains treasury posting failures in Arabic", () => {
    expect(financeError(new Error("TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED"))).toContain("رصيد الصندوق");
    expect(financeError(new Error("TREASURY_ACCOUNT_NOT_FOUND"))).toContain("غير موجود");
    expect(financeError(new Error("TREASURY_ACCOUNT_INACTIVE"))).toContain("غير نشط");
  });

  it("explains opening-cutover failures in Arabic", () => {
    expect(financeError(new Error("OPENING_CUTOVER_ALREADY_COMMITTED"))).toContain("الافتتاحية");
    expect(financeError(new Error("OPENING_VAT_INVALID"))).toContain("ضريبة");
  });
});
