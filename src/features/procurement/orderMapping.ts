import { parseQuantityMilli } from "@/lib/money";
import type {
  Capability,
  ProcurementLineKind,
  ProcurementOrderLine,
  ProcurementOrderStatus,
  ProcurementReceipt,
} from "./contracts";

/**
 * Pure row→domain mapping shared by the cost and cost-free read paths of the
 * procurement adapter.
 *
 * Both paths return the same domain shapes; the only differences are which
 * database projection supplied the row and whether money fields are present.
 * Before this module the two branches of `getOrder` duplicated the line
 * mapping, the receive-capability derivation and the receipt grouping —
 * a drift hazard on authorization-relevant logic.
 */

export function toProcurementLineKind(
  kind: string | null | undefined,
): ProcurementLineKind {
  if (kind === "CONSUMABLE" || kind === "CATERING_SERVICE" || kind === "OTHER") {
    return kind;
  }
  return "OTHER";
}

/**
 * Whether THIS line may be received by THIS role in THIS order status.
 *
 * Mirrors the server's authorization (the database remains authoritative);
 * used only to present accurate controls:
 *  - nothing to receive → not receivable (no reason: it is simply complete),
 *  - order not CONFIRMED / PARTIALLY_RECEIVED → lifecycle refusal,
 *  - ACCOUNTANT never receives,
 *  - WAREHOUSE receives physical CONSUMABLE lines only.
 */
/**
 * Line-level receivability, mirroring the 0079 server gates: receiving
 * requires warehouse.dispatch, and a receiver WITHOUT procurement.manage is a
 * physical-goods handler — only CONSUMABLE lines are receivable for them.
 */
export function deriveLineReceiveCapability(
  status: ProcurementOrderStatus,
  access: { canReceive: boolean; canProcure: boolean },
  lineKind: string | null | undefined,
  remainingQuantityMilli: number,
): Capability {
  if (remainingQuantityMilli <= 0) return { allowed: false };
  if (status !== "CONFIRMED" && status !== "PARTIALLY_RECEIVED") {
    return { allowed: false, reason: "ITEM_NOT_RECEIVABLE" };
  }
  if (!access.canReceive) {
    return { allowed: false, reason: "PERMISSION_DENIED" };
  }
  if (!access.canProcure && lineKind !== "CONSUMABLE") {
    return { allowed: false, reason: "PERMISSION_DENIED" };
  }
  return { allowed: true };
}

export interface OrderLineSourceRow {
  order_line_id: string | null;
  description: string | null;
  line_kind: string | null;
  catalog_item_id?: string | null;
  unit: string | null;
  ordered_quantity: number | string | null;
  received_quantity: number | string | null;
  remaining_quantity: number | string | null;
}

/**
 * Map one projection row to a domain order line. Money fields are supplied
 * by the caller because only the cost path is authorized to see them —
 * `null` (not zero) means "not visible to this role".
 */
export function mapOrderLine(
  row: OrderLineSourceRow,
  status: ProcurementOrderStatus,
  access: { canReceive: boolean; canProcure: boolean },
  money: { unitCostMilli: number | null; lineTotalMilli: number | null },
): ProcurementOrderLine {
  const remainingMilli = parseQuantityMilli(row.remaining_quantity ?? 0);
  return {
    id: row.order_line_id!,
    description: row.description ?? "",
    kind: toProcurementLineKind(row.line_kind),
    catalogItemId: row.catalog_item_id,
    unit: row.unit ?? "",
    orderedQuantityMilli: parseQuantityMilli(row.ordered_quantity ?? 0),
    receivedQuantityMilli: parseQuantityMilli(row.received_quantity ?? 0),
    remainingQuantityMilli: remainingMilli,
    unitCostMilli: money.unitCostMilli,
    lineTotalMilli: money.lineTotalMilli,
    receive: deriveLineReceiveCapability(
      status,
      access,
      row.line_kind,
      remainingMilli,
    ),
  };
}

export interface ReceiptLineSourceRow {
  receipt_id: string | null;
  order_line_id: string | null;
  quantity: number | string | null;
}

/** Group raw receipt-line rows by receipt id. */
export function groupReceiptLines(
  rows: Iterable<ReceiptLineSourceRow>,
): Map<string, Array<{ orderLineId: string; quantityMilli: number }>> {
  const byReceipt = new Map<
    string,
    Array<{ orderLineId: string; quantityMilli: number }>
  >();
  for (const row of rows) {
    if (!row.receipt_id) continue;
    const list = byReceipt.get(row.receipt_id) ?? [];
    list.push({
      orderLineId: row.order_line_id!,
      quantityMilli: parseQuantityMilli(row.quantity ?? 0),
    });
    byReceipt.set(row.receipt_id, list);
  }
  return byReceipt;
}

export interface ReceiptSourceRow {
  receipt_id: string | null;
  reference: string | null;
  received_at: string | null;
  created_at?: string | null;
}

/** Map receipt header rows + grouped lines to domain receipts. */
export function mapReceipts(
  rows: Iterable<ReceiptSourceRow>,
  linesByReceipt: Map<string, Array<{ orderLineId: string; quantityMilli: number }>>,
): ProcurementReceipt[] {
  const receipts: ProcurementReceipt[] = [];
  for (const row of rows) {
    receipts.push({
      id: row.receipt_id!,
      receiptNumber: row.reference ?? null,
      receivedAt: row.received_at ?? row.created_at ?? "",
      lines: linesByReceipt.get(row.receipt_id!) ?? [],
    });
  }
  return receipts;
}

/**
 * Terminal orders have no outstanding deliveries by definition; otherwise
 * count the lines that still have remaining quantity.
 */
export function countOutstandingDeliveries(
  status: ProcurementOrderStatus,
  lines: ReadonlyArray<{ remainingQuantityMilli: number }>,
): number {
  const isTerminal = status === "RECEIVED" || status === "CANCELLED";
  return isTerminal
    ? 0
    : lines.filter((line) => line.remainingQuantityMilli > 0).length;
}
