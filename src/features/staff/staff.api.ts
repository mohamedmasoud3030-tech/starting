import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  fromDbAmount,
  toDbNumeric,
  type MilliOMR,
} from "@/lib/money";
import type {
  AttendanceStatusDb,
  CompensationMethod,
  HostEventPayrollSummaryRow,
  HostPaymentStatus,
  HostPayoutSummaryRow,
  PaymentMethod,
  StaffAdvanceSummaryRow,
  StaffAttendanceSummaryRow,
  StaffShift as StaffShiftDb,
  StaffType,
} from "@/lib/dbTypes";
import { callRpc } from "@/lib/rpc";

/**
 * S9 staff attendance & host payroll data layer.
 *
 * READS are fully typed against the generated database types (the S9 slice —
 * migrations 0038-0048 — is covered by the committed `database.types.ts`, so
 * the former untyped client boundary is gone). Every row from the stable read
 * models is normalized via the exported mappers below into exact milli-OMR
 * money — no binary floating point becomes financial truth.
 *
 * WRITES are server-authoritative SECURITY DEFINER commands with idempotency
 * keys, dispatched through the canonical `callRpc` helper (the generated
 * `Args` for these commands declare optional text/timestamp parameters as
 * non-nullable `string` because they carry no SQL DEFAULT; the commands
 * themselves accept NULL, so the dynamic helper is the honest boundary).
 */
const db = supabase;

export type StaffShift = StaffShiftDb;
/**
 * Attendance status as read from the read model. Includes `VOIDED`: voiding
 * rewrites `staff_attendance.status` itself (migration 0039), so a voided
 * row's original live status is no longer available.
 */
export type AttendanceStatus = AttendanceStatusDb;
/** Live statuses an operator can record (the command rejects `VOIDED`). */
export type AttendanceLiveStatus = Exclude<AttendanceStatusDb, "VOIDED">;
export type { HostPaymentStatus };

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


export interface StaffMemberRow {
  id: string;
  name: string;
  staffType: StaffType;
  isActive: boolean;
  defaultCompensationMethod: CompensationMethod | null;
  defaultRateMilli: MilliOMR;
  phone: string | null;
  whatsapp: string | null;
  idNumber: string | null;
  notes: string | null;
}

/**
 * REGRESSION NOTE (Phase 3 P0): `staff_attendance_summaries.record_status`
 * is `staff_attendance.status` itself — the `attendance_status` enum, whose
 * live values are PRESENT/LATE/PARTIAL/ABSENT and whose voided value is
 * VOIDED. It is NEVER the string 'RECORDED'. The previous mapper cast it to
 * `HostPaymentStatus` untranslated, so every live row carried
 * `recordStatus: "PRESENT" | …` and each `recordStatus === "RECORDED"`
 * consumer silently failed: earned totals summed to 0.000 OMR and the void
 * button never rendered. The lifecycle must be DERIVED here.
 */
export function mapAttendance(row: StaffAttendanceSummaryRow): AttendanceSummary {
  const status: AttendanceStatus = row.attendance_status ?? "PRESENT";
  return {
    id: row.attendance_id ?? "",
    eventId: row.event_id ?? "",
    eventNumber: row.event_number ?? "",
    eventTitle: row.event_title ?? "",
    staffMemberId: row.staff_member_id ?? "",
    staffName: row.staff_name ?? "",
    staffType: row.staff_type ?? "OTHER",
    assignmentId: row.assignment_id,
    attendanceDate: row.attendance_date ?? "",
    shift: row.shift ?? "MORNING",
    checkIn: row.check_in,
    checkOut: row.check_out,
    breakMinutes: row.break_minutes ?? 0,
    hoursWorked: row.hours_worked ?? 0,
    status,
    wageMethod: row.wage_method ?? "PER_EVENT",
    wageRateMilli: fromDbAmount(row.wage_rate),
    earnedMilli: fromDbAmount(row.earned_amount),
    notes: row.notes,
    recordStatus: status === "VOIDED" ? "VOIDED" : "RECORDED",
    voidReason: row.void_reason,
    createdAt: row.created_at ?? "",
  };
}

