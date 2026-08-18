import type { AppRole } from "@/lib/dbTypes";
import { COST_READER_ROLES, PAYMENT_WRITE_ROLES } from "@/lib/domain";

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
  الأجور: "canFinance",
  // Procurement read models are hidden from non-cost roles and every S5
  // command requires OWNER/MANAGER — for anyone else this tab can only show
  // an empty list or a refusal.
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
  canCost: boolean;
  canCommercial: boolean;
  canFinance: boolean;
  canAttendance: boolean;
}

/** Role-derived capabilities INSIDE the current organization (UI affordances
 * only — the database remains authoritative via RLS/RPC checks). */
export function eventPermissions(role: AppRole | null): EventPermissions {
  return {
    canCost: !!role && COST_READER_ROLES.includes(role),
    canCommercial: role === "OWNER" || role === "MANAGER",
    canFinance: !!role && PAYMENT_WRITE_ROLES.includes(role),
    canAttendance:
      !!role && ["OWNER", "MANAGER", "SUPERVISOR"].includes(role),
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
