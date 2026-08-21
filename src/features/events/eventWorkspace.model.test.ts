import { describe, expect, it } from "vitest";
import {
  EVENT_STATUS_LABELS,
  eventPermissions,
  eventQuotesOrFilter,
  groupForTab,
  jobPathForEventStatus,
  jobPathForQuoteStatus,
  pickLinkedQuote,
  readinessText,
  resolveActiveTab,
  visibleTabGroups,
  visibleWorkspaceTabs,
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
      "المالية",
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

describe("visibleWorkspaceTabs — no dead-end tabs", () => {
  it("gives an OWNER the full workspace", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("OWNER"));
    expect(tabs).toEqual([...WORKSPACE_TABS]);
  });

  it("hides finance-only tabs from a WAREHOUSE user", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("WAREHOUSE"));
    // These panels can only render a refusal for this role.
    expect(tabs).not.toContain("المدفوعات");
    expect(tabs).not.toContain("الفواتير");
    expect(tabs).not.toContain("المالية");
    expect(tabs).not.toContain("الأجور");
    expect(tabs).not.toContain("المشتريات");
    // The operational work a warehouse user is actually here to do stays.
    expect(tabs).toEqual(
      expect.arrayContaining(["ملخص", "المخزن", "المواد", "المعدات", "السجل"]),
    );
  });

  it("lets an ACCOUNTANT read money but not run payroll", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("ACCOUNTANT"));
    expect(tabs).toContain("المدفوعات");
    expect(tabs).toContain("الفواتير");
    expect(tabs).toContain("المالية");
    expect(tabs).toContain("الأجور");
    // Read-only financial visibility includes procurement cost summaries.
    expect(tabs).toContain("المشتريات");
  });

  it("keeps the canonical tab order", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("SUPERVISOR"));
    const canonical = WORKSPACE_TABS.filter((t) => tabs.includes(t));
    expect(tabs).toEqual(canonical);
  });

  it("groups remaining tabs so the owner does not hunt through modules", () => {
    expect(groupForTab("ملخص")).toBe("overview");
    expect(groupForTab("الحضور")).toBe("operations");
    expect(groupForTab("المالية")).toBe("finance");
    expect(groupForTab("التسعير")).toBe("documents");
    const groups = visibleTabGroups(visibleWorkspaceTabs(eventPermissions("WAREHOUSE")));
    expect(groups.map((g) => g.id)).not.toContain("finance");
    expect(groups.find((g) => g.id === "operations")?.tabs).toEqual(
      expect.arrayContaining(["المعدات", "المخزن", "المواد"]),
    );
  });
});

describe("resolveActiveTab", () => {
  it("keeps a tab the role can use", () => {
    expect(resolveActiveTab("المخزن", eventPermissions("WAREHOUSE"))).toBe("المخزن");
  });

  it("falls back to the summary instead of stranding the user on a refusal", () => {
    expect(resolveActiveTab("الفواتير", eventPermissions("WAREHOUSE"))).toBe("ملخص");
  });
});

describe("linked quotation after convert", () => {
  it("looks up quotes by event_id or converted_event_id", () => {
    expect(eventQuotesOrFilter("ev-1")).toBe(
      "event_id.eq.ev-1,converted_event_id.eq.ev-1",
    );
  });

  it("prefers the accepted quotation id, then a converted snapshot", () => {
    const quotes = [
      { id: "q-old", status: "SUPERSEDED" },
      { id: "q-live", status: "CONVERTED" },
    ];
    expect(pickLinkedQuote(quotes, "q-live")?.id).toBe("q-live");
    expect(pickLinkedQuote(quotes, null)?.id).toBe("q-live");
    expect(pickLinkedQuote([], null)).toBeNull();
  });
});

describe("job path from quote to profit", () => {
  it("walks quote statuses then event statuses", () => {
    expect(jobPathForQuoteStatus("DRAFT")).toBe("quote");
    expect(jobPathForQuoteStatus("ISSUED")).toBe("quote");
    expect(jobPathForQuoteStatus("ACCEPTED")).toBe("accept");
    expect(jobPathForQuoteStatus("CONVERTED")).toBe("event");
    expect(jobPathForEventStatus("CONFIRMED", false)).toBe("event");
    expect(jobPathForEventStatus("IN_PROGRESS", false)).toBe("run");
    expect(jobPathForEventStatus("CLOSED", false)).toBe("money");
    expect(jobPathForEventStatus("CLOSED", true)).toBe("done");
  });
});