export function mapAdvance(row: StaffAdvanceSummaryRow): AdvanceSummary {
  return {
    id: row.advance_id ?? "",
    staffMemberId: row.staff_member_id ?? "",
    staffName: row.staff_name ?? "",
    staffType: row.staff_type ?? "OTHER",
    amountMilli: fromDbAmount(row.amount),
    advanceDate: row.advance_date ?? "",
    reason: row.reason,
    status: row.status ?? "RECORDED",
    voidReason: row.void_reason,
    createdAt: row.created_at ?? "",
  };
}

export function mapPayout(row: HostPayoutSummaryRow): PayoutSummary {
  return {
    id: row.payout_id ?? "",
    staffMemberId: row.staff_member_id ?? "",
    staffName: row.staff_name ?? "",
    staffType: row.staff_type ?? "OTHER",
    eventId: row.event_id,
    eventNumber: row.event_number,
    amountMilli: fromDbAmount(row.amount),
    payoutDate: row.payout_date ?? "",
    method: row.payment_method ?? "CASH",
    reference: row.reference,
    reason: row.reason,
    status: row.status ?? "RECORDED",
    voidReason: row.void_reason,
    createdAt: row.created_at ?? "",
  };
}

export function mapPayroll(row: HostEventPayrollSummaryRow): PayrollRow {
  return {
    staffMemberId: row.staff_member_id ?? "",
    staffName: row.staff_name ?? "",
    staffType: row.staff_type ?? "OTHER",
    eventId: row.event_id ?? "",
    eventNumber: row.event_number,
    eventTitle: row.event_title,
    attendanceCount: row.attendance_count ?? 0,
    earnedMilli: fromDbAmount(row.earned_total),
    advancesMilli: fromDbAmount(row.advances_total),
    payoutsMilli: fromDbAmount(row.payouts_total),
    dueMilli: fromDbAmount(row.due_total),
    paidMilli: fromDbAmount(row.paid_total),
    lateMilli: fromDbAmount(row.late_total),
  };
}

/** An open punch: the host is inside and wages stay 0.000 until clock-out. */
export function isOpenPunch(
  row: Pick<AttendanceSummary, "recordStatus" | "checkIn" | "checkOut" | "status">,
): boolean {
  return (
    row.recordStatus === "RECORDED" &&
    row.status !== "ABSENT" &&
    row.checkIn != null &&
    row.checkOut == null
  );
}

function invalidateAttendanceReads(
  q: QueryClient,
  orgId: string | null,
  eventId: string,
) {
  void q.invalidateQueries({ queryKey: ["event-attendance", orgId, eventId] });
  void q.invalidateQueries({ queryKey: ["event-payroll", orgId, eventId] });
  void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
  // The dashboard's "attendance gaps" alert reads today_attendance_gaps;
  // recording (or voiding) attendance opens/closes a gap, so the count
  // must be refreshed or the Home screen keeps alerting on a fixed gap.
  void q.invalidateQueries({ queryKey: ["attendance-gaps", orgId] });
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
  /** Only live statuses can be recorded; voiding is a separate command. */
  status: AttendanceLiveStatus;
  wageMethod: CompensationMethod;
  wageRateMilli: MilliOMR;
  notes: string;
}

export function useRecordAttendance(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: RecordAttendanceInput) =>
      callRpc<Record<string, unknown>>("record_staff_attendance", {
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
    onSuccess: () => invalidateAttendanceReads(q, orgId, eventId),
  });
}

export function useVoidAttendance(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ attendanceId, reason }: { attendanceId: string; reason: string }) =>
      callRpc<Record<string, unknown>>("void_staff_attendance", {
        p_org_id: orgId,
        p_attendance_id: attendanceId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateAttendanceReads(q, orgId, eventId),
  });
}

export interface ClockStaffInInput {
  staffMemberId: string;
  assignmentId: string;
  shift?: StaffShift | null;
  notes?: string;
  evidencePath: string;
  evidenceFileName: string;
  evidenceMimeType: string;
  evidenceSizeBytes: number;
}

export function useClockStaffIn(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: ClockStaffInInput) =>
      callRpc<Record<string, unknown>>("clock_staff_in", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_staff_member_id: v.staffMemberId,
        p_assignment_id: v.assignmentId,
        p_shift: v.shift ?? null,
        p_notes: v.notes?.trim() ? v.notes : null,
        p_evidence_path: v.evidencePath,
        p_evidence_file_name: v.evidenceFileName,
        p_evidence_mime_type: v.evidenceMimeType,
        p_evidence_size_bytes: v.evidenceSizeBytes,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateAttendanceReads(q, orgId, eventId),
  });
}

