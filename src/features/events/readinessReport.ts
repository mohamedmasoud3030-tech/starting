import type { Assignment, Capacity, CommercialLine, Reservation } from "./events.api";

/**
 * Explainable, rule-based readiness report for an event.
 *
 * The database `event_readiness` RPC remains the authoritative coarse status
 * (READY / STAFF_MISSING / EQUIPMENT_SHORTAGE / MULTIPLE_ISSUES) and drives the
 * dashboard and the dispatch override gate. THIS module turns the same inputs
 * into a checklist a human can read and act on, with a percentage that only
 * counts items that actually apply to the event.
 *
 * Rules (mirror the RPC formulas exactly so the two can never disagree):
 *   - Staff: required = Σ ceil(quantity) over STAFF lines; assigned = count of
 *     ACTIVE assignments.
 *   - Equipment: per REUSABLE_EQUIPMENT line, required = ceil(quantity);
 *     assigned = Σ ACTIVE reservations on the capacity whose catalog item
 *     equals the line's source catalog item.
 *   - Deposit: only when the event has an accepted quotation with revenue > 0;
 *     "assigned" = any recorded payment (amount_paid > 0).
 *
 * Non-applicable items are excluded from the denominator, so the percentage is
 * honest: an event with no equipment lines is not penalised for not reserving
 * equipment it does not need.
 *
 * Pure: no React, no data access.
 */

export interface ReadinessInput {
  lines: CommercialLine[];
  assignments: Assignment[];
  capacities: Capacity[];
  reservations: Reservation[];
  /** True when the event has an accepted quotation whose revenue is > 0. */
  hasPayableAcceptedQuotation: boolean;
  /** Recorded payments in milli-OMR (0 = no deposit yet). */
  amountPaidMilli: number;
}

export type ReadinessItemStatus = "ok" | "short";

export interface ReadinessItem {
  key: string;
  label: string;
  required: number;
  assigned: number;
  status: ReadinessItemStatus;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  /** Percentage of applicable items satisfied; null when nothing applies. */
  percent: number | null;
  overall: "READY" | "INCOMPLETE" | "EMPTY";
  staffMissing: number;
  equipmentShortage: number;
}

function activeAssignments(assignments: Assignment[]): Assignment[] {
  return assignments.filter((a) => a.status === "ACTIVE");
}

function activeReservations(reservations: Reservation[]): Reservation[] {
  return reservations.filter((r) => r.status === "ACTIVE");
}

/** ceil of a decimal string quantity to a whole resource count. */
function ceilQuantity(quantity: string): number {
  const n = Number(quantity);
  return Number.isFinite(n) ? Math.ceil(n) : 0;
}

export function buildReadinessReport(input: ReadinessInput): ReadinessReport {
  const staffLines = input.lines.filter((l) => l.item_type === "STAFF");
  const equipmentLines = input.lines.filter(
    (l) => l.item_type === "REUSABLE_EQUIPMENT",
  );

  // Staff (aggregate — matches the RPC, which counts assignments as a pool).
  const staffRequired = staffLines.reduce(
    (n, l) => n + ceilQuantity(l.quantity),
    0,
  );
  const staffAssigned = activeAssignments(input.assignments).length;
  const staffMissing = Math.max(staffRequired - staffAssigned, 0);

  const items: ReadinessItem[] = [];

  if (staffRequired > 0) {
    items.push({
      key: "staff",
      label: "الفريق (المضيفون والمشرفون)",
      required: staffRequired,
      assigned: staffAssigned,
      status: staffMissing === 0 ? "ok" : "short",
    });
  }

  // Equipment per line (matches the RPC's per-catalog-item join).
  const capacityItemById = new Map(
    input.capacities.map((c) => [c.id, c.catalog_item_id]),
  );
  const reservedByCatalogItem = new Map<string, number>();
  for (const r of activeReservations(input.reservations)) {
    const catalogItemId = capacityItemById.get(r.equipment_capacity_id);
    if (!catalogItemId) continue;
    reservedByCatalogItem.set(
      catalogItemId,
      (reservedByCatalogItem.get(catalogItemId) ?? 0) + r.quantity,
    );
  }

  let equipmentShortage = 0;
  for (const line of equipmentLines) {
    const required = ceilQuantity(line.quantity);
    if (required <= 0) continue;
    const assigned = reservedByCatalogItem.get(line.source_catalog_item_id ?? "") ?? 0;
    const missing = Math.max(required - assigned, 0);
    equipmentShortage += missing;
    items.push({
      key: `equipment-${line.id}`,
      label: line.description,
      required,
      assigned,
      status: missing === 0 ? "ok" : "short",
    });
  }

  // Deposit (only when a payable accepted quotation exists).
  if (input.hasPayableAcceptedQuotation) {
    items.push({
      key: "deposit",
      label: "العربون (دفعة مسجلة)",
      required: 1,
      assigned: input.amountPaidMilli > 0 ? 1 : 0,
      status: input.amountPaidMilli > 0 ? "ok" : "short",
    });
  }

  const shortCount = items.filter((i) => i.status === "short").length;
  const percent =
    items.length === 0
      ? null
      : Math.round(((items.length - shortCount) / items.length) * 100);

  const overall: ReadinessReport["overall"] =
    items.length === 0 ? "EMPTY" : shortCount === 0 ? "READY" : "INCOMPLETE";

  return {
    items,
    percent,
    overall,
    staffMissing,
    equipmentShortage,
  };
}
