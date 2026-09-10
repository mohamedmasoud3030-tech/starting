/**
 * Shared Arabic display helpers used across UI surfaces.
 *
 * Kept outside the (removed) screen-reader module so everyday formatting —
 * Arabic-Indic digits and Arabic status labels — stays available to any
 * screen without pulling in speech logic.
 */

/** Badge tones the shared status maps may emit. */
export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

/** @deprecated Use `BadgeTone`. Kept so early consumers compile unchanged. */
export type EventStatusTone = BadgeTone;

/**
 * Canonical Arabic labels for the event lifecycle status.
 *
 * Single source of truth. Feature modules that used to keep their own copies
 * (EventsPage, the workspace model) now import this map, so a status always
 * renders in the same Arabic wording everywhere — the events index, the daily
 * dashboard, the workspace header/timeline, the calendar and the reports
 * tables. `QUOTED` reads "تم التسعير" to match the quotation workflow wording
 * used across the rest of the product.
 */
export const EVENT_STATUS_ARABIC: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTED: "تم التسعير",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "جارية",
  RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

/**
 * Canonical Badge tone per lifecycle status, kept beside the label so hue
 * never drifts from meaning across surfaces (complements readiness tones,
 * which live in the events operational-readiness module).
 */
export const EVENT_STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  QUOTED: "brand",
  CONFIRMED: "success",
  PREPARING: "warning",
  DISPATCHED: "brand",
  IN_PROGRESS: "success",
  RETURNING: "warning",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

/**
 * Canonical Arabic labels for the quotation lifecycle status. Single source of
 * truth shared by the quotes list, the quotation editor/review and the event
 * pricing tab. Previously three modules each kept a parallel copy; the raw DB
 * enum must never render in the operator's Arabic UI.
 */
export const QUOTATION_STATUS_ARABIC: Record<string, string> = {
  DRAFT: "مسودة",
  ISSUED: "مُرسل",
  EXPIRED: "منتهي الصلاحية",
  ACCEPTED: "معتمد",
  REJECTED: "مرفوض",
  CONVERTED: "محوّل لمناسبة",
  CANCELLED: "ملغي",
  SUPERSEDED: "مستبدل",
};

/**
 * Canonical Badge tone per quotation status, kept beside the label.
 */
export const QUOTATION_STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  ISSUED: "warning",
  EXPIRED: "neutral",
  ACCEPTED: "success",
  REJECTED: "danger",
  CONVERTED: "brand",
  CANCELLED: "danger",
  SUPERSEDED: "neutral",
};

/**
 * Canonical Arabic labels for the invoice lifecycle status (ISSUED/CANCELLED).
 * Single source of truth so no invoice status code reaches the operator's
 * Arabic UI and a cancelled invoice never reads as "issued".
 */
export const INVOICE_STATUS_ARABIC: Record<string, string> = {
  ISSUED: "صادرة",
  CANCELLED: "ملغاة",
};

/**
 * Canonical Arabic labels + tone for the invoice-installment effective status
 * (PENDING/PAID/CANCELLED). A cancelled installment must read as "ملغى", not
 * as due.
 */
export const INSTALLMENT_STATUS_ARABIC: Record<string, string> = {
  PENDING: "مستحق",
  PAID: "مدفوع",
  CANCELLED: "ملغى",
};

export const INSTALLMENT_STATUS_TONES: Record<string, BadgeTone> = {
  PENDING: "warning",
  PAID: "success",
  CANCELLED: "neutral",
};

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

/** Convert Latin digits to Arabic-Indic digits (١٢٥), keeping other chars. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}
