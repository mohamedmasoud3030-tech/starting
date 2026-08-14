/**
 * Centralized OMR money representation.
 *
 * INVARIANTS (see AGENTS.md):
 *  - OMR is stored/transported as an exact 3-decimal value.
 *  - The persisted domain is numeric(12,3): up to 9 integer digits + 3 decimal
 *    digits, i.e. [-999,999,999.999, 999,999,999.999]. PostgreSQL is the
 *    persisted financial authority; the frontend enforces the SAME domain so
 *    it never sends a value the database would reject.
 *  - No binary floating-point arithmetic is used as the financial source of
 *    truth. In-memory arithmetic uses integer milli-OMR (1 OMR = 1000), and
 *    multiplication uses BigInt so the intermediate product cannot overflow
 *    IEEE-754 safe-integer precision.
 *  - Rounding is centralized here: half away from zero, to 3 decimals.
 */

export const OMR_SCALE = 3;
export const OMR_SYMBOL = "ر.ع.";

/** Persisted money maximum: numeric(12,3) → 999,999,999.999 OMR. */
export const MAX_MONEY_MILLI = 999_999_999_999;
/** Persisted money minimum: -999,999,999.999 OMR. */
export const MIN_MONEY_MILLI = -999_999_999_999;

/** Max integer digits allowed before the decimal point (9 for numeric(12,3)). */
const MAX_INT_DIGITS = 9;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** A monetary amount represented exactly as integer milli-OMR. */
export type MilliOMR = number;

function inDomain(millis: number): boolean {
  return (
    Number.isSafeInteger(millis) &&
    millis >= MIN_MONEY_MILLI &&
    millis <= MAX_MONEY_MILLI
  );
}

/**
 * Parse a decimal string (e.g. "12.345", "8", "-0.500") into integer
 * milli-OMR. Accepts optional thousand separators (commas/spaces). Rejects
 * values outside the numeric(12,3) persisted domain and more than 3 decimals.
 */
export function parseOMR(input: string): MilliOMR {
  const cleaned = input.trim().replace(/[\s,،]/g, "");
  if (cleaned === "") throw new MoneyError("المبلغ فارغ");

  const match = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyError(`مبلغ غير صالح: ${input}`);
  }
  const negative = match[1] === "-";
  const intPart = match[2] ?? "0";
  const fracRaw = (match[3] ?? "").padEnd(OMR_SCALE, "0");

  if (intPart.length > MAX_INT_DIGITS) {
    throw new MoneyError("المبلغ أكبر من الحد الأقصى المسموح به");
  }

  const millis =
    Number.parseInt(intPart, 10) * 1000 + Number.parseInt(fracRaw, 10);
  const signed = negative ? -millis : millis;
  if (!inDomain(signed)) {
    throw new MoneyError("المبلغ خارج النطاق المسموح به");
  }
  return signed;
}

/** Convert an integer milli-OMR amount to its exact decimal string. */
export function toOMRString(millis: MilliOMR): string {
  if (!inDomain(millis)) {
    throw new MoneyError("مبلغ غير صالح (خارج نطاق الدقة)");
  }
  const negative = millis < 0;
  const abs = Math.abs(millis);
  const intPart = Math.floor(abs / 1000);
  const frac = abs % 1000;
  const fracStr = frac.toString().padStart(OMR_SCALE, "0");
  return `${negative ? "-" : ""}${intPart}.${fracStr}`;
}

/** Format milli-OMR for display, e.g. "12.345 ر.ع.". */
export function formatOMR(millis: MilliOMR): string {
  return `${toOMRString(millis)} ${OMR_SYMBOL}`;
}

/** Accept a DB string (numeric serialized by PostgREST) → milli-OMR. */
export function fromDbAmount(value: string | null | undefined): MilliOMR {
  if (value == null) return 0;
  return parseOMR(value);
}

/** Convert milli-OMR to a numeric string acceptable by PostgREST numeric. */
export function toDbAmount(millis: MilliOMR): string {
  return toOMRString(millis);
}

/** Parse an optional user-typed money string, returning 0 for empty input. */
export function parseOptionalOMR(input: string): MilliOMR {
  if (input.trim() === "") return 0;
  return parseOMR(input);
}

/** True if an amount is negative. */
export function isNegative(millis: MilliOMR): boolean {
  return millis < 0;
}

/**
 * Multiply a money amount (milli-OMR) by a quantity expressed in the SAME
 * 3-decimal scale (milli-units), returning milli-OMR rounded half away from
 * zero to 3 decimals.
 *
 * BigInt is used for the intermediate product so the multiplication is exact
 * and cannot overflow IEEE-754 safe-integer precision. The result is checked
 * against the persisted numeric(12,3) domain.
 *
 * Example: 2.300 OMR × 150 guests → multiplyOMR(2300, 150000) === 345000.
 */
export function multiplyOMR(
  amountMilli: MilliOMR,
  quantityMilli: MilliOMR,
): MilliOMR {
  if (!Number.isSafeInteger(amountMilli) || !Number.isSafeInteger(quantityMilli)) {
    throw new MoneyError("قيمة غير صالحة للضرب النقدي");
  }
  const product = BigInt(amountMilli) * BigInt(quantityMilli);

  // Divide by 1000 (milli^2 → milli), rounding half away from zero.
  let q = product / 1000n; // truncates toward zero
  const r = product % 1000n; // sign follows the dividend
  if (r >= 500n) q += 1n;
  else if (r <= -500n) q -= 1n;

  const result = Number(q);
  if (!inDomain(result)) {
    throw new MoneyError("نتيجة الضرب النقدي خارج النطاق المسموح به");
  }
  return result;
}

/**
 * Parse a quantity string ("150", "2.5", "0.5") into the same 3-decimal
 * integer scale used by money (milli-units), so it can be passed to
 * multiplyOMR. Rejects values outside the numeric(12,3) domain.
 */
export function parseQuantityMilli(input: string | number): MilliOMR {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("كمية غير صالحة");
    const millis = Math.round(input * 1000);
    if (!inDomain(millis)) throw new MoneyError("كمية خارج النطاق المسموح به");
    return millis;
  }
  return parseOMR(input);
}
