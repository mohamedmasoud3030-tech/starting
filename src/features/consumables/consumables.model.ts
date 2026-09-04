/**
 * Consumable inventory domain model for the operator UI (S4B).
 *
 * Pure, framework-free logic so the operator-facing rules (what is blocked,
 * why, and what the operator is allowed to type) are unit-testable without a
 * database or a rendered tree.
 *
 * EXACT QUANTITIES
 * ----------------
 * Consumables use fractional units (kg / litre / pack / box / piece) with the
 * SAME exact 3-decimal boundary as money: user input is normalized through
 * `parseQuantityMilli` into integer milli-units, arithmetic happens on those
 * integers, and the wire value is the exact decimal string. No binary
 * floating-point value is ever an inventory truth.
 *
 * NULLABILITY POLICY (same as S4A)
 * --------------------------------
 * The read models are VIEWS, so every generated column is nullable. A missing
 * critical quantity is a DATA DEFECT, not a zero: coercing it would show an
 * operator "0 متبقي" for a line whose real state is unknown. Rows with
 * missing critical values are REJECTED into an explicit defect state.
 */

import type { AppRole, ViewRow } from "@/lib/dbTypes";
import {
  MoneyError,
  parseQuantityMilli,
  toOMRString,
  type MilliOMR,
} from "@/lib/money";

/** Raw generated row of the central stock read model. */
export type StockSummaryRow = ViewRow<"consumable_stock_summary">;
/** Raw generated row of the per-Event consumable read model. */
export type EventConsumableLineRow = ViewRow<"event_consumable_lines">;

// ---------------------------------------------------------------------------
// Exact quantity boundary
// ---------------------------------------------------------------------------

/** An exact consumable quantity in integer milli-units (1 unit = 1000). */
export type QuantityMilli = MilliOMR;

/**
 * Parse operator-typed quantity text into exact milli-units.
 * Returns a readable Arabic error instead of throwing.
 */
export function parseQuantityInput(
  input: string,
): { ok: true; milli: QuantityMilli } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "أدخل الكمية." };
  }
  let milli: QuantityMilli;
  try {
    milli = parseQuantityMilli(trimmed);
  } catch (e) {
    if (e instanceof MoneyError) {
      return { ok: false, message: "أدخل كمية صحيحة بثلاث خانات عشرية كحد أقصى." };
    }
    throw e;
  }
  if (milli <= 0) {
    return { ok: false, message: "الكمية يجب أن تكون أكبر من صفر." };
  }
  return { ok: true, milli };
}

/**
 * Normalize a database numeric transport value into exact milli-units.
 * Throws on non-finite / over-precision values instead of inventing a zero.
 */
export function quantityFromDb(value: number | string): QuantityMilli {
  return parseQuantityMilli(value);
}

/** Exact decimal string of a milli-unit quantity, e.g. 12500 -> "12.500". */
export function quantityToDecimalString(milli: QuantityMilli): string {
  return toOMRString(milli);
}

/**
 * Human display of an exact quantity: trailing zeros trimmed ("12.500" →
 * "12.5", "3.000" → "3") because an operator reads whole packs far more often
 * than milligrams. The exact value still travels untrimmed on the wire.
 */
export function formatQuantity(milli: QuantityMilli): string {
  const text = toOMRString(milli);
  // toOMRString always emits exactly 3 decimals; trim only the FRACTIONAL
  // trailing zeros (never integer digits), then a dangling decimal point.
  return text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
}

// ---------------------------------------------------------------------------
// Stock summary model
// ---------------------------------------------------------------------------

/** A validated stock line, safe for the operator UI to render. */
export interface StockLine {
  stockItemId: string;
  catalogItemId: string;
  itemName: string;
  itemUnit: string;
  isTrackingActive: boolean;
  minimumMilli: QuantityMilli;
  onHandMilli: QuantityMilli;
  isLowStock: boolean;
}

export interface StockLineDefect {
  stockItemId: string | null;
  reason: "MISSING_IDENTITY" | "MISSING_QUANTITY";
}

