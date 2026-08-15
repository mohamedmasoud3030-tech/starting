import type { PaymentMethod } from "@/lib/dbTypes";

/** Arabic display labels for customer payment methods (RTL-first). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "نقداً",
  BANK_TRANSFER: "تحويل بنكي",
  CARD: "بطاقة",
  CHEQUE: "شيك",
  MOBILE_WALLET: "محفظة إلكترونية",
  OTHER: "أخرى",
};

/** The order payment methods appear in selection forms. */
export const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "CHEQUE",
  "MOBILE_WALLET",
  "OTHER",
];
