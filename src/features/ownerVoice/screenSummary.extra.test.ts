import { describe, expect, it } from "vitest";
import {
  buildAttendanceVoiceSummary,
  buildAttentionVoiceSummary,
  buildInvoiceVoiceSummary,
  buildPayrollVoiceSummary,
} from "./screenSummary";

describe("buildAttendanceVoiceSummary", () => {
  it("reports present count and total earned", () => {
    const s = buildAttendanceVoiceSummary({
      earnedOmr: "45.000",
      presentCount: 3,
      totalCount: 4,
    });
    expect(s).toContain("٤");
    expect(s).toContain("٤٥");
  });
  it("handles empty attendance", () => {
    expect(buildAttendanceVoiceSummary({})).toContain("لا يوجد حضور");
  });
});

describe("buildPayrollVoiceSummary", () => {
  it("speaks due, advances, paid and late", () => {
    const s = buildPayrollVoiceSummary({
      dueOmr: "450.000",
      advancesOmr: "100.000",
      paidOmr: "200.000",
      lateOmr: "250.000",
    });
    expect(s).toContain("المستحق");
    expect(s).toContain("السلف");
    expect(s).toContain("المدفوع");
    expect(s).toContain("المتأخر");
  });
});

describe("buildInvoiceVoiceSummary", () => {
  it("summarizes total, collected, remaining and installment progress", () => {
    const s = buildInvoiceVoiceSummary({
      totalOmr: "500.000",
      paidOmr: "200.000",
      remainingOmr: "300.000",
      installmentCount: 3,
      paidInstallments: 1,
    });
    expect(s).toContain("الفاتورة بقيمة");
    expect(s).toContain("المحصَّل");
    expect(s).toContain("المتبقي");
    expect(s).toContain("٣");
  });
});

describe("buildAttentionVoiceSummary", () => {
  it("aggregates the owner's day at a glance", () => {
    const s = buildAttentionVoiceSummary({
      todayEventCount: 3,
      readyCount: 2,
      attentionCount: 1,
      lowStockCount: 1,
      attendanceGapCount: 1,
      canReadFinance: true,
    });
    expect(s).toContain("مناسبات");
    expect(s).toContain("مخزون منخفض");
    expect(s).toContain("لم يُسجَّل حضورها");
  });
  it("reports quiet days honestly", () => {
    const s = buildAttentionVoiceSummary({
      todayEventCount: 2,
      readyCount: 2,
      attentionCount: 0,
      lowStockCount: 0,
      attendanceGapCount: 0,
      canReadFinance: true,
    });
    expect(s).toContain("لا توجد مشاكل تحتاج تدخل");
  });
});