export type StockLineParse =
  | { ok: true; line: StockLine }
  | { ok: false; defect: StockLineDefect };

/**
 * Validate one stock summary row. Critical quantities are never defaulted:
 * a null balance means the read model could not establish the fact and the
 * operator is told so instead of being shown a confident wrong number.
 */
export function parseStockLine(row: StockSummaryRow): StockLineParse {
  if (
    row.stock_item_id === null ||
    row.catalog_item_id === null ||
    row.item_name === null
  ) {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_IDENTITY" },
    };
  }
  if (
    row.on_hand_quantity === null ||
    row.minimum_stock_quantity === null ||
    row.is_low_stock === null
  ) {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_QUANTITY" },
    };
  }
  let onHandMilli: QuantityMilli;
  let minimumMilli: QuantityMilli;
  try {
    onHandMilli = quantityFromDb(row.on_hand_quantity);
    minimumMilli = quantityFromDb(row.minimum_stock_quantity);
  } catch {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_QUANTITY" },
    };
  }
  return {
    ok: true,
    line: {
      stockItemId: row.stock_item_id,
      catalogItemId: row.catalog_item_id,
      itemName: row.item_name,
      itemUnit: row.item_unit ?? "",
      isTrackingActive: row.is_tracking_active === true,
      minimumMilli,
      onHandMilli,
      isLowStock: row.is_low_stock === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Event consumable line model
// ---------------------------------------------------------------------------

export interface EventConsumableLine {
  stockItemId: string;
  eventId: string;
  itemName: string;
  itemUnit: string;
  issuedMilli: QuantityMilli;
  returnedMilli: QuantityMilli;
  consumedMilli: QuantityMilli;
  wastedMilli: QuantityMilli;
  outstandingMilli: QuantityMilli;
  isReconciled: boolean;
}

export interface EventLineDefect {
  stockItemId: string | null;
  reason: "MISSING_IDENTITY" | "MISSING_QUANTITY";
}

export type EventLineParse =
  | { ok: true; line: EventConsumableLine }
  | { ok: false; defect: EventLineDefect };

export function parseEventConsumableLine(
  row: EventConsumableLineRow,
): EventLineParse {
  if (
    row.stock_item_id === null ||
    row.event_id === null ||
    row.item_name === null
  ) {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_IDENTITY" },
    };
  }
  if (
    row.issued_quantity === null ||
    row.returned_quantity === null ||
    row.consumed_quantity === null ||
    row.wasted_quantity === null ||
    row.outstanding_quantity === null
  ) {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_QUANTITY" },
    };
  }
  try {
    return {
      ok: true,
      line: {
        stockItemId: row.stock_item_id,
        eventId: row.event_id,
        itemName: row.item_name,
        itemUnit: row.item_unit ?? "",
        issuedMilli: quantityFromDb(row.issued_quantity),
        returnedMilli: quantityFromDb(row.returned_quantity),
        consumedMilli: quantityFromDb(row.consumed_quantity),
        wastedMilli: quantityFromDb(row.wasted_quantity),
        outstandingMilli: quantityFromDb(row.outstanding_quantity),
        isReconciled: row.is_reconciled === true,
      },
    };
  } catch {
    return {
      ok: false,
      defect: { stockItemId: row.stock_item_id, reason: "MISSING_QUANTITY" },
    };
  }
}

// ---------------------------------------------------------------------------
// Event-level summary (from event_consumable_summary RPC)
// ---------------------------------------------------------------------------

export type ConsumableSummaryStatus =
  | "NO_CONSUMABLES"
  | "OUTSTANDING"
  | "READY_TO_RECONCILE"
  | "RECONCILED";

export interface ConsumableSummary {
  status: ConsumableSummaryStatus;
  issuedMilli: QuantityMilli;
  returnedMilli: QuantityMilli;
  consumedMilli: QuantityMilli;
  wastedMilli: QuantityMilli;
  outstandingMilli: QuantityMilli;
  isReconciled: boolean;
}