export function useClockStaffOut(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      staffMemberId: string;
      notes?: string;
      evidencePath: string;
      evidenceFileName: string;
      evidenceMimeType: string;
      evidenceSizeBytes: number;
    }) =>
      callRpc<Record<string, unknown>>("clock_staff_out", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_staff_member_id: v.staffMemberId,
        p_notes: v.notes?.trim() ? v.notes : null,
        p_evidence_path: v.evidencePath,
        p_evidence_file_name: v.evidenceFileName,
        p_evidence_mime_type: v.evidenceMimeType,
        p_evidence_size_bytes: v.evidenceSizeBytes,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateAttendanceReads(q, orgId, eventId),
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
        .eq("staff_member_id", staffMemberId!)
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
      callRpc<Record<string, unknown>>("record_staff_advance", {
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
      callRpc<Record<string, unknown>>("void_staff_advance", {
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
        .eq("staff_member_id", staffMemberId!)
        .order("payout_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPayout);
    },
  });
}

export interface PayoutAllocationInput {
  eventId: string;
  amountMilli: MilliOMR;
}

/**
 * Multi-event payout: one payout settling earnings from one or more events.
 * The allocation total must equal the payout amount (enforced server-side);
 * receipt evidence is optional and attached in the same transaction.
 */
export function useRecordPayoutMulti(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      staffMemberId: string;
      amountMilli: MilliOMR;
      payoutDate: string;
      method: PaymentMethod;
      reference: string;
      reason: string;
      allocations: PayoutAllocationInput[];
      receipt?: {
        evidencePath: string;
        evidenceFileName: string;
        evidenceMimeType: string;
        evidenceSizeBytes: number;
      } | null;
    }) =>
      callRpc<Record<string, unknown>>("record_host_payout_multi", {
        p_org_id: orgId,
        p_staff_member_id: v.staffMemberId,
        p_amount: toDbNumeric(v.amountMilli),
        p_payout_date: v.payoutDate,
        p_payment_method: v.method,
        p_reference: v.reference || null,
        p_reason: v.reason || null,
        p_allocations: JSON.stringify(
          v.allocations.map((a) => ({
            event_id: a.eventId,
            amount: toDbNumeric(a.amountMilli),
          })),
        ),
        p_evidence_path: v.receipt?.evidencePath ?? null,
        p_evidence_file_name: v.receipt?.evidenceFileName ?? null,
        p_evidence_mime_type: v.receipt?.evidenceMimeType ?? null,
        p_evidence_size_bytes: v.receipt?.evidenceSizeBytes ?? null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["host-payouts", orgId] });
      void q.invalidateQueries({ queryKey: ["event-payroll", orgId] });
      void q.invalidateQueries({ queryKey: ["org-payroll-archive", orgId] });
    },
  });
}

export interface PayoutAllocationRow {
  allocationId: string;
  payoutId: string;
  staffMemberId: string;
  payoutDate: string;
  payoutStatus: string;
  eventId: string;
  eventNumber: string | null;
  eventTitle: string | null;
  amountMilli: MilliOMR;
}

export function useHostPayoutAllocations(orgId: string | null, payoutId: string | null) {
  return useQuery({
    queryKey: ["host-payout-allocations", orgId, payoutId],
    enabled: !!orgId && !!payoutId,
    queryFn: async () => {
      const { data, error } = await db
        .from("host_payout_allocation_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("payout_id", payoutId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row): PayoutAllocationRow => ({
        allocationId: String(row.allocation_id),
        payoutId: String(row.payout_id),
        staffMemberId: String(row.staff_member_id),
        payoutDate: String(row.payout_date),
        payoutStatus: String(row.payout_status),
        eventId: String(row.event_id),
        eventNumber: row.event_number,
        eventTitle: row.event_title,
        amountMilli: fromDbAmount(row.amount),
      }));
    },
  });
}

