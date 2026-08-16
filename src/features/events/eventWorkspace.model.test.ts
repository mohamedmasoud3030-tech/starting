import { describe, expect, it } from "vitest";
import {
  EVENT_STATUS_LABELS,
  eventPermissions,
  readinessText,
  voiceSummaryForTab,
  WORKSPACE_TABS,
  type VoiceSummaries,
} from "./eventWorkspace.model";

const summaries: VoiceSummaries = {
  overview: "ملخص",
  pricing: "تسعير",
  payments: "مدفوعات",
  invoices: "فواتير",
  attendance: "حضور",
  payroll: "أجور",
};

describe("eventWorkspace.model", () => {
  it("exposes the full Arabic tab vocabulary", () => {
    expect(WORKSPACE_TABS).toEqual([
      "ملخص",
      "التسعير",
      "الفريق",
      "المعدات",
      "المخزن",
      "المواد",
      "المشتريات",
      "المدفوعات",
      "الفواتير",
      "الحضور",
      "الأجور",
      "السجل",
    ]);
  });

  it("maps every event status to an Arabic label", () => {
    for (const status of [
      "DRAFT",
      "QUOTED",
      "CONFIRMED",
      "PREPARING",
      "DISPATCHED",
      "IN_PROGRESS",
      "RETURNING",
      "CLOSED",
      "CANCELLED",
    ]) {
      expect(EVENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("renders readiness text for every state", () => {
    expect(
      readinessText({ status: "READY", staff_missing: 0, equipment_shortage: 0 }),
    ).toBe("المناسبة جاهزة");
    expect(
      readinessText({ status: "STAFF_MISSING", staff_missing: 2, equipment_shortage: 0 }),
    ).toBe("ناقص 2 من الفريق");
    expect(
      readinessText({ status: "EQUIPMENT_SHORTAGE", staff_missing: 0, equipment_shortage: 3 }),
    ).toBe("ناقص 3 من المعدات");
    expect(
      readinessText({ status: "MULTIPLE_ISSUES", staff_missing: 1, equipment_shortage: 4 }),
    ).toBe("مشكلات متعددة: فريق 1، معدات 4");
  });

  it("derives workspace capabilities from the role", () => {
    expect(eventPermissions("OWNER")).toEqual({
      canCost: true,
      canCommercial: true,
      canFinance: true,
      canAttendance: true,
    });
    expect(eventPermissions("MANAGER")).toEqual({
      canCost: true,
      canCommercial: true,
      canFinance: true,
      canAttendance: true,
    });
    expect(eventPermissions("ACCOUNTANT")).toEqual({
      canCost: true,
      canCommercial: false,
      canFinance: true,
      canAttendance: false,
    });
    expect(eventPermissions("SUPERVISOR")).toEqual({
      canCost: false,
      canCommercial: false,
      canFinance: false,
      canAttendance: true,
    });
    expect(eventPermissions(null)).toEqual({
      canCost: false,
      canCommercial: false,
      canFinance: false,
      canAttendance: false,
    });
  });

  it("selects the tab-specific voice summary and defaults to overview", () => {
    expect(voiceSummaryForTab("التسعير", summaries)).toBe("تسعير");
    expect(voiceSummaryForTab("المدفوعات", summaries)).toBe("مدفوعات");
    expect(voiceSummaryForTab("الفواتير", summaries)).toBe("فواتير");
    expect(voiceSummaryForTab("الحضور", summaries)).toBe("حضور");
    expect(voiceSummaryForTab("الأجور", summaries)).toBe("أجور");
    expect(voiceSummaryForTab("ملخص", summaries)).toBe("ملخص");
    expect(voiceSummaryForTab("المخزن", summaries)).toBe("ملخص");
  });
});