/** Parse the RPC jsonb payload; quantities travel as exact decimal text. */
export function parseConsumableSummary(raw: unknown): ConsumableSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const statuses: ConsumableSummaryStatus[] = [
    "NO_CONSUMABLES",
    "OUTSTANDING",
    "READY_TO_RECONCILE",
    "RECONCILED",
  ];
  const status = statuses.find((s) => s === o.status);
  if (!status) return null;
  const q = (key: string): QuantityMilli | null => {
    const v = o[key];
    if (typeof v !== "string" && typeof v !== "number") return null;
    try {
      return parseQuantityMilli(v);
    } catch {
      return null;
    }
  };
  const issued = q("issued");
  const returned = q("returned");
  const consumed = q("consumed");
  const wasted = q("wasted");
  const outstanding = q("outstanding");
  if (
    issued === null ||
    returned === null ||
    consumed === null ||
    wasted === null ||
    outstanding === null
  ) {
    return null;
  }
  return {
    status,
    issuedMilli: issued,
    returnedMilli: returned,
    consumedMilli: consumed,
    wastedMilli: wasted,
    outstandingMilli: outstanding,
    isReconciled: o.is_reconciled === true,
  };
}

// ---------------------------------------------------------------------------
// Authorization matrix — MIRRORS the database. The database is authoritative;
// this exists so the operator is never shown a button that will be rejected.
// ---------------------------------------------------------------------------

/** Roles that may perform physical consumable movements. */
export const CONSUMABLE_OPERATION_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "SUPERVISOR",
  "WAREHOUSE",
];

/** Roles for sensitive corrections (adjustment) and final reconciliation. */
export const CONSUMABLE_MANAGE_ROLES: AppRole[] = ["OWNER", "MANAGER"];

/**
 * Capability check with the role preset as the loading fallback (same
 * contract as `eventPermissions`): while the server capability report is
 * still loading (`capabilities === null`) the role arrays — identical to
 * the server's `role_default_capability` for the matching caps — apply.
 */
function capabilityAllowed(
  capability: string,
  fallbackRoles: AppRole[],
  role: AppRole | null,
  capabilities: Set<string> | null,
): boolean {
  return capabilities !== null
    ? capabilities.has(capability)
    : role !== null && fallbackRoles.includes(role);
}

/** consumable.manage — issue / return / consume / waste / receive. */
export function canOperateConsumables(
  role: AppRole | null,
  capabilities: Set<string> | null = null,
): boolean {
  return capabilityAllowed(
    "consumable.manage",
    CONSUMABLE_OPERATION_ROLES,
    role,
    capabilities,
  );
}

/** stock.adjust — sensitive corrections and final reconciliation. */
export function canManageConsumables(
  role: AppRole | null,
  capabilities: Set<string> | null = null,
): boolean {
  return capabilityAllowed(
    "stock.adjust",
    CONSUMABLE_MANAGE_ROLES,
    role,
    capabilities,
  );
}

// ---------------------------------------------------------------------------
// Blocked-state reasoning — every disabled control explains itself in Arabic.
// ---------------------------------------------------------------------------

/** Event statuses from which consumables may be issued. */
const ISSUABLE_EVENT_STATUSES = [
  "CONFIRMED",
  "PREPARING",
  "DISPATCHED",
  "IN_PROGRESS",
];

export type IssueBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason: "NOT_AUTHORIZED" | "RECONCILED" | "EVENT_NOT_ISSUABLE";
    };

export function issueBlock(input: {
  /** consumable.manage — precomputed by the caller via `canOperateConsumables`. */
  canOperate: boolean;
  eventStatus: string;
  isReconciled: boolean;
}): IssueBlock {
  if (!input.canOperate) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.isReconciled) {
    return { blocked: true, reason: "RECONCILED" };
  }
  if (!ISSUABLE_EVENT_STATUSES.includes(input.eventStatus)) {
    return { blocked: true, reason: "EVENT_NOT_ISSUABLE" };
  }
  return { blocked: false };
}

