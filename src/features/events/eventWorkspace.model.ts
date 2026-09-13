import type { AppRole } from "@/lib/dbTypes";
import { ROLE_DEFAULT_CAPABILITIES, type Capability } from "@/lib/capabilities";
import { EVENT_STATUS_ARABIC } from "@/lib/arabic";

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

/** Validate a URL-provided tab against the canonical vocabulary. */
export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return typeof value === "string" && (WORKSPACE_TABS as readonly string[]).includes(value);
}

/**
 * Tabs that no longer render on their own and where they now live. Kept so
 * old links, alerts and the command center keep landing somewhere sensible.
 */
export const WORKSPACE_TAB_ALIASES: Partial<Record<WorkspaceTab, WorkspaceTab>> = {
  المعدات: "المخزن",
};

export function normalizeWorkspaceTab(tab: WorkspaceTab): WorkspaceTab {
  return WORKSPACE_TAB_ALIASES[tab] ?? tab;
}

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

/**
 * The event workspace grouped by the OFFICE'S OWN STAGES, in the order the
 * work actually happens. This is presentation only — tab identities, role
 * gates, routes and deep links (?tab=…) are unchanged; every existing panel
 * simply lives inside the stage it serves:
 *
 *   ③ العرض والعربون  — التسعير · المدفوعات        (quote agreed, 30% deposit)
 *   ④ المضيفون        — الفريق                    (WhatsApp call → confirmations)
 *   ⑤ العدة           — المخزن (حجز + تجهيز + إرجاع) · المواد · المشتريات
 *   ⑥ يوم المناسبة    — الحضور · الأجور            (face check-in/out → pay)
 *   ⑦ الإقفال         — الفواتير · المالية          (balance, settle, close)
 *      السجل
 *
 * `ملخص` is pinned first and always available.
 */
export type WorkspaceTabGroup = {
  /** Stable machine id. */
  id: "deal" | "hosts" | "kit" | "day" | "closeout" | "history";
  /** Arabic stage label. */
  label: string;
  /** Stage number as the office counts it (null for the log). */
  step: number | null;
  tabs: ReadonlyArray<WorkspaceTab>;
};

export const WORKSPACE_TAB_GROUPS: ReadonlyArray<WorkspaceTabGroup> = [
  { id: "deal", label: "العرض والعربون", step: 1, tabs: ["التسعير", "المدفوعات"] },
  { id: "hosts", label: "المضيفون", step: 2, tabs: ["الفريق"] },
  // «المعدات» (reservation form) and «المخزن» (prep/return of the same
  // reservations) were two tabs over one table — merged into one tab; the
  // old ?tab=المعدات deep link is normalised to المخزن (see normalizeWorkspaceTab).
  { id: "kit", label: "العدة", step: 3, tabs: ["المخزن", "المواد", "المشتريات"] },
  { id: "day", label: "يوم المناسبة", step: 4, tabs: ["الحضور", "الأجور"] },
  { id: "closeout", label: "الإقفال", step: 5, tabs: ["الفواتير", "المالية"] },
  { id: "history", label: "السجل", step: null, tabs: ["السجل"] },
];

/** Every non-summary tab must belong to exactly one bucket. */
export const WORKSPACE_GROUP_TABS: readonly WorkspaceTab[] = WORKSPACE_TAB_GROUPS.flatMap(
  (g) => g.tabs,
);

/**
 * Split the tabs a role can actually use into non-empty labeled buckets,
 * preserving each group's member order. Empty buckets (e.g. a warehouse role
 * sees no financial tabs) are dropped so no empty header ever renders.
 * `ملخص` is handled separately by the view (always pinned when visible).
 */
export function groupWorkspaceTabs(
  visible: readonly WorkspaceTab[],
): WorkspaceTabGroup[] {
  const visibleSet = new Set(visible);
  return WORKSPACE_TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((t) => visibleSet.has(t)),
  })).filter((group) => group.tabs.length > 0);
}

/** The tabs a role can actually use, in canonical order. */
export function visibleWorkspaceTabs(
  permissions: EventPermissions,
): WorkspaceTab[] {
  return WORKSPACE_TABS.filter((tab) => {
    if (WORKSPACE_TAB_ALIASES[tab]) return false; // merged into another tab
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
  const wanted = normalizeWorkspaceTab(tab);
  return visibleWorkspaceTabs(permissions).includes(wanted) ? wanted : "ملخص";
}

/**
 * Canonical Arabic event-status labels (single source of truth in
 * `@/lib/arabic`), re-exported under the legacy workspace name so existing
 * consumers (workspace header, timeline, calendar) keep their import without
 * duplicating the vocabulary.
 */
export const EVENT_STATUS_LABELS: Record<string, string> = EVENT_STATUS_ARABIC;

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


/**
 * Derive each stage's completion from the server projection the workspace
 * already loads (`event_command_center`) + the event status. Pure.
 *
 *  deal     — accepted quotation AND something collected (the 30% deposit)
 *  hosts    — no staff missing (staff_required met)
 *  kit      — no equipment / consumable shortage and no pending procurement
 *  day      — event has been executed (DISPATCHED+) and everyone assigned
 *             has checked out
 *  closeout — outstanding = 0 and event CLOSED
 */
export function deriveStageStates(
  center: {
    operational: {
      staff_required: number;
      staff_missing: number;
      equipment_shortage: number;
      consumables_shortage: number;
      procurement_pending: number;
    };
    attendance: { assigned: number; checked_out: number };
    commercial: { has_accepted_quotation: boolean; collected: string | null; outstanding: string | null };
  } | null | undefined,
  eventStatus: string,
): Partial<Record<WorkspaceTabGroup["id"], "done" | "current" | "todo">> {
  if (!center) return {};
  const o = center.operational;
  const num = (v: string | null) => (v == null ? 0 : Number.parseFloat(v) || 0);
  const executed = ["DISPATCHED", "IN_PROGRESS", "RETURNING", "CLOSED"].includes(eventStatus);

  const deal = center.commercial.has_accepted_quotation && num(center.commercial.collected) > 0;
  const hosts = o.staff_required > 0 && o.staff_missing === 0;
  const kit = o.equipment_shortage === 0 && o.consumables_shortage === 0 && o.procurement_pending === 0;
  const day = executed && center.attendance.assigned > 0 && center.attendance.checked_out >= center.attendance.assigned;
  const closeout = eventStatus === "CLOSED" && num(center.commercial.outstanding) <= 0;

  const states: Partial<Record<WorkspaceTabGroup["id"], "done" | "current" | "todo">> = {
    deal: deal ? "done" : "todo",
    hosts: hosts ? "done" : "todo",
    kit: kit ? "done" : "todo",
    day: day ? "done" : "todo",
    closeout: closeout ? "done" : "todo",
  };
  // first not-done stage is "current"
  for (const id of ["deal", "hosts", "kit", "day", "closeout"] as const) {
    if (states[id] !== "done") {
      states[id] = "current";
      break;
    }
  }
  return states;
}
