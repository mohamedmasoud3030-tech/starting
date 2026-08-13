/**
 * Centralized OMR money representation.
 *
 * INVARIANTS (see AGENTS.md):
 *  - OMR is stored/transported as an exact 3-decimal value.
 *  - No binary floating-point arithmetic is used as the financial source of
 *    truth. All in-memory arithmetic uses integer "milli-OMR" (1 OMR = 1000).
 *  - Database persistence uses numeric(12,3); PostgREST returns it as a string,
 *    which this module parses losslessly.
 *  - Rounding is centralized here (half-up to 3 decimals).
 *
 * milli-OMR integers stay far below Number.MAX_SAFE_INTEGER (2^53 ≈ 9e15) for
 * any realistic amount (max numeric(12,3) = 999,999,999.999 → 999,999,999,999
 * milli-OMR), so integer math in JS is exact.
 */

export const OMR_SCALE = 3;
export const OMR_SYMBOL = "ر.ع.";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** A monetary amount represented exactly as integer milli-OMR. */
export type MilliOMR = number;

/**
 * Parse a decimal string (e.g. "12.345", "8", "-0.500") into integer
 * milli-OMR. Accepts optional thousand separators (commas/spaces). Throws
 * MoneyError on invalid input.
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

  if (intPart.length > 12) {
    throw new MoneyError("المبلغ كبير جداً");
  }

  const millis =
    Number.parseInt(intPart, 10) * 1000 + Number.parseInt(fracRaw, 10);
  return negative ? -millis : millis;
}

/** Convert an integer milli-OMR amount to its exact decimal string. */
export function toOMRString(millis: MilliOMR): string {
  if (!Number.isSafeInteger(millis)) {
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

/** Integer addition of two amounts. */
export function addOMR(a: MilliOMR, b: MilliOMR): MilliOMR {
  return a + b;
}

/** Integer subtraction. */
export function subOMR(a: MilliOMR, b: MilliOMR): MilliOMR {
  return a - b;
}

/** True if an amount is negative. */
export function isNegative(millis: MilliOMR): boolean {
  return millis < 0;
}

/**
 * Multiply a money amount (milli-OMR) by a quantity expressed in the SAME
 * 3-decimal scale (milli-units), returning milli-OMR rounded half-up to 3
 * decimals. Both operands are integers, so the multiply is exact up to the
 * final single rounding step.
 *
 * Example: 2.300 OMR × 150 guests
 *   multiplyOMR(2300, 150000) === 345000   // 345.000 OMR
 */
export function multiplyOMR(
  amountMilli: MilliOMR,
  quantityMilli: MilliOMR,
): MilliOMR {
  return Math.round((amountMilli * quantityMilli) / 1000);
}

/**
 * Parse a quantity string ("150", "2.5", "0.5") into the same 3-decimal
 * integer scale used by money (milli-units), so it can be passed to
 * multiplyOMR. Throws MoneyError on invalid input.
 */
export function parseQuantityMilli(input: string | number): MilliOMR {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("كمية غير صالحة");
    return Math.round(input * 1000);
  }
  return parseOMR(input);
}
