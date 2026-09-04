import { useQuery } from "@tanstack/react-query";
import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

/**
 * Office document read models (migration 0080). Every model is a
 * server-authoritative, org-scoped, capability-gated projection: empty result
 * means "no visibility / record not in this org" — the UI must render an
 * empty state, never fabricated zeros.
 */

type DocRow<
  F extends keyof Database["public"]["Functions"],
> = Database["public"]["Functions"][F]["Returns"] extends infer R
  ? R extends readonly (infer T)[]
    ? T
    : never
  : never;

export type CustomerStatementRow = DocRow<"customer_statement">;
export type PaymentReceiptRow = DocRow<"customer_payment_receipt">;
export type WarehouseSheetRow = DocRow<"event_warehouse_sheet_lines">;
export type HostStatementRow = DocRow<"host_statement">;

export function customerStatementQueryKey(orgId: string | null, customerId: string | null) {
  return ["doc-customer-statement", orgId, customerId] as const;
}

/**
 * The customer statement (كشف حساب عميل) movements, in chronological order.
 * Gate: cost.visibility. Totals are NOT re-summed here — the caller presents
 * the canonical customer_360 outstanding figure alongside these movements.
 */
export function useCustomerStatement(orgId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: customerStatementQueryKey(orgId, customerId),
    enabled: !!orgId && !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_statement", {
        p_org_id: orgId!,
        p_customer_id: customerId!,
      });
      if (error) throw error;
      return (data ?? []) as CustomerStatementRow[];
    },
  });
}

export function paymentReceiptQueryKey(orgId: string | null, paymentId: string | null) {
  return ["doc-payment-receipt", orgId, paymentId] as const;
}

/**
 * The payment receipt (سند قبض) for one payment. VOIDED payments are returned
 * WITH their void metadata so the surface renders the voided watermark — a
 * voided receipt is never a valid one; validity is the server status.
 * Gate: cost.visibility.
 */
export function usePaymentReceipt(orgId: string | null, paymentId: string | null) {
  return useQuery({
    queryKey: paymentReceiptQueryKey(orgId, paymentId),
    enabled: !!orgId && !!paymentId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_payment_receipt", {
        p_org_id: orgId!,
        p_payment_id: paymentId!,
      });
      if (error) throw error;
      const rows = (data ?? []) as PaymentReceiptRow[];
      return rows[0] ?? null;
    },
  });
}

export function warehouseSheetQueryKey(orgId: string | null, eventId: string | null) {
  return ["doc-warehouse-sheet", orgId, eventId] as const;
}

/**
 * The warehouse preparation/return sheet lines (أمر تجهيز المخزن /
 * كشف استرجاع المخزن) for an event. Required quantities come from the
 * event's operational lines; dispatched/returned/damaged/lost from the
 * movement ledgers. NO cost or financial columns exist in this projection.
 * Gate: any active org member.
 */
export function useWarehouseSheetLines(orgId: string | null, eventId: string | null) {
  return useQuery({
    queryKey: warehouseSheetQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_warehouse_sheet_lines", {
        p_org_id: orgId!,
        p_event_id: eventId!,
      });
      if (error) throw error;
      return (data ?? []) as WarehouseSheetRow[];
    },
  });
}

/**
 * Row contracts for the 0081 operational/payroll projections. These are
 * explicit (not `DocRow`) because the server genuinely returns NULL in the
 * nullable fields — the print surfaces must render them, never coerce them
 * into fabricated values.
 */
export interface EventTeamSheetRow {
  staff_member_id: string;
  staff_name: string;
  staff_phone: string | null;
  /** staff_type code (HOST/HOSTESS/SUPERVISOR/DRIVER/WAREHOUSE/OTHER). */
  assignment_role: string;
  scheduled_start: string;
  scheduled_end: string;
  /** Worst live attendance state aggregated over the event (null = none). */
  presence_status: "PRESENT" | "LATE" | "PARTIAL" | "ABSENT" | null;
  check_in: string | null;
  check_out: string | null;
  assignment_notes: string | null;
}

export interface EventWorkOrderHeaderRow {
  event_number: string;
  title: string;
  event_type: string;
  status: string;
  start_at: string;
  end_at: string;
  guest_count: number;
  venue_name: string;
  location_details: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  customer_name: string;
  responsible_user_name: string | null;
}

export interface EventProcurementOpsRow {
  order_number: string;
  supplier_name: string;
  order_date: string;
  expected_delivery_at: string | null;
  /** Procurement lifecycle status code (never CANCELLED in this projection). */
  order_status: string;
  order_notes: string | null;
  item_name: string;
  unit: string;
  /** numeric(12,3) transported as exact decimal text (never JS floats). */
  quantity: string | number;
}

