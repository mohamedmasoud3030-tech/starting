import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  CustomerPaymentSummaryRow,
  CustomerPaymentRow,
  EventFinanceSummaryRow,
  PaymentMethod,
} from "@/lib/dbTypes";
import { fromDbAmount, toDbNumeric } from "@/lib/money";

const db: SupabaseClient = supabase;

/**
 * S6 customer payment + event economics data layer.
 *
 * Reads use only the stable, cost-gated read models published by migration
 * 0037; every write is a server-authoritative SECURITY DEFINER command with an
 * idempotency key. Money crosses the RPC boundary as the exact numeric(12,3)
 * transport shape declared by the generated types (see `toDbNumeric`); no
 * binary floating-point arithmetic becomes financial truth.
 */

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export interface EventFinance {
  eventId: string;
  eventNumber: string;
  eventStatus: string;
  /** Exact milli-OMR of the accepted quotation's total selling. */
  acceptedRevenueMilli: number;
  expectedCostMilli: number;
  expectedProfitMilli: number;
  amountPaidMilli: number;
  outstandingMilli: number;
  committedCostMilli: number;
  deliveredCostMilli: number;
  grossMarginMilli: number;
}

export interface CustomerPayment {
  id: string;
  eventId: string;
  eventNumber: string;
  amountMilli: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  status: "RECORDED" | "VOIDED";
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export function mapFinance(row: EventFinanceSummaryRow | null | undefined): EventFinance | null {
  if (!row || !row.event_id) return null;
  return {
    eventId: row.event_id,
    eventNumber: row.event_number ?? "",
    eventStatus: row.event_status ?? "",
    acceptedRevenueMilli: fromDbAmount(row.accepted_revenue),
    expectedCostMilli: fromDbAmount(row.expected_cost),
    expectedProfitMilli: fromDbAmount(row.expected_profit),
    amountPaidMilli: fromDbAmount(row.amount_paid),
    outstandingMilli: fromDbAmount(row.outstanding_balance),
    committedCostMilli: fromDbAmount(row.committed_cost),
    deliveredCostMilli: fromDbAmount(row.delivered_cost),
    grossMarginMilli: fromDbAmount(row.gross_margin),
  };
}

export function mapPayment(row: CustomerPaymentSummaryRow): CustomerPayment {
  return {
    id: row.payment_id ?? "",
    eventId: row.event_id ?? "",
    eventNumber: row.event_number ?? "",
    amountMilli: fromDbAmount(row.amount),
    method: (row.payment_method ?? "OTHER") as PaymentMethod,
    reference: row.reference ?? null,
    notes: row.notes ?? null,
    paidAt: row.paid_at ?? "",
    status: (row.status ?? "RECORDED") as "RECORDED" | "VOIDED",
    voidReason: row.void_reason ?? null,
    voidedAt: row.voided_at ?? null,
    createdAt: row.created_at ?? "",
  };
}

/** One authoritative economics row per event (null when not authorized/cost-gated). */
export function useEventFinance(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-finance", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("event_finance_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .maybeSingle();
      if (error) throw error;
      return mapFinance(data);
    },
  });
}

/** Payment history for an event (empty when not authorized/cost-gated). */
export function useEventPayments(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-payments", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("customer_payment_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPayment);
    },
  });
}

export interface RecordPaymentInput {
  amountMilli: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
}

export function useRecordPayment(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: RecordPaymentInput): Promise<CustomerPaymentRow> =>
      rpc("record_customer_payment", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_amount: toDbNumeric(v.amountMilli),
        p_payment_method: v.method,
        p_reference: v.reference || null,
        p_notes: v.notes || null,
        p_paid_at: null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-payments", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-finance", orgId, eventId] });
    },
  });
}

export function useVoidPayment(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }): Promise<CustomerPaymentRow> =>
      rpc("void_customer_payment", {
        p_org_id: orgId,
        p_payment_id: paymentId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-payments", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-finance", orgId, eventId] });
    },
  });
}

/** Arabic, owner-friendly error messages for the S6 command surface. */
export function paymentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("INVALID_PAYMENT_AMOUNT")) return "المبلغ غير صالح — يجب أن يكون أكبر من صفر";
  if (message.includes("OMR_PRECISION_EXCEEDED")) return "المبلغ يتجاوز ثلاث خانات عشرية";
  if (message.includes("OMR_AMOUNT_OUT_OF_RANGE")) return "المبلغ أكبر من الحد الأقصى المسموح به";
  if (message.includes("PAYMENT_REQUIRES_ACCEPTED_QUOTATION")) return "لا يمكن تسجيل دفعة قبل اعتماد عرض سعر للمناسبة";
  if (message.includes("EVENT_NOT_PAYABLE")) return "لا يمكن تسجيل دفعة على مناسبة ملغاة";
  if (message.includes("PAYMENT_METHOD_REQUIRED")) return "يرجى اختيار طريقة الدفع";
  if (message.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) return "تعارض في طلب الدفع — حاول مجدداً";
  if (message.includes("PAYMENT_ALREADY_VOIDED")) return "هذه الدفعة ملغاة بالفعل";
  if (message.includes("PAYMENT_VOID_REASON_REQUIRED")) return "يرجى ذكر سبب الإلغاء";
  if (message.includes("NOT_AUTHORIZED")) return "ليس لديك صلاحية لتنفيذ هذا الإجراء المالي";
  return message;
}
