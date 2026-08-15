import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as typedSupabase } from "@/lib/supabase";
import {
  fromDbAmount,
  toDbNumeric,
  type MilliOMR,
} from "@/lib/money";
import type { CompensationMethod, PaymentMethod, StaffType } from "@/lib/dbTypes";

/**
 * S9 staff attendance & host payroll data layer.
 *
 * The staff_attendance slice (migrations 0038-0040) is not yet reflected in the
 * committed generated types, so access goes through an untyped client boundary
 * (the same forward-compat pattern used elsewhere when generated types lag the
 * migrations). Every row returned from the stable read models is normalized via
 * the hand-written mappers below into exact milli-OMR money — no binary
 * floating point becomes financial truth. Writes are server-authoritative
 * SECURITY DEFINER commands with idempotency keys.
 */
const db = typedSupabase as unknown as SupabaseClient;

export type StaffShift = "MORNING" | "EVENING";
export type AttendanceStatus = "PRESENT" | "LATE" | "PARTIAL" | "ABSENT";
export type HostPaymentStatus = "RECORDED" | "VOIDED";

export interface AttendanceSummary {
  id: string;
  eventId: string;
  eventNumber: string;
  eventTitle: string;
  staffMemberId: string;
  staffName: string;
  staffType: StaffType;
  assignmentId: string | null;
  attendanceDate: string;
  shift: StaffShift;
  checkIn: string | null;
  checkOut: string | null;
  breakMinutes: number;
  hoursWorked: number;
  status: AttendanceStatus;
  wageMethod: CompensationMethod;
  wageRateMilli: MilliOMR;
  earnedMilli: MilliOMR;
  notes: string | null;
  recordStatus: HostPaymentStatus;
  voidReason: string | null;
  createdAt: string;
}

export interface AdvanceSummary {
  id: string;
  staffMemberId: string;
  staffName: string;
  staffType: StaffType;
  amountMilli: MilliOMR;
  advanceDate: string;
  reason: string | null;
  status: HostPaymentStatus;
  voidReason: string | null;
  createdAt: string;
}

export interface PayoutSummary {
  id: string;
  staffMemberId: string;
  staffName: string;
  staffType: StaffType;
  eventId: string | null;
  eventNumber: string | null;
  amountMilli: MilliOMR;
  payoutDate: string;
  method: PaymentMethod;
  reference: string | null;
  reason: string | null;
  status: HostPaymentStatus;
  voidReason: string | null;
  createdAt: string;
}

export interface PayrollRow {
  staffMemberId: string;
  staffName: string;
  staffType: StaffType;
  eventId: string;
  eventNumber: string | null;
  eventTitle: string | null;
  attendanceCount: number;
  earnedMilli: MilliOMR;
  advancesMilli: MilliOMR;
  payoutsMilli: MilliOMR;
  dueMilli: MilliOMR;
  paidMilli: MilliOMR;
  lateMilli: MilliOMR;
}

export interface HostPayrollTotals {
  staffMemberId: string;
  eventId: string | null;
  earnedMilli: MilliOMR;
  advancesMilli: MilliOMR;
  payoutsMilli: MilliOMR;
  dueMilli: MilliOMR;
  paidMilli: MilliOMR;
  lateMilli: MilliOMR;
  attendanceCount: number;
}

export interface StaffMemberRow {
  id: string;
  name: string;
  staffType: StaffType;
  isActive: boolean;
  defaultCompensationMethod: CompensationMethod | null;
  defaultRateMilli: MilliOMR;
}