export interface PayrollPeriodRow {
  staff_member_id: string;
  staff_name: string;
  shift_count: number;
  /** numeric(14,3) transported as exact decimal text (never JS floats). */
  earned_total: string | number;
  advances_total: string | number;
  payouts_total: string | number;
  balance_total: string | number;
}

export function eventTeamSheetQueryKey(orgId: string | null, eventId: string | null) {
  return ["doc-event-team-sheet", orgId, eventId] as const;
}

/**
 * The event team sheet (كشف فريق المناسبة): the ACTIVE assignment roster with
 * the non-confidential attendance state (arrival/departure + worst live
 * status). Wage rates, expected compensation and earned amounts are NOT part
 * of this projection by design — an operational roster sheet must never
 * carry pay data (the SQL gate is membership; see 0081).
 */
export function useEventTeamSheet(orgId: string | null, eventId: string | null) {
  return useQuery({
    queryKey: eventTeamSheetQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_team_sheet", {
        p_org_id: orgId!,
        p_event_id: eventId!,
      });
      if (error) throw error;
      return (data ?? []) as EventTeamSheetRow[];
    },
  });
}

export function eventWorkOrderQueryKey(orgId: string | null, eventId: string | null) {
  return ["doc-event-work-order", orgId, eventId] as const;
}

/**
 * The event work order header (أمر تشغيل المناسبة): customer + event +
 * venue + office-responsible person, all from the canonical event row. This
 * is an operations document — no commercial totals, costs or margins are
 * projected anywhere in the family (SQL gate: membership; see 0081).
 */
export function useEventWorkOrderHeader(orgId: string | null, eventId: string | null) {
  return useQuery({
    queryKey: eventWorkOrderQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_work_order_header", {
        p_org_id: orgId!,
        p_event_id: eventId!,
      });
      if (error) throw error;
      const rows = (data ?? []) as EventWorkOrderHeaderRow[];
      return rows[0] ?? null;
    },
  });
}

export function eventProcurementOpsQueryKey(orgId: string | null, eventId: string | null) {
  return ["doc-event-procurement-ops", orgId, eventId] as const;
}

/**
 * Procurement/vendor dependencies behind the work order: one row per live
 * (non-cancelled) order line, carrying only item text, quantity, unit and
 * the delivery state. Agreed costs are confidential procurement data and are
 * excluded from the projection (SQL gate: membership; see 0081).
 */
export function useEventProcurementOpsLines(orgId: string | null, eventId: string | null) {
  return useQuery({
    queryKey: eventProcurementOpsQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_procurement_ops_lines", {
        p_org_id: orgId!,
        p_event_id: eventId!,
      });
      if (error) throw error;
      return (data ?? []) as EventProcurementOpsRow[];
    },
  });
}

export function payrollPeriodQueryKey(
  orgId: string | null,
  from: string | null,
  to: string | null,
) {
  return ["doc-payroll-period", orgId, from, to] as const;
}

/**
 * The payroll period sheet (كشف صرف / رواتب فترة): one row per host with any
 * RECORDED payroll fact in [from, to]. Earned comes from live attendance in
 * the period, advances and payouts from the host-wide ledgers by their record
 * dates, and `balance_total` = earned − advances − payouts (the same exact
 * money rule the payroll workspace applies, scoped to the period).
 * Gate: payroll.read — empty rows for an unauthorized caller (0081).
 */
export function usePayrollPeriodSheet(
  orgId: string | null,
  from: string | null,
  to: string | null,
) {
  return useQuery({
    queryKey: payrollPeriodQueryKey(orgId, from, to),
    enabled: !!orgId && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payroll_period_sheet", {
        p_org_id: orgId!,
        p_from: from!,
        p_to: to!,
      });
      if (error) throw error;
      return (data ?? []) as PayrollPeriodRow[];
    },
  });
}

export function hostStatementQueryKey(orgId: string | null, staffMemberId: string | null) {
  return ["doc-host-statement", orgId, staffMemberId] as const;
}

/**
 * The host statement (كشف حساب مضيف) for one staff member: one row per event
 * plus the host identity. `advances_total` is the host-WIDE canonical total
 * repeated on each row (the per-event view carries 0 by design); the surface
 * presents it once. Gate: payroll.read.
 */
export function useHostStatement(orgId: string | null, staffMemberId: string | null) {
  return useQuery({
    queryKey: hostStatementQueryKey(orgId, staffMemberId),
    enabled: !!orgId && !!staffMemberId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("host_statement", {
        p_org_id: orgId!,
        p_staff_member_id: staffMemberId!,
      });
      if (error) throw error;
      return (data ?? []) as HostStatementRow[];
    },
  });
}
