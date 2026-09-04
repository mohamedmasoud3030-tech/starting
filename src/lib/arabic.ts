/**
 * Shared Arabic display helpers used across UI surfaces.
 *
 * Carried here (instead of living inside the removed owner-voice module) so
 * that everyday formatting — Arabic-Indic digits and Arabic status labels —
 * stays available to any screen without pulling in speech logic.
 */

/** Arabic labels for event statuses. */
export const EVENT_STATUS_ARABIC: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTED: "مسعّرة",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "جارية",
  RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

/** Convert Latin digits to Arabic-Indic digits (١٢٥), keeping other chars. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}
