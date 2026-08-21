/**
 * Safe Oman phone-number normalization for operational quick actions
 * (Call / WhatsApp). No SMS/WhatsApp API, no bots, no automation — this only
 * turns a stored number into a `tel:` or `wa.me` link.
 */

const OMAN_COUNTRY_CODE = "968";

/** Strip spaces, dashes, dots, parentheses and a leading '+'. */
function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, "");
}

/**
 * Normalize an Omani phone number to the 8-digit national form
 * (e.g. "91234567"). Returns null when the input cannot be safely recognized
 * as an Oman number — a null is surfaced to the UI rather than a wrong link.
 */
export function normalizeOmanPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = digitsOnly(input);

  if (digits.startsWith("00")) digits = digits.slice(2);
  // Country code written without a leading zero (e.g. "96891234567").
  if (digits.startsWith(OMAN_COUNTRY_CODE) && digits.length === 11) {
    digits = digits.slice(3);
  }

  if (!/^(7|9|2)\d{7}$/.test(digits)) return null;
  return digits;
}

/** International dialing form, e.g. "+96891234567". */
export function omanE164(input: string | null | undefined): string | null {
  const national = normalizeOmanPhone(input);
  return national ? `+${OMAN_COUNTRY_CODE}${national}` : null;
}

/** `tel:` link for a native dialer. */
export function omanTelUrl(input: string | null | undefined): string | null {
  const e164 = omanE164(input);
  return e164 ? `tel:${e164}` : null;
}

/** WhatsApp deep link (opens the chat with the normalized number). */
export function omanWhatsAppUrl(input: string | null | undefined): string | null {
  const national = normalizeOmanPhone(input);
  return national ? `https://wa.me/${OMAN_COUNTRY_CODE}${national}` : null;
}
