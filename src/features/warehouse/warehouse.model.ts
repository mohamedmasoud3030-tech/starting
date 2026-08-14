/**
 * Warehouse domain model for the operator UI.
 *
 * Pure, framework-free logic so the operator-facing rules (what is blocked,
 * why, and what the operator is allowed to type) are unit-testable without a
 * database or a rendered tree.
 *
 * NULLABILITY POLICY
 * ------------------
 * `event_warehouse_lines` is a VIEW, so PostgreSQL cannot prove column
 * nullability and the generated types mark every column nullable. A missing
 * critical quantity is a DATA DEFECT, not a zero: coercing it would silently
 * show an operator "0 outstanding" for a line whose real state is unknown, and
 * they would close an Event with stock still in the field. `parseWarehouseLine`
 * therefore REJECTS such a row instead of defaulting it, and the UI renders an
 * explicit "بيانات غير مكتملة" state.
 */

import type { AppRole, ViewRow } from "@/lib/dbTypes";
import { fromDbAmount, type MilliOMR } from "@/lib/money";

/** Raw generated row shape of the operational warehouse read model. */
export type WarehouseLineRow = ViewRow<"event_warehouse_lines">;
/** Raw generated row shape of the cost-gated valued read model. */
export type WarehouseValuedRow = ViewRow<"event_warehouse_lines_valued">;

/** Event-level warehouse state, as returned by `event_warehouse_summary`. */
export type WarehouseSummaryStatus =
  | "NO_EQUIPMENT"
  | "AWAITING_DISPATCH"
  | "OUTSTANDING"
  | "READY_TO_RECONCILE"
  | "RECONCILED";

export interface WarehouseSummary {
  status: WarehouseSummaryStatus;
  reserved: number;
  dispatched: number;
  returned_good: number;
  damaged: number;
  lost: number;
  outstanding: number;
  is_reconciled: boolean;
}

/** A validated warehouse line, safe for the operator UI to render. */
export interface WarehouseLine {
  reservationId: string;
  eventId: string;
  equipmentName: string;
  equipmentUnit: string;
  reservationStatus: string;
  reserved: number;
  dispatched: number;
  returnedGood: number;
  damaged: number;
  lost: number;
  outstanding: number;
  /** Reservation units not yet dispatched — the "still to prepare" figure. */
  remainingToDispatch: number;
  isReconciled: boolean;
  /** Immutable damage/loss valuation; null when the role may not read cost. */
  damageLossValuationMilli: MilliOMR | null;
}

/** A row the UI must NOT render as if it were valid. */
export interface WarehouseLineDefect {
  reservationId: string | null;
  reason: "MISSING_QUANTITY" | "MISSING_IDENTITY";
}

export type WarehouseLineParse =
  | { ok: true; line: WarehouseLine }
  | { ok: false; defect: WarehouseLineDefect };

function isCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate one view row. Critical quantities are never defaulted to zero: a
 * null means the read model could not establish the fact, and the operator is
 * told so rather than shown a confident wrong number.
 */
