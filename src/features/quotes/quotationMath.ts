/**
 * Quotation — exact client-side line totals.
 *
 * These helpers MIRROR the server's `commercial_total()` (numeric, round half
 * away from zero to 3 decimals) so the live total shown to the owner before
 * issuing is EXACTLY what the database will persist. No binary float is ever
 * a source of financial truth: all arithmetic goes through the hardened
 * milli-OMR utilities in `@/lib/money` (BigInt intermediates).
 *
 * The DB remains the persisted authority; this only previews it.
 */

import {
  MoneyError,
  multiplyOMR,
  type MilliOMR,
} from "@/lib/money";

export type QuickPricingMethod =
  | "FIXED"
  | "PER_EVENT"
  | "PER_GUEST"
  | "PER_UNIT"
  | "PER_HOUR"
  | "PER_DAY"
  | "MANUAL";

/**
 * Round a non-negative BigInt dividend half away from zero.
 * The divisor converts the milli³ product to milli-OMR (÷1000), matching the
 * DB's `round(unit × qty × guests, 3)` in integer milli scale.
 */
function roundHalfAwayFromZero(product: bigint, divisor: bigint): number {
  let q = product / divisor;
  const r = product % divisor;
  if (r >= divisor / 2n) q += 1n;
  const result = Number(q);
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError("نتيجة الحساب خارج نطاق الدقة");
  }
  return result;
}

/**
 * Compute the total of one quotation line in milli-OMR.
 *
 * Matches the DB formula:
 *   FIXED          → unit_selling_price            (quantity ignored)
 *   PER_GUEST      → unit_selling_price × quantity × guests  (guests REQUIRED)
 *   everything else→ unit_selling_price × quantity
 *
 * Returns null when the line cannot be priced yet (PER_GUEST without a known
 * guest count) — the UI must then ask for the guest count, like the DB does.
 */
export function computeQuotationLineTotalMilli(
  method: QuickPricingMethod,
  unitSellingMilli: MilliOMR,
  quantityMilli: MilliOMR,
  guestCount: number | null,
): MilliOMR | null {
  if (method === "FIXED") {
    return unitSellingMilli;
  }
  if (method === "PER_GUEST") {
    if (guestCount === null || guestCount < 1) return null;
    // unitMilli × qtyMilli × guests = unit·qty·guests × 1e6 (milli³).
    // ÷1000 → unit·qty·guests × 1000 = exact milli-OMR of the product.
    const product =
      BigInt(unitSellingMilli) * BigInt(quantityMilli) * BigInt(guestCount);
    return roundHalfAwayFromZero(product, 1_000n);
  }
  return multiplyOMR(unitSellingMilli, quantityMilli);
}

/** Sum of all line totals; a line with an unpriceable total is skipped. */
export function sumQuotationLineTotals(
  totals: ReadonlyArray<MilliOMR | null>,
): MilliOMR {
  return totals.reduce<MilliOMR>(
    (sum, total) => (total === null ? sum : sum + total),
    0,
  );
}
