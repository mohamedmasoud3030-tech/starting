/**
 * Arabic presentation vocabulary for the accounting surfaces.
 *
 * Labels for the aging buckets and the journal source types returned by the
 * 0094/0096 read models. The server returns enum codes; the UI renders the
 * Arabic product vocabulary and a severity tone — it never re-derives any
 * financial meaning from the code.
 */

export type AgingBucket = "CURRENT" | "DAYS_31_60" | "DAYS_61_90" | "OVER_90";

export const AGING_BUCKET_LABELS: Record<string, string> = {
  CURRENT: "حالية",
  DAYS_31_60: "31–60 يوم",
  DAYS_61_90: "61–90 يوم",
  OVER_90: "أكثر من 90 يوم",
};

export const AGING_BUCKET_TONES: Record<
  string,
  "neutral" | "success" | "warning" | "danger"
> = {
  CURRENT: "success",
  DAYS_31_60: "neutral",
  DAYS_61_90: "warning",
  OVER_90: "danger",
};

export function agingBucketLabel(bucket: string): string {
  return AGING_BUCKET_LABELS[bucket] ?? bucket;
}

export function agingBucketTone(
  bucket: string,
): "neutral" | "success" | "warning" | "danger" {
  return AGING_BUCKET_TONES[bucket] ?? "neutral";
}

/**
 * Arabic labels for the journal source types that can appear on the customer
 * and supplier statements. Unknown future codes fall back to the raw code
 * (never to a fabricated translation).
 */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  OPENING_BALANCE: "رصيد افتتاحي",
  CUSTOMER_PAYMENT: "دفعة عميل",
  CUSTOMER_PAYMENT_VOID: "إلغاء دفعة عميل",
  CUSTOMER_DEPOSIT_APPLIED: "تطبيق عربون",
  CUSTOMER_DEPOSIT_RELEASED: "تحرير عربون",
  INVOICE: "فاتورة",
  INVOICE_VOID: "إلغاء فاتورة",
  REVENUE_RECOGNITION: "إثبات إيراد",
  UNBILLED_RECOGNITION: "إثبات إيراد غير مفوتر",
  CONTRACT_ASSET_RECLASSIFICATION: "إعادة تصنيف أصل عقد",
  REVENUE_REVERSAL: "عكس إيراد",
  SUPPLIER_INVOICE: "فاتورة مورد",
  SUPPLIER_INVOICE_VOID: "إلغاء فاتورة مورد",
  SUPPLIER_PAYMENT: "دفعة لمورد",
  SUPPLIER_PAYMENT_VOID: "إلغاء دفعة مورد",
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

/** Compact date-only formatting in the Muscat timezone (document + table). */
export function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" });
}
