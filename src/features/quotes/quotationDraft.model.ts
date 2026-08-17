import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";
import {
  fromDbAmount,
  toOMRString,
  type DbAmount,
} from "@/lib/money";
import type { QuotationDraftValues, QuotationLineRow } from "./quotes.api";
import { isoToMuscatWallClock } from "@/lib/dates";

/**
 * Pure domain layer for the quotation draft editor. All transformation and
 * validation that does not need React state or network access lives here so
 * the editor component only orchestrates.
 */

export interface DraftLine {
  clientKey: string;
  id: string | null; // server id once persisted (edit mode)
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantity: string;
  unitSellingPrice: string;
  isCustom: boolean;
  expectedUnitCost: string;
  sourceCatalogItemId: string | null;
  sourcePackageId: string | null;
}

export interface DraftForm {
  prospectName: string;
  prospectPhone: string;
  prospectWhatsapp: string;
  prospectCompany: string;
  eventTitle: string;
  eventType: string;
  startAt: string;
  endAt: string;
  venueName: string;
  notes: string;
}

export function emptyForm(): DraftForm {
  return {
    prospectName: "",
    prospectPhone: "",
    prospectWhatsapp: "",
    prospectCompany: "",
    eventTitle: "",
    eventType: "",
    startAt: "",
    endAt: "",
    venueName: "",
    notes: "",
  };
}

export function toDraftValues(
  form: DraftForm,
  guestCount: number | null,
): QuotationDraftValues {
  return { ...form, guestCount };
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Pin the displayed wall clock to the operational timezone (D17): the
  // owner should re-open the same wall time on any device.
  return isoToMuscatWallClock(iso);
}

/** Hydrates the editable form from a persisted draft row (edit mode). */
export function hydrateFormFromDraft(draft: {
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  prospect_whatsapp: string | null;
  prospect_company: string | null;
  event_title_snapshot: string | null;
  event_type_snapshot: string | null;
  start_at_snapshot: string | null;
  end_at_snapshot: string | null;
  venue_snapshot: string | null;
  notes: string | null;
}): DraftForm {
  return {
    prospectName: draft.customer_name_snapshot,
    prospectPhone: draft.customer_phone_snapshot ?? "",
    prospectWhatsapp: draft.prospect_whatsapp ?? "",
    prospectCompany: draft.prospect_company ?? "",
    eventTitle: draft.event_title_snapshot ?? "",
    eventType: draft.event_type_snapshot ?? "",
    startAt: isoToLocalInput(draft.start_at_snapshot),
    endAt: isoToLocalInput(draft.end_at_snapshot),
    venueName: draft.venue_snapshot ?? "",
    notes: draft.notes ?? "",
  };
}

export function guestCountFromDraft(
  draft: { guest_count_snapshot: number | null },
): string {
  return draft.guest_count_snapshot != null
    ? String(draft.guest_count_snapshot)
    : "";
}

/** Hydrates editable lines from persisted server lines (edit mode). */
export function hydrateLinesFromServer(
  rows: ReadonlyArray<QuotationLineRow>,
): DraftLine[] {
  return rows.map((l) => ({
    clientKey: `server-${l.id}`,
    id: l.id,
    description: l.description,
    itemType: l.item_type,
    unit: l.unit,
    pricingMethod: l.pricing_method,
    quantity: l.quantity,
    unitSellingPrice: l.unit_selling_price,
    isCustom: l.is_custom,
    expectedUnitCost: l.expected_unit_cost ?? "0.000",
    sourceCatalogItemId: l.source_catalog_item_id,
    sourcePackageId: l.source_package_id,
  }));
}

/** Monotonic client-key factory keeps React keys stable across updates. */
export function createLineKeyFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `line-${counter}`;
  };
}

export function createCustomLine(
  nextKey: string,
  input: {
    description: string;
    quantity: string;
    price: string;
    itemType: string;
    unit: string;
    pricingMethod: string;
  },
): DraftLine {
  return {
    clientKey: nextKey,
    id: null,
    description: input.description,
    itemType: input.itemType as CatalogItemType,
    unit: input.unit.trim() || "وحدة",
    pricingMethod: input.pricingMethod as PricingMethod,
    quantity: input.quantity,
    unitSellingPrice: input.price,
    isCustom: true,
    expectedUnitCost: "0.000",
    sourceCatalogItemId: null,
    sourcePackageId: null,
  };
}

/**
 * Expands a package into draft lines using catalog snapshots. Quantities and
 * prices arrive in the database numeric transport shape and are normalized
 * through exact milli-OMR before being rendered as text — never via float
 * formatting (AGENTS.md money rules).
 */
export function buildPackageLines(
  pkg: { lines: ReadonlyArray<{ catalog_item_id: string; quantity: DbAmount }> },
  catalogById: ReadonlyMap<
    string,
    {
      id: string;
      name: string;
      item_type: CatalogItemType;
      unit: string;
      pricing_method: PricingMethod;
      selling_price: DbAmount;
      cost_price: DbAmount | null;
    }
  >,
  selectedPackageId: string,
  nextKey: () => string,
): DraftLine[] {
  return pkg.lines.map((l) => {
    const item = catalogById.get(l.catalog_item_id);
    if (!item) throw new Error("MISSING_CATALOG_ITEM");
    return {
      clientKey: nextKey(),
      id: null,
      description: item.name,
      itemType: item.item_type,
      unit: item.unit,
      pricingMethod: item.pricing_method,
      quantity: toOMRString(fromDbAmount(l.quantity)),
      unitSellingPrice: toOMRString(fromDbAmount(item.selling_price)),
      isCustom: false,
      expectedUnitCost:
        item.cost_price == null ? "0.000" : toOMRString(fromDbAmount(item.cost_price)),
      sourceCatalogItemId: item.id,
      sourcePackageId: selectedPackageId,
    };
  });
}

/** Server payload for the atomic persist command. */
export function toServerLinePayload(
  line: DraftLine,
): {
  id: string | null;
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantity: string;
  unitSellingPrice: string;
  expectedUnitCost: string;
  isCustom: boolean;
  sourceCatalogItemId: string | null;
  sourcePackageId: string | null;
} {
  return {
    id: line.id,
    description: line.description,
    itemType: line.itemType,
    unit: line.unit,
    pricingMethod: line.pricingMethod,
    quantity: line.quantity,
    unitSellingPrice: line.unitSellingPrice,
    expectedUnitCost: line.expectedUnitCost,
    isCustom: line.isCustom,
    sourceCatalogItemId: line.sourceCatalogItemId,
    sourcePackageId: line.sourcePackageId,
  };
}

/**
 * Stable fingerprint of the entire draft payload. Used to keep the same
 * idempotency key when retrying an unchanged payload after a lost response,
 * and to rotate it as soon as the payload actually changes.
 */
export function draftFingerprint(input: {
  quotationId: string | null;
  values: QuotationDraftValues;
  lines: ReadonlyArray<DraftLine>;
}): string {
  return JSON.stringify({
    quotationId: input.quotationId,
    values: input.values,
    lines: input.lines.map(toServerLinePayload),
  });
}