export function useVoidPayout(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ payoutId, reason }: { payoutId: string; reason: string }) =>
      callRpc<Record<string, unknown>>("void_host_payout", {
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
      return (data ?? []).map((row): StaffMemberRow => ({
        id: row.id,
        name: row.name,
        staffType: row.staff_type,
        isActive: row.is_active,
        defaultCompensationMethod: row.default_compensation_method,
        defaultRateMilli: fromDbAmount(row.default_rate),
        phone: row.phone,
        whatsapp: row.whatsapp,
        idNumber: row.id_number,
        notes: row.notes,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Roster provisioning (defect F11): the staff page was read-only, so the
// team/attendance/payroll features had no data source inside the product.
// Writes use the existing role-checked RLS policy (staff_members_manage =
// OWNER/MANAGER) and follow the customers/catalog direct-write pattern.
// ---------------------------------------------------------------------------

export interface StaffMemberFormValues {
  name: string;
  staffType: StaffType;
  phone: string;
  whatsapp: string;
  idNumber: string;
  compensationMethod: CompensationMethod;
  rateMilli: MilliOMR;
  isActive: boolean;
  notes: string;
}

export function useSaveStaffMember(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string | null;
      values: StaffMemberFormValues;
    }) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const payload = {
        organization_id: orgId,
        name: values.name.trim(),
        phone: values.phone.trim() || null,
        whatsapp: values.whatsapp.trim() || null,
        id_number: values.idNumber.trim() || null,
        staff_type: values.staffType,
        is_active: values.isActive,
        default_compensation_method: values.compensationMethod,
        default_rate: toDbNumeric(values.rateMilli),
        notes: values.notes.trim() || null,
      };
      if (id) {
        const { error } = await db
          .from("staff_members")
          .update(payload)
          .eq("organization_id", orgId)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await db.from("staff_members").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // The roster feeds the staff page AND the event workspace team tab.
      void qc.invalidateQueries({ queryKey: ["staff-members", orgId] });
      void qc.invalidateQueries({ queryKey: ["event-workspace", orgId] });
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
        p_org_id: orgId!,
        p_now: new Date().toISOString(),
      });
      if (error) throw error;
      return (data ?? []).map((row): AttendanceGap => ({
        eventId: row.event_id,
        eventTitle: row.event_title,
        eventNumber: row.event_number,
        assignmentCount: row.assignment_count,
        attendanceCount: row.attendance_count,
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
  if (message.includes("CLOCK_IN_REQUIRED")) return "اضغط دخول أولاً";
  if (message.includes("ATTENDANCE_SLOT_ALREADY_RECORDED")) return "مسجّل مسبقاً";
  if (message.includes("ASSIGNMENT_NOT_FOUND")) return "هذا المضيف غير مسند لهذه المناسبة";
  if (message.includes("ASSIGNMENT_REQUIRED")) return "يوجد أكثر من إسناد — اختر الإسناد";
  if (message.includes("ASSIGNMENT_MISMATCH")) return "الإسناد لا يطابق هذا المضيف";
  if (message.includes("STAFF_NOT_FOUND")) return "المضيف غير موجود";
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
  if (message.includes("SELFIE_REQUIRED")) return "صورة الحضور مطلوبة — أعد التقاطها ثم حاول";
  if (message.includes("ATTACHMENT_OBJECT_MISSING")) return "لم يُحفظ الملف — أعد الرفع ثم حاول";
  if (message.includes("ATTACHMENT_MIME_NOT_ALLOWED")) return "نوع الملف غير مدعوم";
  if (message.includes("ATTACHMENT_SIZE_EXCEEDED")) return "حجم الملف يتجاوز الحد الأقصى";
  if (message.includes("PAYOUT_ALLOCATION_TOTAL_MISMATCH")) return "مجموع توزيع المناسبات يجب أن يساوي مبلغ الصرف بالضبط";
  if (message.includes("PAYOUT_ALLOCATION_EVENT_NOT_IN_ORG")) return "إحدى المناسبات لا تتبع منظمتك";
  if (message.includes("PAYOUT_ALLOCATION_AMOUNT_INVALID")) return "مبلغ التوزيع يجب أن يكون أكبر من صفر";
  if (message.includes("PAYOUT_ALLOCATION_EVENT_REQUIRED")) return "حدد المناسبة لكل توزيع";
  if (message.includes("PAYOUT_ALLOCATIONS_INVALID")) return "توزيع المناسبات غير صالح";
  return message;
}
