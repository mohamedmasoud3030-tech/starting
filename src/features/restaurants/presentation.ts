import { formatOMR, fromDbAmount } from "@/lib/money";
import type { BookingStatus, ContractStatus, MealType } from "./types";

/** Arabic labels for the contracted-restaurants surfaces. */
export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  LUNCH: "غداء",
  DINNER: "عشاء",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "قيد التأكيد",
  CONFIRMED: "مؤكد",
  CANCELLED: "ملغي",
  SERVED: "منجز",
};

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "brand";

export const BOOKING_STATUS_TONES: Record<BookingStatus, StatusTone> = {
  PENDING: "warning",
  CONFIRMED: "brand",
  CANCELLED: "danger",
  SERVED: "success",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: "ساري",
  ENDED: "منتهي",
};

/** Formats an OMR amount exactly as the rest of the app does. */
export function mealPriceLabel(dbAmount: number): string {
  return formatOMR(fromDbAmount(dbAmount));
}

export function mealTypeLabel(meal: MealType): string {
  return MEAL_TYPE_LABELS[meal];
}

export function bookingStatusLabel(status: BookingStatus): string {
  return BOOKING_STATUS_LABELS[status];
}

export function contractStatusLabel(status: ContractStatus): string {
  return CONTRACT_STATUS_LABELS[status];
}

/** Short date for bookings (service day) — ISO day kept readable in RTL UI. */
export function formatServiceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NOT_AUTHENTICATED: "يجب تسجيل الدخول لتنفيذ هذا الإجراء.",
  NOT_AUTHORIZED: "دورك الحالي لا يسمح بتنفيذ هذا الإجراء.",
  CONTRACT_NUMBER_REQUIRED: "أدخل رقم العقد.",
  SUPPLIER_NOT_CONTRACTABLE: "هذا المورد ليس مطعماً متعاقداً نشطاً.",
  INVALID_CONTRACT_RANGE: "تاريخ نهاية العقد يجب أن يلي تاريخ بدايته.",
  SUPPLIER_CONTRACT_NOT_FOUND: "لم يُعثر على العقد.",
  INVALID_LIFECYCLE: "حالة الحجز لا تسمح بهذا الإجراء.",
  EVENT_NOT_FOUND: "لم يُعثر على الفعالية.",
  GUEST_COUNT_REQUIRED: "أدخل عدد الضيوف.",
  NO_ACTIVE_CONTRACT: "لا يوجد عقد ساري لهذا المطعم.",
  CONTRACT_DATE_MISMATCH: "تاريخ الخدمة خارج نطاق العقد الساري.",
  MEAL_BOOKING_NOT_FOUND: "لم يُعثر على الحجز.",
  CANCELLATION_REASON_REQUIRED: "أدخل سبب الإلغاء.",
};

/**
 * Friendly Arabic error for command failures. Falls back to a clear generic
 * message and never leaks raw server text.
 */
export function restaurantErrorMessage(cause: unknown): string {
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "";
  for (const [code, arabic] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(code)) return arabic;
  }
  return "تعذّر تنفيذ العملية. تحقق من البيانات وأعد المحاولة.";
}