export type CustodyBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason: "NOT_AUTHORIZED" | "RECONCILED" | "NOTHING_OUTSTANDING";
    };

/** Applies to return / consume / event-waste — anything that reduces custody. */
export function custodyBlock(input: {
  /** consumable.manage — precomputed by the caller via `canOperateConsumables`. */
  canOperate: boolean;
  line: EventConsumableLine;
}): CustodyBlock {
  if (!input.canOperate) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.line.isReconciled) {
    return { blocked: true, reason: "RECONCILED" };
  }
  if (input.line.outstandingMilli <= 0) {
    return { blocked: true, reason: "NOTHING_OUTSTANDING" };
  }
  return { blocked: false };
}

export type ReconcileBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason:
        | "NOT_AUTHORIZED"
        | "ALREADY_RECONCILED"
        | "OUTSTANDING"
        | "NO_CONSUMABLES";
      outstandingMilli?: QuantityMilli;
    };

export function reconcileConsumablesBlock(input: {
  /** stock.adjust — precomputed by the caller via `canManageConsumables`. */
  canManage: boolean;
  summary: ConsumableSummary;
}): ReconcileBlock {
  if (!input.canManage) {
    return { blocked: true, reason: "NOT_AUTHORIZED" };
  }
  if (input.summary.isReconciled) {
    return { blocked: true, reason: "ALREADY_RECONCILED" };
  }
  if (input.summary.outstandingMilli > 0) {
    return {
      blocked: true,
      reason: "OUTSTANDING",
      outstandingMilli: input.summary.outstandingMilli,
    };
  }
  if (input.summary.issuedMilli === 0) {
    return { blocked: true, reason: "NO_CONSUMABLES" };
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Client-side quantity validation against a limit. The DATABASE is
// authoritative; this only gives the operator an instant Arabic answer.
// ---------------------------------------------------------------------------

export type QuantityCheck =
  | { valid: true; milli: QuantityMilli }
  | { valid: false; message: string };

export function validateQuantityAgainst(
  input: string,
  limitMilli: QuantityMilli,
  limitLabel: string,
): QuantityCheck {
  const parsed = parseQuantityInput(input);
  if (!parsed.ok) return { valid: false, message: parsed.message };
  if (parsed.milli > limitMilli) {
    return {
      valid: false,
      message: `الكمية أكبر من ${limitLabel} (${formatQuantity(limitMilli)}).`,
    };
  }
  return { valid: true, milli: parsed.milli };
}

// ---------------------------------------------------------------------------
// Arabic presentation
// ---------------------------------------------------------------------------

export const CONSUMABLE_STATUS_LABELS: Record<ConsumableSummaryStatus, string> = {
  NO_CONSUMABLES: "لا توجد مواد مصروفة",
  OUTSTANDING: "مواد متبقية مع المناسبة",
  READY_TO_RECONCILE: "جاهزة للتسوية",
  RECONCILED: "تمت التسوية",
};

export const CONSUMABLE_STATUS_TONES: Record<
  ConsumableSummaryStatus,
  "neutral" | "success" | "warning" | "danger" | "brand"
> = {
  NO_CONSUMABLES: "neutral",
  OUTSTANDING: "warning",
  READY_TO_RECONCILE: "brand",
  RECONCILED: "success",
};

const ISSUE_BLOCK_MESSAGES: Record<
  Extract<IssueBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "لا تملك صلاحية صرف المواد.",
  RECONCILED: "تمت تسوية مواد هذه المناسبة ولا يمكن الصرف.",
  EVENT_NOT_ISSUABLE: "لا يمكن الصرف في حالة المناسبة الحالية.",
};

const CUSTODY_BLOCK_MESSAGES: Record<
  Extract<CustodyBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "لا تملك صلاحية تسجيل هذه العملية.",
  RECONCILED: "تمت تسوية مواد هذه المناسبة ولا يمكن التعديل.",
  NOTHING_OUTSTANDING: "لا توجد كمية متبقية مع المناسبة.",
};

