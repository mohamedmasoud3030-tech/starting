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
