import type { PricingMethod, CompensationMethod } from "@/lib/domain";
import {
  type MilliOMR,
  multiplyOMR,
  parseQuantityMilli,
} from "@/lib/money";
import { daysBetween, hoursBetween } from "@/lib/time";
import { DomainError } from "@/lib/errors";

/**
 * Deterministic line totals.
 *
 * FIXED      → unit × 1
 * PER_EVENT  → unit × quantity
 * PER_GUEST  → unit × guestCount × quantity
 * PER_UNIT   → unit × quantity
 * PER_HOUR   → unit × quantity   (quantity = hours)
 * PER_DAY    → unit × quantity   (quantity = days)
 * MANUAL     → unit × quantity
 */
export function calculateLineTotal(
  method: PricingMethod,
  unitPriceMilli: MilliOMR,
  quantityMilli: MilliOMR,
  guestCount: number,
): MilliOMR {
  if (quantityMilli <= 0) {
    throw new DomainError("INVALID_QUANTITY", "الكمية يجب أن تكون أكبر من صفر");
  }
  if (guestCount < 1) {
    throw new DomainError("INVALID_GUESTS");
  }

  switch (method) {
    case "FIXED":
      return unitPriceMilli;
    case "PER_GUEST": {
      const guestsMilli = parseQuantityMilli(guestCount);
      const perGuest = multiplyOMR(unitPriceMilli, guestsMilli);
      return multiplyOMR(perGuest, quantityMilli);
    }
    case "PER_EVENT":
    case "PER_UNIT":
    case "PER_HOUR":
    case "PER_DAY":
    case "MANUAL":
      return multiplyOMR(unitPriceMilli, quantityMilli);
    default:
      throw new DomainError("VALIDATION", "طريقة تسعير غير معروفة");
  }
}

export function calculateCompensation(
  method: CompensationMethod,
  rateMilli: MilliOMR,
  startIso: string,
  endIso: string,
  manualTotalMilli?: MilliOMR,
): MilliOMR {
  switch (method) {
    case "PER_EVENT":
      return rateMilli;
    case "PER_HOUR": {
      const hours = hoursBetween(startIso, endIso);
      if (hours <= 0) throw new DomainError("INVALID_TIME");
      return multiplyOMR(rateMilli, parseQuantityMilli(hours));
    }
    case "PER_DAY": {
      const days = daysBetween(startIso, endIso);
      return multiplyOMR(rateMilli, parseQuantityMilli(days));
    }
    case "MANUAL":
      return manualTotalMilli ?? rateMilli;
    default:
      throw new DomainError("VALIDATION", "طريقة تعويض غير معروفة");
  }
}