export function parseWarehouseLine(
  row: WarehouseLineRow,
  valued?: WarehouseValuedRow | null,
): WarehouseLineParse {
  if (
    row.reservation_id === null ||
    row.event_id === null ||
    row.equipment_name === null
  ) {
    return {
      ok: false,
      defect: { reservationId: row.reservation_id, reason: "MISSING_IDENTITY" },
    };
  }

  if (
    !isCount(row.reserved_quantity) ||
    !isCount(row.dispatched_quantity) ||
    !isCount(row.returned_good_quantity) ||
    !isCount(row.damaged_quantity) ||
    !isCount(row.lost_quantity) ||
    !isCount(row.outstanding_quantity)
  ) {
    return {
      ok: false,
      defect: { reservationId: row.reservation_id, reason: "MISSING_QUANTITY" },
    };
  }

  return {
    ok: true,
    line: {
      reservationId: row.reservation_id,
      eventId: row.event_id,
      equipmentName: row.equipment_name,
      equipmentUnit: row.equipment_unit ?? "",
      reservationStatus: row.reservation_status ?? "UNKNOWN",
      reserved: row.reserved_quantity,
      dispatched: row.dispatched_quantity,
      returnedGood: row.returned_good_quantity,
      damaged: row.damaged_quantity,
      lost: row.lost_quantity,
      outstanding: row.outstanding_quantity,
      remainingToDispatch: Math.max(
        row.reserved_quantity - row.dispatched_quantity,
        0,
      ),
      isReconciled: row.is_reconciled === true,
      damageLossValuationMilli:
        valued && valued.damage_loss_valuation_omr !== null
          ? fromDbAmount(valued.damage_loss_valuation_omr)
          : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Authorization matrix — MIRRORS the database. The database is authoritative;
// this exists so the operator is never shown a button that will be rejected.
// ---------------------------------------------------------------------------

/** Roles that may perform physical warehouse movements. */
export const WAREHOUSE_OPERATION_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "SUPERVISOR",
  "WAREHOUSE",
];

/** Roles that may finalize the warehouse reconciliation of an Event. */
export const WAREHOUSE_RECONCILE_ROLES: AppRole[] = ["OWNER", "MANAGER"];

export function canOperateWarehouse(role: AppRole | null): boolean {
  return role !== null && WAREHOUSE_OPERATION_ROLES.includes(role);
}

export function canReconcileWarehouse(role: AppRole | null): boolean {
  return role !== null && WAREHOUSE_RECONCILE_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Blocked-state reasoning — every disabled control must explain itself in
// Arabic. A silently disabled button is a support call from a warehouse floor.
// ---------------------------------------------------------------------------

export type DispatchBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason:
        | "NOT_AUTHORIZED"
        | "RECONCILED"
        | "EVENT_NOT_DISPATCHABLE"
        | "RESERVATION_NOT_ACTIVE"
        | "NOTHING_REMAINING";
    };

/** Event statuses from which equipment may physically leave the warehouse. */
const DISPATCHABLE_EVENT_STATUSES = [
  "CONFIRMED",
  "PREPARING",
  "DISPATCHED",
  "IN_PROGRESS",
];

export function dispatchBlock(input: {
  role: AppRole | null;
  eventStatus: string;
  line: WarehouseLine;
}): DispatchBlock {
  if (!canOperateWarehouse(input.role)) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.line.isReconciled) {
    return { blocked: true, reason: "RECONCILED" };
  }
  if (!DISPATCHABLE_EVENT_STATUSES.includes(input.eventStatus)) {
    return { blocked: true, reason: "EVENT_NOT_DISPATCHABLE" };
  }
  if (input.line.reservationStatus !== "ACTIVE") {
    return { blocked: true, reason: "RESERVATION_NOT_ACTIVE" };
  }
  if (input.line.remainingToDispatch <= 0) {
    return { blocked: true, reason: "NOTHING_REMAINING" };
  }
  return { blocked: false };
}

export type ReturnBlock =
  | { blocked: false }
  | { blocked: true; reason: "NOT_AUTHORIZED" | "RECONCILED" | "NOTHING_OUTSTANDING" };

export function returnBlock(input: {
  role: AppRole | null;
  line: WarehouseLine;
}): ReturnBlock {
  if (!canOperateWarehouse(input.role)) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.line.isReconciled) {
    return { blocked: true, reason: "RECONCILED" };
  }
  if (input.line.outstanding <= 0) {
    return { blocked: true, reason: "NOTHING_OUTSTANDING" };
  }
  return { blocked: false };
}

export type ReconcileBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason: "NOT_AUTHORIZED" | "ALREADY_RECONCILED" | "OUTSTANDING" | "NO_EQUIPMENT";
      outstanding?: number;
    };

export function reconcileBlock(input: {
  role: AppRole | null;
  summary: WarehouseSummary;
}): ReconcileBlock {
  if (!canReconcileWarehouse(input.role)) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.summary.is_reconciled) {
    return { blocked: true, reason: "ALREADY_RECONCILED" };
  }
  if (input.summary.outstanding > 0) {
    return {
      blocked: true,
      reason: "OUTSTANDING",
      outstanding: input.summary.outstanding,
    };
  }
  if (input.summary.reserved === 0) {
    return { blocked: true, reason: "NO_EQUIPMENT" };
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Client-side quantity validation. The DATABASE is authoritative; this exists
// only so the operator gets an instant, readable Arabic answer instead of a
// round-trip and a PostgreSQL error string.
// ---------------------------------------------------------------------------

export type QuantityCheck =
  | { valid: true }
  | { valid: false; message: string };

export function validateDispatchQuantity(
  quantity: number,
  line: WarehouseLine,
): QuantityCheck {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { valid: false, message: "أدخل كمية صحيحة أكبر من صفر." };
  }
  if (quantity > line.remainingToDispatch) {
    return {
      valid: false,
      message: `لا يمكن صرف أكثر من المتبقي في الحجز (${line.remainingToDispatch}).`,
    };
  }
  return { valid: true };
}

