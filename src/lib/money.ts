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

/**
 * A monetary value exactly as PostgREST transports it.
 *
 * PostgreSQL `numeric(12,3)` is serialized into JSON by PostgREST as a JSON
 * number, which `supabase gen types` therefore types as `number`. That
 * transport shape is the DATABASE TRUTH and is preserved verbatim at the
 * generated boundary — it is never redefined as `string`. Older code paths
 * (and hand-written row interfaces) may still carry the value as a decimal
 * string, so both are accepted here and normalized on the way in.
 *
 * A JS `number` is NEVER used for arithmetic: `fromDbAmount` converts it to
 * exact integer milli-OMR immediately, and all business math runs on that.
 */
export type DbAmount = number | string | null | undefined;

/**
 * Exact decimal text of a JSON-transported numeric, without float arithmetic.
 *
 * `Number.prototype.toString()` yields the shortest decimal string that
 * round-trips to the same IEEE-754 double. Because the persisted domain is
 * numeric(12,3) — at most 3 decimal places and at most 9 integer digits —
 * every representable value's shortest form IS its exact decimal form, so no
 * precision is invented or lost. Values outside that domain are rejected by
 * `parseOMR` rather than being silently rounded.
 */
function numericToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MoneyError("مبلغ غير صالح من قاعدة البيانات");
  }
  // Reject exponential notation defensively: it cannot occur within
  // numeric(12,3), so its presence means the value is out of domain.
  const text = value.toString();
  if (text.includes("e") || text.includes("E")) {
    throw new MoneyError("المبلغ خارج النطاق المسموح به");
  }
  return text;
}

/**
 * Normalize a money value received from the database into exact milli-OMR.
 *
 * This is the single boundary where database transport becomes authoritative
 * in-memory money. Accepts the generated `number` transport shape and the
 * legacy decimal-string shape; both normalize to the identical integer.
 */
export function fromDbAmount(value: DbAmount): MilliOMR {
  if (value == null) return 0;
  if (typeof value === "number") {
    return parseOMR(numericToDecimalString(value));
  }
  return parseOMR(value);
}

/** Convert milli-OMR to a numeric string acceptable by PostgREST numeric. */
export function toDbAmount(millis: MilliOMR): string {
  return toOMRString(millis);
}

/**
 * Convert milli-OMR to the JSON number shape the generated types declare for
 * `numeric(12,3)` write payloads.
 *
 * This is a lossless round trip within the persisted domain: `toOMRString`
 * produces the exact decimal, `Number` selects the nearest double, and that
 * double's shortest round-trip representation is that same decimal (proved by
 * `fromDbNumericRoundTrips` coverage in money.test.ts). PostgreSQL re-parses
 * it into exact numeric on arrival, so the database remains the financial
 * authority — the double is transport only, never an arithmetic input.
 */
export function toDbNumeric(millis: MilliOMR): number {
  const exact = Number(toOMRString(millis));
  if (fromDbAmount(exact) !== millis) {
    throw new MoneyError("تعذّر تمثيل المبلغ بدقة عند الإرسال");
  }
  return exact;
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
    // Route through the exact decimal text rather than `input * 1000`, which
    // is binary floating-point multiplication and can land on the wrong
    // milli-unit (e.g. 2.435 * 1000 === 2434.9999999999995).
    if (!Number.isFinite(input)) throw new MoneyError("كمية غير صالحة");
    return parseOMR(numericToDecimalString(input));
  }
  return parseOMR(input);
}
