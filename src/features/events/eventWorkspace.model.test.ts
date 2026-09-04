import { describe, expect, it } from "vitest";
import { ROLE_DEFAULT_CAPABILITIES } from "@/lib/capabilities";
import {
  EVENT_STATUS_LABELS,
  eventPermissions,
  eventQuotesOrFilter,
  jobPathForEventStatus,
  jobPathForQuoteStatus,
  pickLinkedQuote,
  resolveActiveTab,
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

  it("falls back to the role preset while the capability report is loading", () => {
    const all = Object.keys({
      canCost: 0,
      canCommercial: 0,
      canManage: 0,
      canFinance: 0,
      canInvoices: 0,
      canPayroll: 0,
      canPayrollPay: 0,
      canDispatch: 0,
      canAttendance: 0,
      canProcure: 0,
      canRecordPayment: 0,
      canVoidPayment: 0,
    });
    // OWNER holds every capability in the preset.
    expect(eventPermissions("OWNER", null)).toEqual(
      Object.fromEntries(all.map((k) => [k, true])),
    );
    // MANAGER preset = every capability except settings.manage — all nine
    // event-surface permissions follow capabilities, so all are true.
    expect(eventPermissions("MANAGER", null)).toEqual(
      Object.fromEntries(all.map((k) => [k, true])),
    );
    expect(eventPermissions("ACCOUNTANT", null)).toEqual({
      canCost: true,
      canCommercial: false,
      canManage: false,
      canFinance: true,
      canInvoices: true,
      canPayroll: true,
      canPayrollPay: true,
      canDispatch: false,
      canAttendance: false,
      canProcure: false,
      canRecordPayment: true,
      canVoidPayment: true,
    });
    expect(eventPermissions("SUPERVISOR", null)).toEqual({
      canCost: false,
      canCommercial: false,
      canManage: true,
      canFinance: false,
      canInvoices: false,
      canPayroll: false,
      canPayrollPay: false,
      canDispatch: true,
      canAttendance: true,
      canProcure: false,
      canRecordPayment: false,
      canVoidPayment: false,
    });
    expect(eventPermissions(null, null)).toEqual(
      Object.fromEntries(all.map((k) => [k, false])),
    );
  });

  it("derives permissions from the server capability set once loaded", () => {
    // An owner revoked cost.visibility for this member — the preset says
    // true, the server report says no. The report wins.
    const noCost = new Set(
      ROLE_DEFAULT_CAPABILITIES.OWNER.filter((c) => c !== "cost.visibility"),
    );
    const stripped = eventPermissions("OWNER", noCost);
    expect(stripped.canCost).toBe(false);
    expect(stripped.canCommercial).toBe(true);
    expect(stripped.canInvoices).toBe(true);

    // An owner granted a supervisor payroll.read — the preset says no.
    const withPayroll = new Set<string>(
      ROLE_DEFAULT_CAPABILITIES.SUPERVISOR,
    );
    withPayroll.add("payroll.read");
    const supervisorPayroll = eventPermissions("SUPERVISOR", withPayroll);
    expect(supervisorPayroll.canPayroll).toBe(true);
    expect(supervisorPayroll.canCost).toBe(false);
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
    const tabs = visibleWorkspaceTabs(eventPermissions("OWNER", null));
    expect(tabs).toEqual([...WORKSPACE_TABS]);
  });

  it("hides finance-only tabs from a WAREHOUSE user", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("WAREHOUSE", null));
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

  it("lets an ACCOUNTANT read money and the payroll it was granted", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("ACCOUNTANT", null));
    expect(tabs).toContain("المدفوعات");
    expect(tabs).toContain("الفواتير");
    expect(tabs).toContain("المالية");
    // The accountant preset includes payroll.read — the payroll tab follows.
    expect(tabs).toContain("الأجور");
    // Read-only financial visibility includes procurement cost summaries.
    expect(tabs).toContain("المشتريات");
  });

  it("hides the payroll tab when the server report drops payroll.read", () => {
    const caps = new Set<string>(
      ROLE_DEFAULT_CAPABILITIES.ACCOUNTANT.filter((c) => c !== "payroll.read"),
    );
    const tabs = visibleWorkspaceTabs(eventPermissions("ACCOUNTANT", caps));
    expect(tabs).not.toContain("الأجور");
  });

  it("keeps the canonical tab order", () => {
    const tabs = visibleWorkspaceTabs(eventPermissions("SUPERVISOR", null));
    const canonical = WORKSPACE_TABS.filter((t) => tabs.includes(t));
    expect(tabs).toEqual(canonical);
  });
});

describe("resolveActiveTab", () => {
  it("keeps a tab the role can use", () => {
    expect(resolveActiveTab("المخزن", eventPermissions("WAREHOUSE", null))).toBe("المخزن");
  });

  it("falls back to the summary instead of stranding the user on a refusal", () => {
    expect(
      resolveActiveTab("الفواتير", eventPermissions("WAREHOUSE", null)),
    ).toBe("ملخص");
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

/**
 * The capability CONTRACT, not the role presets: each permission follows its
 * own capability, so one capability must never widen or narrow its neighbor.
 */
describe("capability contract — one capability without its neighbor", () => {
  const base = (role: keyof typeof ROLE_DEFAULT_CAPABILITIES) =>
    new Set<string>(ROLE_DEFAULT_CAPABILITIES[role]);

  it("payment.record without payment.void → can record, cannot void", () => {
    const caps = base("MANAGER");
    caps.delete("payment.void");
    const p = eventPermissions("MANAGER", caps);
    expect(p.canRecordPayment).toBe(true);
    expect(p.canVoidPayment).toBe(false);
  });

  it("payment.void without payment.record → can void, cannot record", () => {
    const caps = base("MANAGER");
    caps.delete("payment.record");
    const p = eventPermissions("MANAGER", caps);
    expect(p.canRecordPayment).toBe(false);
    expect(p.canVoidPayment).toBe(true);
  });

  it("payroll.read without payroll.pay → can read payroll, cannot pay", () => {
    const caps = base("MANAGER");
    caps.delete("payroll.pay");
    const p = eventPermissions("MANAGER", caps);
    expect(p.canPayroll).toBe(true);
    expect(p.canPayrollPay).toBe(false);
  });

  it("payroll.pay without payroll.read → can pay, payroll tab stays hidden", () => {
    const caps = base("MANAGER");
    caps.delete("payroll.read");
    const p = eventPermissions("MANAGER", caps);
    expect(p.canPayroll).toBe(false);
    expect(p.canPayrollPay).toBe(true);
    expect(visibleWorkspaceTabs(p)).not.toContain("الأجور");
  });

  it("procurement.manage without event.manage → can procure, cannot manage events", () => {
    const caps = base("WAREHOUSE");
    caps.add("procurement.manage");
    const p = eventPermissions("WAREHOUSE", caps);
    expect(p.canProcure).toBe(true);
    expect(p.canManage).toBe(false);
    expect(p.canCommercial).toBe(false);
  });

  it("catalog.manage without quotation.manage → catalog, not quotes", () => {
    const caps = base("WAREHOUSE");
    caps.add("catalog.manage");
    const p = eventPermissions("WAREHOUSE", caps);
    // No commercial (quotation) authority leaks in from catalog authority.
    expect(p.canCommercial).toBe(false);
    expect(p.canCost).toBe(false);
  });
});
