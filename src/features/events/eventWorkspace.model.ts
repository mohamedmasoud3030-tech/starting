import type { AppRole } from "@/lib/dbTypes";
import { ROLE_DEFAULT_CAPABILITIES, type Capability } from "@/lib/capabilities";

/**
 * Pure domain layer for the Event workspace: tab vocabulary, status/readiness
 * presentation, role-derived permissions and voice-summary selection.
 */

export const WORKSPACE_TABS = [
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
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/**
 * Capability required to get anything out of a tab.
 *
 * Tabs whose panel can only ever render a "not available for your role"
 * message are not navigation — they are dead ends. A WAREHOUSE user was shown
 * all twelve tabs and four of them (المدفوعات، الفواتير، الأجور and the cost
 * half of التسعير) led only to a refusal.
 *
 * This is presentation only. Every panel keeps its own guard and the database
 * remains authoritative via RLS/RPC checks — hiding a tab is never the
 * security boundary.
 */
const TAB_REQUIREMENT: Partial<Record<WorkspaceTab, keyof EventPermissions>> = {
  المدفوعات: "canCost",
  الفواتير: "canCost",
  المالية: "canCost",
  // The payroll tab reads payroll data — payroll.read, independent of cost
  // visibility (0079 boundary).
  الأجور: "canPayroll",
  // Procurement read models are hidden from non-cost viewers and order
  // commands require procurement.manage — for anyone else this tab can only
  // show an empty list or a refusal.
  المشتريات: "canCost",
};

/** The tabs a role can actually use, in canonical order. */
export function visibleWorkspaceTabs(
  permissions: EventPermissions,
): WorkspaceTab[] {
  return WORKSPACE_TABS.filter((tab) => {
    const requirement = TAB_REQUIREMENT[tab];
    return requirement === undefined || permissions[requirement];
  });
}

/**
 * Keeps the active tab valid. If the current tab is not available to the role
 * (for example after an organization switch where the user holds a different
 * role) the workspace falls back to the always-available summary tab.
 */
export function resolveActiveTab(
  tab: WorkspaceTab,
  permissions: EventPermissions,
): WorkspaceTab {
  return visibleWorkspaceTabs(permissions).includes(tab) ? tab : "ملخص";
}

export const EVENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTED: "تم التسعير",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "جارية",
  RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

export function readinessText(readiness: {
  status: string;
  staff_missing: number;
  equipment_shortage: number;
}): string {
  if (readiness.status === "READY") return "المناسبة جاهزة";
  if (readiness.status === "STAFF_MISSING")
    return `ناقص ${readiness.staff_missing} من الفريق`;
  if (readiness.status === "EQUIPMENT_SHORTAGE")
    return `ناقص ${readiness.equipment_shortage} من المعدات`;
  return `مشكلات متعددة: فريق ${readiness.staff_missing}، معدات ${readiness.equipment_shortage}`;
}

export interface EventPermissions {
  /** cost.visibility — cost figures, rates, financial statements. */
  canCost: boolean;
  /** quotation.manage — commercial lines and quotations. */
  canCommercial: boolean;
  /** event.manage — status transitions and cancellation. */
  canManage: boolean;
  /** finance.manage — financial closure. */
  canFinance: boolean;
  /** invoice.manage — create/void the event invoice. */
  canInvoices: boolean;
  /** payroll.read — the payroll (الأجور) tab and read surfaces. */
  canPayroll: boolean;
  /** payroll.pay — record payouts and advances. */
  canPayrollPay: boolean;
  /** warehouse.dispatch — provisioning and warehouse operations. */
  canDispatch: boolean;
  /** attendance.record — attendance recording. */
  canAttendance: boolean;
  /** procurement.manage — supplier/order commands in the procurement panel. */
  canProcure: boolean;
  /** payment.record — recording customer payments. */
  canRecordPayment: boolean;
  /** payment.void — voiding customer payments. */
  canVoidPayment: boolean;
}

/**
 * Event-level UI permissions (migration 0079). Each key maps to the
 * capability its commands check server-side, so the UI affordance and the
 * RPC gate can never diverge for a member with owner overrides.
 *
 * While the server capability report is still loading
 * (`capabilities === null`) the role preset — identical to the server's
 * `role_default_capability` for members without overrides — keeps the UI
 * stable. Hiding is presentation only; the database is authoritative.
 */
export function eventPermissions(
  role: AppRole | null,
  capabilities: Set<string> | null,
): EventPermissions {
  const has = (capability: Capability): boolean =>
    capabilities !== null
      ? capabilities.has(capability)
      : role !== null && ROLE_DEFAULT_CAPABILITIES[role].includes(capability);
  return {
    canCost: has("cost.visibility"),
    canCommercial: has("quotation.manage"),
    canManage: has("event.manage"),
    canFinance: has("finance.manage"),
    canInvoices: has("invoice.manage"),
    canPayroll: has("payroll.read"),
    canPayrollPay: has("payroll.pay"),
    canDispatch: has("warehouse.dispatch"),
    canAttendance: has("attendance.record"),
    canProcure: has("procurement.manage"),
    canRecordPayment: has("payment.record"),
    canVoidPayment: has("payment.void"),
  };
}

export interface VoiceSummaries {
  overview: string;
  pricing: string;
  payments: string;
  invoices: string;
  attendance: string;
  payroll: string;
}

/** The tab-specific voice summary used by the Owner Voice button. */
/**
 * After convert, the quotation keeps `converted_event_id` and does NOT write
 * `event_id` (that column is for quotes issued from an existing event).
 * The workspace must look up both.
 */
export function eventQuotesOrFilter(eventId: string): string {
  return `event_id.eq.${eventId},converted_event_id.eq.${eventId}`;
}

/** Prefer the event's accepted quotation, then a converted/accepted snapshot. */
export function pickLinkedQuote<T extends { id: string; status: string }>(
  quotes: readonly T[],
  acceptedQuotationId: string | null,
): T | null {
  if (acceptedQuotationId) {
    const matched = quotes.find((quote) => quote.id === acceptedQuotationId);
    if (matched) return matched;
  }
  return (
    quotes.find((quote) => quote.status === "CONVERTED") ??
    quotes.find((quote) => quote.status === "ACCEPTED") ??
    quotes[0] ??
    null
  );
}

export type JobPathStepId =
  | "quote"
  | "accept"
  | "event"
  | "run"
  | "money"
  | "done";

/** Where the owner is on the quote → profit path. */
export function jobPathForEventStatus(
  status: string,
  financiallyClosed: boolean,
): JobPathStepId {
  if (status === "CANCELLED") return "event";
  if (financiallyClosed || status === "CLOSED") return financiallyClosed ? "done" : "money";
  if (["DISPATCHED", "IN_PROGRESS", "RETURNING"].includes(status)) return "run";
  if (["CONFIRMED", "PREPARING", "QUOTED", "DRAFT"].includes(status)) return "event";
  return "event";
}

export function jobPathForQuoteStatus(status: string): JobPathStepId {
  if (status === "CONVERTED") return "event";
  if (status === "ACCEPTED") return "accept";
  return "quote";
}

export function voiceSummaryForTab(
  tab: WorkspaceTab,
  summaries: VoiceSummaries,
): string {
  switch (tab) {
    case "التسعير":
      return summaries.pricing;
    case "المدفوعات":
      return summaries.payments;
    case "الفواتير":
      return summaries.invoices;
    case "الحضور":
      return summaries.attendance;
    case "الأجور":
      return summaries.payroll;
    default:
      return summaries.overview;
  }
}
