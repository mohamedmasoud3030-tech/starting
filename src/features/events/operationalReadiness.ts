/**
 * Canonical OPERATIONAL readiness contract (single source of truth).
 *
 * The database owns the formula — `event_operational_readiness()` (0082) — and
 * every surface (event command center, today dashboard, calendar, operations
 * board, management alerts) renders the SAME server-shaped result. Nothing in
 * this module recomputes readiness: it only types and labels the canonical
 * model. A React-side re-derivation is exactly what §“Canonical Operational
 * Readiness” forbids, which is why the former `readinessReport.ts` mirror of
 * the SQL formula was deleted when this contract landed.
 *
 * Readiness answers ONE question: what does this event still need OPERATIONALLY
 * (staff, equipment, consumables, procurement). Customer money NEVER appears
 * in `status`/`reasons`; commercial state is a separate projection
 * (`commercial` in the command-center payload / `today_collections`).
 */

/** Machine-readable operational blockers — the canonical reason codes. */
export const READINESS_REASONS = [
  "STAFF_SHORTAGE",
  "EQUIPMENT_SHORTAGE",
  "CONSUMABLE_SHORTAGE",
  "PROCUREMENT_PENDING",
] as const;

export type ReadinessReasonCode = (typeof READINESS_REASONS)[number];

/** One row of the canonical `event_operational_readiness` batch read model. */
export interface OperationalReadiness {
  status: "READY" | "NOT_READY";
  reasons: ReadinessReasonCode[];
  staff_required: number;
  staff_assigned: number;
  staff_missing: number;
  /** count of equipment line items whose reservations do not cover the requirement */
  equipment_shortage: number;
  /** count of consumable line items whose event issue quantity does not cover the requirement */
  consumables_shortage: number;
  /** count of issued (non-draft, non-received) procurement orders the event depends on */
  procurement_pending: number;
}

/**
 * Short Arabic label for a canonical readiness status.
 *
 * `null` (readiness could not be established) must NEVER read as “ready”:
 * an operator seeing a confident green badge on unresolved data is a defect.
 */
export function readinessLabel(status: string | null | undefined): string {
  switch (status) {
    case "READY":
      return "جاهزة للتنفيذ";
    case "NOT_READY":
      return "غير جاهزة";
    default:
      return "الجاهزية غير متاحة";
  }
}

export type ReadinessTone = "success" | "warning" | "danger" | "neutral";

/** Presentation tone — unknown readiness is never `success`. */
export function readinessTone(
  status: string | null | undefined,
): ReadinessTone {
  switch (status) {
    case "READY":
      return "success";
    case "NOT_READY":
      return "warning";
    default:
      return "neutral";
  }
}

/** Arabic label for a machine-readable reason code. */
export function readinessReasonLabel(reason: ReadinessReasonCode): string {
  switch (reason) {
    case "STAFF_SHORTAGE":
      return "ينقص مضيفين";
    case "EQUIPMENT_SHORTAGE":
      return "أصناف معدات ناقصة";
    case "CONSUMABLE_SHORTAGE":
      return "مواد استهلاكية ناقصة";
    case "PROCUREMENT_PENDING":
      return "التموين لم يصل";
  }
}

/** Detail fragment for a reason ("ناقص 2 مضيفين" style), server counts only. */
export function readinessReasonDetail(
  reason: ReadinessReasonCode,
  readiness: OperationalReadiness,
): string {
  switch (reason) {
    case "STAFF_SHORTAGE":
      return `المطلوب ${readiness.staff_required} / المسند ${readiness.staff_assigned} — ينقص ${readiness.staff_missing}`;
    case "EQUIPMENT_SHORTAGE":
      return `${readiness.equipment_shortage} أصناف غير مغطاة بالحجوزات`;
    case "CONSUMABLE_SHORTAGE":
      return `${readiness.consumables_shortage} أصناف مواد دون المطلوب`;
    case "PROCUREMENT_PENDING":
      return `${readiness.procurement_pending} أمر شراء بانتظار الاستلام`;
  }
}

/**
 * Full Arabic explanation of a readiness result. Rendered wherever a human
 * must ACT on the result — a bare boolean is forbidden by the product rules.
 */
export function readinessExplain(readiness: OperationalReadiness): string {
  if (readiness.status === "READY") return "كل الأبعاد التشغيلية مكتملة";
  if (readiness.reasons.length === 0) return "تحتاج مراجعة";
  return readiness.reasons
    .map((r) => readinessReasonDetail(r, readiness))
    .join(" · ");
}

/**
 * The tab a readiness reason sends an operator to (command-center and today
 * dashboard navigation use the SAME mapping — no dead-end warnings).
 */
export function readinessReasonTab(
  reason: ReadinessReasonCode,
):
  | "الفريق"
  | "المعدات"
  | "المخزن"
  | "المواد"
  | "المشتريات" {
  switch (reason) {
    case "STAFF_SHORTAGE":
      return "الفريق";
    case "EQUIPMENT_SHORTAGE":
      return "المعدات";
    case "CONSUMABLE_SHORTAGE":
      return "المواد";
    case "PROCUREMENT_PENDING":
      return "المشتريات";
  }
}

/** Next-action vocabulary produced by the server command-center projection. */
export const NEXT_ACTION_CODES = [
  "COMPLETE_STAFF_ASSIGNMENT",
  "COVER_EQUIPMENT",
  "COVER_CONSUMABLES",
  "FOLLOW_UP_PROCUREMENT",
  "RECORD_ATTENDANCE",
  "PROCEED_DISPATCH",
  "NONE",
] as const;

export type NextActionCode = (typeof NEXT_ACTION_CODES)[number];

/** Where a next action navigates inside the workspace. */
export const NEXT_ACTION_TAB: Record<NextActionCode, WorkspaceTabTarget> = {
  COMPLETE_STAFF_ASSIGNMENT: "الفريق",
  COVER_EQUIPMENT: "المعدات",
  COVER_CONSUMABLES: "المواد",
  FOLLOW_UP_PROCUREMENT: "المشتريات",
  RECORD_ATTENDANCE: "الحضور",
  PROCEED_DISPATCH: "ملخص",
  NONE: "ملخص",
};

export type WorkspaceTabTarget =
  | "ملخص"
  | "التسعير"
  | "الفريق"
  | "المعدات"
  | "المخزن"
  | "المواد"
  | "المشتريات"
  | "المدفوعات"
  | "الفواتير"
  | "المالية"
  | "الحضور"
  | "الأجور"
  | "السجل";