const RECONCILE_BLOCK_MESSAGES: Record<
  Extract<ReconcileBlock, { blocked: true }>["reason"],
  string
> = {
  NOT_AUTHORIZED: "التسوية النهائية من صلاحية المالك أو المدير فقط.",
  ALREADY_RECONCILED: "تمت التسوية النهائية مسبقاً.",
  OUTSTANDING: "لا يمكن التسوية وهناك كمية ما زالت مع المناسبة.",
  NO_CONSUMABLES: "لا توجد مواد مصروفة لتسويتها.",
};

export function issueBlockMessage(block: IssueBlock): string | null {
  return block.blocked ? ISSUE_BLOCK_MESSAGES[block.reason] : null;
}

export function custodyBlockMessage(block: CustodyBlock): string | null {
  return block.blocked ? CUSTODY_BLOCK_MESSAGES[block.reason] : null;
}

export function reconcileConsumablesBlockMessage(
  block: ReconcileBlock,
): string | null {
  if (!block.blocked) return null;
  if (block.reason === "OUTSTANDING") {
    return `${RECONCILE_BLOCK_MESSAGES.OUTSTANDING} المتبقي: ${formatQuantity(block.outstandingMilli ?? 0)}.`;
  }
  return RECONCILE_BLOCK_MESSAGES[block.reason];
}

/**
 * Translate a server error into operator Arabic.
 *
 * Raw PostgreSQL/PostgREST text is never shown; anything unrecognized becomes
 * a single safe generic message.
 */
export function consumableErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const map: Array<[string, string]> = [
    ["CONSUMABLE_STOCK_SHORTAGE", "الكمية المطلوبة غير متوفرة في المخزن."],
    ["CONSUMABLE_EXCEEDS_OUTSTANDING", "الكمية أكبر من المتبقي مع المناسبة."],
    ["CONSUMABLE_OUTSTANDING_QUANTITY", "لا يمكن إتمام التسوية وهناك كمية ما زالت مع المناسبة."],
    ["CONSUMABLES_ALREADY_RECONCILED", "تمت تسوية مواد هذه المناسبة مسبقاً."],
    ["CONSUMABLE_TRACKING_INACTIVE", "تتبع هذا الصنف موقوف. فعّل التتبع أولاً."],
    ["CONSUMABLE_STOCK_ITEM_NOT_FOUND", "تعذر العثور على صنف المخزون."],
    ["CATALOG_ITEM_NOT_CONSUMABLE", "هذا الصنف ليس من المواد الاستهلاكية."],
    ["CATALOG_ITEM_NOT_ACTIVE", "الصنف غير نشط في الكتالوج."],
    ["CATALOG_ITEM_NOT_FOUND", "تعذر العثور على الصنف."],
    ["QUANTITY_PRECISION_EXCEEDED", "الكمية تتجاوز الدقة المسموحة (ثلاث خانات عشرية)."],
    ["QUANTITY_OUT_OF_RANGE", "الكمية خارج النطاق المسموح."],
    ["INVALID_QUANTITY", "الكمية غير صالحة."],
    ["WASTE_REASON_REQUIRED", "سبب الإتلاف مطلوب."],
    ["ADJUSTMENT_REASON_REQUIRED", "سبب التعديل مطلوب."],
    ["EVENT_NOT_ISSUABLE", "لا يمكن الصرف في حالة المناسبة الحالية."],
    ["EVENT_NOT_FOUND", "تعذر العثور على المناسبة."],
    ["IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "تم إرسال نفس العملية ببيانات مختلفة. أعد المحاولة من جديد."],
    ["NOT_AUTHORIZED", "لا تملك صلاحية تنفيذ هذه العملية."],
    ["NOT_AUTHENTICATED", "انتهت الجلسة. سجّل الدخول من جديد."],
  ];
  for (const [code, message] of map) {
    if (raw.includes(code)) return message;
  }
  return "تعذر إتمام العملية. أعد المحاولة أو راجع المسؤول.";
}