export function validateReturnQuantities(
  input: { good: number; damaged: number; lost: number },
  line: WarehouseLine,
): QuantityCheck {
  const values = [input.good, input.damaged, input.lost];
  if (values.some((v) => !Number.isInteger(v) || v < 0)) {
    return { valid: false, message: "أدخل كميات صحيحة غير سالبة." };
  }
  const total = input.good + input.damaged + input.lost;
  if (total < 1) {
    return { valid: false, message: "أدخل كمية واحدة على الأقل." };
  }
  if (total > line.outstanding) {
    return {
      valid: false,
      message: `المجموع (${total}) أكبر من المتبقي بالخارج (${line.outstanding}).`,
    };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Arabic presentation
// ---------------------------------------------------------------------------

export const WAREHOUSE_STATUS_LABELS: Record<WarehouseSummaryStatus, string> = {
  NO_EQUIPMENT: "لا توجد معدات",
  AWAITING_DISPATCH: "بانتظار الصرف",
  OUTSTANDING: "معدات بالخارج",
  READY_TO_RECONCILE: "جاهزة للتسوية",
  RECONCILED: "تمت التسوية",
};

export const WAREHOUSE_STATUS_TONES: Record<
  WarehouseSummaryStatus,
  "neutral" | "success" | "warning" | "danger" | "brand"
> = {
  NO_EQUIPMENT: "neutral",
  AWAITING_DISPATCH: "brand",
  OUTSTANDING: "warning",
  READY_TO_RECONCILE: "brand",
  RECONCILED: "success",
};

const DISPATCH_BLOCK_MESSAGES: Record<
  Extract<DispatchBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "لا تملك صلاحية صرف المعدات.",
  RECONCILED: "تمت تسوية المخزن لهذه المناسبة ولا يمكن الصرف.",
  EVENT_NOT_DISPATCHABLE: "لا يمكن الصرف قبل تأكيد المناسبة.",
  RESERVATION_NOT_ACTIVE: "الحجز غير نشط.",
  NOTHING_REMAINING: "تم صرف كامل الكمية المحجوزة.",
};

const RETURN_BLOCK_MESSAGES: Record<
  Extract<ReturnBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "لا تملك صلاحية تسجيل الإرجاع.",
  RECONCILED: "تمت تسوية المخزن لهذه المناسبة ولا يمكن الإرجاع.",
  NOTHING_OUTSTANDING: "لا توجد كمية بالخارج لإرجاعها.",
};

const RECONCILE_BLOCK_MESSAGES: Record<
  Extract<ReconcileBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "التسوية النهائية من صلاحية المالك أو المدير فقط.",
  ALREADY_RECONCILED: "تمت التسوية النهائية مسبقاً.",
  OUTSTANDING: "لا يمكن التسوية وهناك كمية ما زالت بالخارج.",
  NO_EQUIPMENT: "لا توجد معدات محجوزة لتسويتها.",
};

export function dispatchBlockMessage(block: DispatchBlock): string | null {
  return block.blocked ? DISPATCH_BLOCK_MESSAGES[block.reason] : null;
}

export function returnBlockMessage(block: ReturnBlock): string | null {
  return block.blocked ? RETURN_BLOCK_MESSAGES[block.reason] : null;
}

export function reconcileBlockMessage(block: ReconcileBlock): string | null {
  if (!block.blocked) return null;
  if (block.reason === "OUTSTANDING") {
    return `${RECONCILE_BLOCK_MESSAGES.OUTSTANDING} المتبقي بالخارج: ${block.outstanding ?? 0}.`;
  }
  return RECONCILE_BLOCK_MESSAGES[block.reason];
}

/**
 * Translate a server error into operator Arabic.
 *
 * Raw PostgreSQL/PostgREST text is never shown: a warehouse operator cannot act
 * on `P0001 DISPATCH_EXCEEDS_RESERVATION`, and error text can leak schema
 * detail. Anything unrecognized becomes a single safe generic message.
 */
export function warehouseErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const map: Array<[string, string]> = [
    ["DISPATCH_EXCEEDS_RESERVATION", "الكمية المطلوبة أكبر من المتبقي في الحجز."],
    ["DISPATCH_EXCEEDS_PHYSICAL_CAPACITY", "لا توجد كمية كافية في المخزن؛ هناك معدات لم تُرجع بعد."],
    ["RETURN_EXCEEDS_OUTSTANDING", "الكمية المُرجعة أكبر من الكمية المتبقية بالخارج."],
    ["WAREHOUSE_OUTSTANDING_QUANTITY", "لا يمكن إتمام التسوية وهناك كمية ما زالت بالخارج."],
    ["WAREHOUSE_ALREADY_RECONCILED", "تمت تسوية المخزن لهذه المناسبة مسبقاً."],
    ["IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "تم إرسال نفس العملية ببيانات مختلفة. أعد المحاولة من جديد."],
    ["EVENT_NOT_DISPATCHABLE", "لا يمكن الصرف في حالة المناسبة الحالية."],
    ["RESERVATION_NOT_ACTIVE", "الحجز غير نشط."],
    ["RESERVATION_EVENT_MISMATCH", "الحجز لا يخص هذه المناسبة."],
    ["RESERVATION_NOT_FOUND", "تعذر العثور على الحجز."],
    ["INVALID_QUANTITY", "الكمية غير صالحة."],
    ["VALUATION_BASIS_UNAVAILABLE", "تعذر تحديد قيمة التالف أو المفقود. راجع بيانات الصنف."],
    ["NOT_AUTHORIZED", "لا تملك صلاحية تنفيذ هذه العملية."],
    ["NOT_AUTHENTICATED", "انتهت الجلسة. سجّل الدخول من جديد."],
  ];
  for (const [code, message] of map) {
    if (raw.includes(code)) return message;
  }
  return "تعذر إتمام العملية. أعد المحاولة أو راجع المسؤول.";
}
