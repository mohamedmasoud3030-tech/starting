import { describe, expect, it } from "vitest";
import { mapFinance, mapPayment, paymentError } from "./payments.api";

describe("mapFinance", () => {
  it("normalizes authoritative finance figures into exact milli-OMR", () => {
    const finance = mapFinance({
      organization_id: "org-1",
      event_id: "evt-1",
      event_number: "EV-2026-00001",
      event_status: "CONFIRMED",
      accepted_revenue: 500,
      expected_cost: 300,
      expected_profit: 200,
      amount_paid: 150.25,
      outstanding_balance: 349.75,
      committed_cost: 50,
      delivered_cost: 20,
      gross_margin: 450,
      staff_cost: 80,
      procurement_cost: 50,
      expense_cost: 25,
      actual_cost: 155,
      actual_profit: 345,
      margin_percent: 69,
    });
    expect(finance).not.toBeNull();
    expect(finance?.acceptedRevenueMilli).toBe(500000);
    expect(finance?.amountPaidMilli).toBe(150250);
    expect(finance?.outstandingMilli).toBe(349750);
    expect(finance?.committedCostMilli).toBe(50000);
    expect(finance?.grossMarginMilli).toBe(450000);
    expect(finance?.staffCostMilli).toBe(80000);
    expect(finance?.actualCostMilli).toBe(155000);
    expect(finance?.actualProfitMilli).toBe(345000);
    expect(finance?.marginPercent).toBe(69);
  });

  it("returns null when the event has no finance row", () => {
    expect(mapFinance(null)).toBeNull();
    expect(mapFinance({ event_id: null } as Parameters<typeof mapFinance>[0])).toBeNull();
  });
});

describe("mapPayment", () => {
  it("maps a payment summary row into an exact-milli shape", () => {
    const p = mapPayment({
      payment_id: "pay-1",
      organization_id: "org-1",
      event_id: "evt-1",
      event_number: "EV-2026-00001",
      amount: 150.5,
      payment_method: "BANK_TRANSFER",
      reference: "TRX-1",
      notes: null,
      paid_at: "2026-08-14T12:00:00Z",
      status: "RECORDED",
      recorded_by: null,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      created_at: "2026-08-14T12:00:00Z",
    });
    expect(p.amountMilli).toBe(150500);
    expect(p.method).toBe("BANK_TRANSFER");
    expect(p.status).toBe("RECORDED");
  });
});

describe("paymentError", () => {
  it("explains domain errors in Arabic", () => {
    expect(paymentError(new Error("INVALID_PAYMENT_AMOUNT"))).toContain("أكبر من صفر");
    expect(paymentError(new Error("OMR_PRECISION_EXCEEDED"))).toContain("ثلاث خانات");
    expect(paymentError(new Error("PAYMENT_REQUIRES_ACCEPTED_QUOTATION"))).toContain(
      "اعتماد عرض سعر",
    );
    expect(paymentError(new Error("PAYMENT_ALREADY_VOIDED"))).toContain("ملغاة بالفعل");
    expect(paymentError(new Error("NOT_AUTHORIZED"))).toContain("صلاحية");
  });

  it("passes through unknown errors unchanged", () => {
    expect(paymentError(new Error("SOMETHING_ELSE"))).toBe("SOMETHING_ELSE");
  });
});
