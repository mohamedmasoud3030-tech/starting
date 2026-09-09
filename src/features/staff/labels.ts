import type { AttendanceStatus, StaffShift } from "./staff.api";
import type { LeaveStatus, LeaveType } from "./staff.api";
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
  // Voiding rewrites the row's status itself (migration 0039), so a voided
  // record surfaces here too; previously this key was missing and the badge
  // on a voided row rendered blank.
  VOIDED: "ملغى",
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

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "مسند",
  RELEASED: "محرّر",
  CANCELLED: "ملغى",
};

export const ATTENDANCE_STATUS_TONE: Record<
  AttendanceStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  PRESENT: "success",
  LATE: "warning",
  PARTIAL: "warning",
  ABSENT: "danger",
  VOIDED: "neutral",
};

// HR directory (migration 0100) — contract life-cycle and leave register.
export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "العقد سارٍ",
  PROBATION: "فترة تجربة",
  ENDED: "العقد منتهي",
};

export const CONTRACT_STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  ACTIVE: "success",
  PROBATION: "warning",
  ENDED: "danger",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: "إجازة سنوية",
  SICK: "إجازة مرضية",
  EMERGENCY: "ظرف طارئ",
  UNPAID: "إجازة بدون راتب",
  EVENT_ABSENCE: "غياب عن مناسبة",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "بانتظار الموافقة",
  APPROVED: "موافق عليها",
  REJECTED: "مرفوضة",
  CANCELLED: "ملغاة",
};

export const LEAVE_STATUS_TONE: Record<
  LeaveStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  PENDING: "neutral",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "warning",
};