function mapAttendance(row: Record<string, unknown>): AttendanceSummary {
  return {
    id: String(row.attendance_id),
    eventId: String(row.event_id),
    eventNumber: (row.event_number as string) ?? "",
    eventTitle: (row.event_title as string) ?? "",
    staffMemberId: String(row.staff_member_id),
    staffName: (row.staff_name as string) ?? "",
    staffType: (row.staff_type as StaffType) ?? "OTHER",
    assignmentId: row.assignment_id ? String(row.assignment_id) : null,
    attendanceDate: String(row.attendance_date),
    shift: (row.shift as StaffShift) ?? "MORNING",
    checkIn: (row.check_in as string) ?? null,
    checkOut: (row.check_out as string) ?? null,
    breakMinutes: Number(row.break_minutes ?? 0),
    hoursWorked: Number(row.hours_worked ?? 0),
    status: (row.attendance_status as AttendanceStatus) ?? "PRESENT",
    wageMethod: (row.wage_method as CompensationMethod) ?? "PER_EVENT",
    wageRateMilli: fromDbAmount(row.wage_rate as never),
    earnedMilli: fromDbAmount(row.earned_amount as never),
    notes: (row.notes as string) ?? null,
    recordStatus: (row.record_status as HostPaymentStatus) ?? "RECORDED",
    voidReason: (row.void_reason as string) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapAdvance(row: Record<string, unknown>): AdvanceSummary {
  return {
    id: String(row.advance_id),
    staffMemberId: String(row.staff_member_id),
    staffName: (row.staff_name as string) ?? "",
    staffType: (row.staff_type as StaffType) ?? "OTHER",
    amountMilli: fromDbAmount(row.amount as never),
    advanceDate: String(row.advance_date),
    reason: (row.reason as string) ?? null,
    status: (row.status as HostPaymentStatus) ?? "RECORDED",
    voidReason: (row.void_reason as string) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapPayout(row: Record<string, unknown>): PayoutSummary {
  return {
    id: String(row.payout_id),
    staffMemberId: String(row.staff_member_id),
    staffName: (row.staff_name as string) ?? "",
    staffType: (row.staff_type as StaffType) ?? "OTHER",
    eventId: row.event_id ? String(row.event_id) : null,
    eventNumber: (row.event_number as string) ?? null,
    amountMilli: fromDbAmount(row.amount as never),
    payoutDate: String(row.payout_date),
    method: (row.payment_method as PaymentMethod) ?? "CASH",
    reference: (row.reference as string) ?? null,
    reason: (row.reason as string) ?? null,
    status: (row.status as HostPaymentStatus) ?? "RECORDED",
    voidReason: (row.void_reason as string) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapPayroll(row: Record<string, unknown>): PayrollRow {
  return {
    staffMemberId: String(row.staff_member_id),
    staffName: (row.staff_name as string) ?? "",
    staffType: (row.staff_type as StaffType) ?? "OTHER",
    eventId: String(row.event_id),
    eventNumber: (row.event_number as string) ?? null,
    eventTitle: (row.event_title as string) ?? null,
    attendanceCount: Number(row.attendance_count ?? 0),
    earnedMilli: fromDbAmount(row.earned_total as never),
    advancesMilli: fromDbAmount(row.advances_total as never),
    payoutsMilli: fromDbAmount(row.payouts_total as never),
    dueMilli: fromDbAmount(row.due_total as never),
    paidMilli: fromDbAmount(row.paid_total as never),
    lateMilli: fromDbAmount(row.late_total as never),
  };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const caller = db.rpc as unknown as (
    fn: string,
    a?: Record<string, unknown>,
  ) => Promise<{ data: T; error: unknown }>;
  const res = await caller(name, args);
  if (res.error) throw res.error;
  return res.data;
}

/** Exact OMR wage preview (mirrors SQL compute_earned_amount). UI-only; the DB is authoritative. */
export function computeEarnedMilli(
  wageMethod: CompensationMethod,
  wageRateMilli: MilliOMR,
  checkIn: string | null,
  checkOut: string | null,
  breakMinutes: number,
  status: AttendanceStatus,
): MilliOMR {
  if (status === "ABSENT") return 0;
  if (wageMethod === "PER_HOUR") {
    if (!checkIn || !checkOut) return 0;
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    const seconds = Math.round(ms / 1000);
    const workSeconds = seconds - Math.max(0, breakMinutes) * 60;
    const hours = Math.round((workSeconds / 3600) * 1000) / 1000;
    return Math.round(hours * wageRateMilli);
  }
  return wageRateMilli;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export function useEventAttendance(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-attendance", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("staff_attendance_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .order("attendance_date", { ascending: false })
        .order("shift", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapAttendance);
    },
  });
}

export interface RecordAttendanceInput {
  staffMemberId: string;
  assignmentId: string | null;
  attendanceDate: string;
  shift: StaffShift;
  checkIn: string | null;
  checkOut: string | null;
  breakMinutes: number;
  status: AttendanceStatus;
  wageMethod: CompensationMethod;
  wageRateMilli: MilliOMR;
  notes: string;
}

export function useRecordAttendance(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: RecordAttendanceInput) =>
      rpc<Record<string, unknown>>("record_staff_attendance", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_staff_member_id: v.staffMemberId,
        p_assignment_id: v.assignmentId,
        p_attendance_date: v.attendanceDate,
        p_shift: v.shift,
        p_check_in: v.checkIn,
        p_check_out: v.checkOut,
        p_break_minutes: v.breakMinutes,
        p_status: v.status,
        p_wage_method: v.wageMethod,
        p_wage_rate: toDbNumeric(v.wageRateMilli),
        p_notes: v.notes || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-attendance", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-payroll", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

export function useVoidAttendance(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ attendanceId, reason }: { attendanceId: string; reason: string }) =>
      rpc<Record<string, unknown>>("void_staff_attendance", {
        p_org_id: orgId,
        p_attendance_id: attendanceId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-attendance", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-payroll", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Event payroll (per-host per-event rollup for this event)
// ---------------------------------------------------------------------------
export function useEventPayroll(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-payroll", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("host_event_payroll_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .order("staff_name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapPayroll);
    },
  });
}

// ---------------------------------------------------------------------------
// Advances (السلف)
// ---------------------------------------------------------------------------
export function useStaffAdvances(orgId: string | null, staffMemberId: string | null) {
  return useQuery({
    queryKey: ["staff-advances", orgId, staffMemberId],
    enabled: !!orgId && !!staffMemberId,
    queryFn: async () => {
      const { data, error } = await db
        .from("staff_advances_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("staff_member_id", staffMemberId)
        .order("advance_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapAdvance);
    },
  });
}

export function useRecordAdvance(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      staffMemberId: string;
      amountMilli: MilliOMR;
      advanceDate: string;
      reason: string;
    }) =>
      rpc<Record<string, unknown>>("record_staff_advance", {
        p_org_id: orgId,
        p_staff_member_id: v.staffMemberId,
        p_amount: toDbNumeric(v.amountMilli),
        p_advance_date: v.advanceDate,
        p_reason: v.reason || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["staff-advances", orgId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

export function useVoidAdvance(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ advanceId, reason }: { advanceId: string; reason: string }) =>
      rpc<Record<string, unknown>>("void_staff_advance", {
        p_org_id: orgId,
        p_advance_id: advanceId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["staff-advances", orgId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Payouts (المدفوع — actual settlement to host)
// ---------------------------------------------------------------------------
export function useHostPayouts(orgId: string | null, staffMemberId: string | null) {
  return useQuery({
    queryKey: ["host-payouts", orgId, staffMemberId],
    enabled: !!orgId && !!staffMemberId,
    queryFn: async () => {
      const { data, error } = await db
        .from("host_payout_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("staff_member_id", staffMemberId)
        .order("payout_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPayout);
    },
  });
}

export function useRecordPayout(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      staffMemberId: string;
      eventId: string | null;
      amountMilli: MilliOMR;
      payoutDate: string;
      method: PaymentMethod;
      reference: string;
      reason: string;
    }) =>
      rpc<Record<string, unknown>>("record_host_payout", {
        p_org_id: orgId,
        p_staff_member_id: v.staffMemberId,
        p_event_id: v.eventId,
        p_amount: toDbNumeric(v.amountMilli),
        p_payout_date: v.payoutDate,
        p_payment_method: v.method,
        p_reference: v.reference || null,
        p_reason: v.reason || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["host-payouts", orgId] });
      void q.invalidateQueries({ queryKey: ["event-payroll", orgId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

export function useVoidPayout(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ payoutId, reason }: { payoutId: string; reason: string }) =>
      rpc<Record<string, unknown>>("void_host_payout", {
        p_org_id: orgId,
        p_payout_id: payoutId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["host-payouts", orgId] });
      void q.invalidateQueries({ queryKey: ["event-payroll", orgId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Org-wide payroll archive (one row per host per event) for the host archive page.
// ---------------------------------------------------------------------------
export function useOrgPayrollArchive(orgId: string | null) {
  return useQuery({
    queryKey: ["org-payroll-archive", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("host_event_payroll_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .order("staff_name", { ascending: true })
        .order("event_number", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapPayroll);
    },
  });
}

export function useOrgStaffMembers(orgId: string | null) {
  return useQuery({
    queryKey: ["staff-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("staff_members")
        .select("*")
        .eq("organization_id", orgId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>): StaffMemberRow => ({
        id: String(row.id),
        name: (row.name as string) ?? "",
        staffType: (row.staff_type as StaffType) ?? "OTHER",
        isActive: Boolean(row.is_active),
        defaultCompensationMethod: (row.default_compensation_method as CompensationMethod) ?? null,
        defaultRateMilli: fromDbAmount(row.default_rate as never),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Owner attention: today's events with assignments but no attendance logged.
// ---------------------------------------------------------------------------
export interface AttendanceGap {
  eventId: string;
  eventTitle: string;
  eventNumber: string;
  assignmentCount: number;
  attendanceCount: number;
}

export function useAttendanceGaps(orgId: string | null) {
  return useQuery({
    queryKey: ["attendance-gaps", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db.rpc("today_attendance_gaps", {
        p_org_id: orgId,
        p_now: new Date().toISOString(),
      });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>): AttendanceGap => ({
        eventId: String(row.event_id),
        eventTitle: (row.event_title as string) ?? "",
        eventNumber: (row.event_number as string) ?? "",
        assignmentCount: Number(row.assignment_count ?? 0),
        attendanceCount: Number(row.attendance_count ?? 0),
      }));
    },
  });
}

/** Arabic, owner-friendly error messages for the S9 command surface. */
export function attendanceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_AUTHORIZED")) return "ليس لديك صلاحية لتنفيذ هذا الإجراء";
  if (message.includes("NOT_AUTHENTICATED")) return "يرجى تسجيل الدخول أولاً";
  if (message.includes("EVENT_NOT_FOUND")) return "المناسبة غير موجودة";
  if (message.includes("EVENT_CANCELLED")) return "لا يمكن تسجيل حضور على مناسبة ملغاة";
  if (message.includes("ABSENT_HAS_NO_TIMES")) return "الغياب لا يسجّل معه وقت دخول أو خروج";
  if (message.includes("ATTENDANCE_REQUIRES_TIMES")) return "يرجى تسجيل وقت الدخول والخروج";
  if (message.includes("CHECKOUT_BEFORE_CHECKIN")) return "وقت الخروج يجب أن يكون بعد الدخول";
  if (message.includes("INVALID_BREAK_MINUTES")) return "دقائق الراحة لا يمكن أن تكون بالسالب";
  if (message.includes("INVALID_WAGE_RATE")) return "أجر الساعة/اليومية غير صالح";
  if (message.includes("OMR_PRECISION_EXCEEDED")) return "المبلغ يتجاوز ثلاث خانات عشرية";
  if (message.includes("OMR_AMOUNT_OUT_OF_RANGE")) return "المبلغ أكبر من الحد الأقصى المسموح به";
  if (message.includes("ADVANCE_DATE_REQUIRED")) return "يرجى تحديد تاريخ السلفة";
  if (message.includes("PAYOUT_DATE_REQUIRED")) return "يرجى تحديد تاريخ الصرف";
  if (message.includes("PAYMENT_METHOD_REQUIRED")) return "يرجى اختيار طريقة الدفع";
  if (message.includes("VOID_REASON_REQUIRED")) return "يرجى ذكر سبب الإلغاء";
  if (message.includes("ATTENDANCE_ALREADY_VOIDED")) return "هذا الحضور ملغى بالفعل";
  if (message.includes("ADVANCE_ALREADY_VOIDED")) return "هذه السلفة ملغاة بالفعل";
  if (message.includes("PAYOUT_ALREADY_VOIDED")) return "هذا الصرف ملغى بالفعل";
  if (message.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) return "تعارض في الطلب — حاول مجدداً";
  if (message.includes("IDEMPOTENCY_KEY_REQUIRED")) return "معرّف الطلب مفقود";
  return message;
}
