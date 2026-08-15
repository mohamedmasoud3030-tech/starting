import type { AttendanceStatus, StaffShift } from "./staff.api";
import type { CompensationMethod } from "@/lib/dbTypes";

export const SHIFT_LABELS: Record<StaffShift, string> = {
  MORNING: "صباحي",
  EVENING: "مسائي",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "حاضر",
  LATE: "متأخر",
  PARTIAL: "جزئي",
  ABSENT: "غائب",
};

export const COMPENSATION_LABELS: Record<CompensationMethod, string> = {
  PER_EVENT: "بالمناسبة",
  PER_HOUR: "بالساعة",
  PER_DAY: "باليومية",
  MANUAL: "يدوي",
};

export const STAFF_TYPE_LABELS: Record<string, string> = {
  HOST: "مضيف",
  HOSTESS: "مضيفة",
  SUPERVISOR: "مشرف",
  DRIVER: "سائق",
  WAREHOUSE: "مخزن",
  OTHER: "أخرى",
};

export const ATTENDANCE_STATUS_TONE: Record<
  AttendanceStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  PRESENT: "success",
  LATE: "warning",
  PARTIAL: "warning",
  ABSENT: "danger",
};
