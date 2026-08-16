import { fromDbAmount, type DbAmount, type MilliOMR } from "@/lib/money";

/**
 * Exact Pricing-tab totals.
 *
 * Every amount is normalized through `fromDbAmount` into integer milli-OMR
 * at the boundary and summed as integers — binary floating point is never
 * an arithmetic input for these displayed financial figures (AGENTS.md).
 * The database remains authoritative for persisted totals; these are the
 * exact sums of the authoritative per-line snapshots it returned.
 */
export interface PricingTotals {
  sellMilli: MilliOMR;
  costMilli: MilliOMR;
  profitMilli: MilliOMR;
}

export function pricingTotals(
  lines: ReadonlyArray<{
    total_selling: DbAmount;
    total_expected_cost?: DbAmount;
  }>,
): PricingTotals {
  let sellMilli = 0;
  let costMilli = 0;
  for (const line of lines) {
    sellMilli += fromDbAmount(line.total_selling);
    costMilli += fromDbAmount(line.total_expected_cost);
  }
  return { sellMilli, costMilli, profitMilli: sellMilli - costMilli };
}
