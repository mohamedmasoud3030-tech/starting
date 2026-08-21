import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as db } from "@/lib/supabase";
import { fromDbAmount, toDbNumeric, type MilliOMR } from "@/lib/money";
import { todayInMuscat } from "@/lib/dates";
import { callRpc } from "@/lib/rpc";
import { paymentError } from "./payments.api";

/**
 * S6+ invoicing data layer.
 *
 * The accepted quotation remains the authoritative commercial amount, while
 * customer_payments remains the authoritative collected-cash ledger. Reads use
 * generated database types and stable read models; writes go through the
 * server-authoritative SECURITY DEFINER commands.
 */

export type InvoiceStatus = "ISSUED" | "CANCELLED";
export type InstallmentKind = "DEPOSIT" | "INSTALLMENT" | "FINAL";
export type InstallmentEffective = "PAID" | "PENDING" | "CANCELLED";

export interface InvoiceSummary {
  invoiceId: string;
  eventId: string;
  eventNumber: string;
  eventTitle: string;
  quotationId: string | null;
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string | null;
  totalMilli: MilliOMR;
  preVatMilli: MilliOMR;
  vatRegistered: boolean;
  vatPercent: number;
  vatAmountMilli: MilliOMR;
  vatRegistrationNumber: string | null;
  status: InvoiceStatus;
  note: string | null;
  paidMilli: MilliOMR;
  remainingMilli: MilliOMR;
  voidReason: string | null;
}

export interface InstallmentSummary {
  installmentId: string;
  invoiceId: string;
  seq: number;
  kind: InstallmentKind;
  dueDate: string;
  amountMilli: MilliOMR;
  planStatus: string;
  effectiveStatus: InstallmentEffective;
}

export interface InstallmentInput {
  seq: number;
  kind: InstallmentKind;
  dueDate: string;
  amountMilli: MilliOMR;
}

function mapInvoice(row: Record<string, unknown>): InvoiceSummary {
  return {
    invoiceId: String(row.invoice_id),
    eventId: String(row.event_id),
    eventNumber: (row.event_number as string) ?? "",
    eventTitle: (row.event_title as string) ?? "",
    quotationId: row.quotation_id ? String(row.quotation_id) : null,
    invoiceNumber: (row.invoice_number as string) ?? "",
    issuedAt: String(row.issued_at),
    dueAt: (row.due_at as string) ?? null,
    totalMilli: fromDbAmount(row.total_amount as never),
    preVatMilli: fromDbAmount(row.pre_vat_total as never),
    vatRegistered: Boolean(row.vat_registered),
    vatPercent: Number(row.vat_percent ?? 0),
    vatAmountMilli: fromDbAmount(row.vat_amount as never),
    vatRegistrationNumber: (row.vat_registration_number as string) ?? null,
    status: (row.invoice_status as InvoiceStatus) ?? "ISSUED",
    note: (row.note as string) ?? null,
    paidMilli: fromDbAmount(row.paid_total as never),
    remainingMilli: fromDbAmount(row.remaining_balance as never),
    voidReason: (row.void_reason as string) ?? null,
  };
}

function mapInstallment(row: Record<string, unknown>): InstallmentSummary {
  return {
    installmentId: String(row.installment_id),
    invoiceId: String(row.invoice_id),
    seq: Number(row.seq ?? 0),
    kind: (row.kind as InstallmentKind) ?? "INSTALLMENT",
    dueDate: String(row.due_date),
    amountMilli: fromDbAmount(row.amount as never),
    planStatus: (row.plan_status as string) ?? "PENDING",
    effectiveStatus: (row.effective_status as InstallmentEffective) ?? "PENDING",
  };
}

/** Return only the current live invoice. Cancelled history remains in the DB. */
export function useEventInvoice(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-invoice", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("invoice_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .eq("invoice_status", "ISSUED")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return mapInvoice(data as Record<string, unknown>);
    },
  });
}

/** Return the schedule for the current live invoice only. */
export function useEventInstallments(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-installments", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("invoice_installment_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .eq("plan_status", "PENDING")
        .order("seq", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => mapInstallment(row as Record<string, unknown>));
    },
  });
}

export function useCreateInvoice(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      invoiceNumber: string;
      dueAt: string | null;
      totalMilli: MilliOMR;
      installments: InstallmentInput[];
      note: string;
    }) =>
      callRpc<Record<string, unknown>>("create_event_invoice", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_invoice_number: v.invoiceNumber,
        p_due_at: v.dueAt,
        p_total_amount: toDbNumeric(v.totalMilli),
        p_installments: JSON.stringify(
          v.installments.map((x) => ({
            seq: x.seq,
            kind: x.kind,
            due_date: x.dueDate,
            amount: toDbNumeric(x.amountMilli),
          })),
        ),
        p_note: v.note || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-invoice", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-installments", orgId, eventId] });
    },
  });
}

export function useVoidInvoice(orgId: string | null, eventId: string) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) =>
      callRpc<Record<string, unknown>>("void_invoice", {
        p_org_id: orgId,
        p_invoice_id: invoiceId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void q.invalidateQueries({ queryKey: ["event-invoice", orgId, eventId] });
      void q.invalidateQueries({ queryKey: ["event-installments", orgId, eventId] });
    },
  });
}

/** Build a deposit + equal-installment schedule that sums exactly to total. */
export function buildInstallmentSchedule(
  totalMilli: MilliOMR,
  depositMilli: MilliOMR,
  installmentsCount: number,
  firstDueDate: string,
  intervalDays: number,
): InstallmentInput[] {
  const remaining = totalMilli - depositMilli;
  const count = Math.max(1, installmentsCount);
  const base = Math.floor(remaining / count);
  const out: InstallmentInput[] = [
    {
      seq: 0,
      kind: "DEPOSIT",
      dueDate: todayInMuscat(),
      amountMilli: depositMilli,
    },
  ];
  let sum = 0;
  for (let k = 0; k < count; k += 1) {
    let amount = base;
    if (k === count - 1) amount = remaining - sum;
    sum += amount;
    const due = new Date(firstDueDate);
    due.setDate(due.getDate() + k * intervalDays);
    out.push({
      seq: k + 1,
      kind: k === count - 1 ? "FINAL" : "INSTALLMENT",
      dueDate: due.toISOString().slice(0, 10),
      amountMilli: amount,
    });
  }
  return out;
}

export function invoiceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_AUTHORIZED")) return "ليس لديك صلاحية لإصدار فاتورة";
  if (message.includes("INVOICE_NUMBER_REQUIRED")) return "يرجى إدخال رقم الفاتورة";
  if (message.includes("INVOICE_ALREADY_EXISTS")) return "توجد فاتورة صادرة لهذه المناسبة بالفعل";
  if (message.includes("INVOICE_REQUIRES_ACCEPTED_QUOTATION")) return "يجب اعتماد عرض سعر للمناسبة قبل إصدار الفاتورة";
  if (message.includes("INVOICE_TOTAL_MISMATCH")) return "قيمة الفاتورة يجب أن تطابق إجمالي عرض السعر المعتمد";
  if (message.includes("INVOICE_INSTALLMENTS_REQUIRED")) return "يرجى تحديد العربون وجدول الدفعات";
  if (message.includes("INSTALLMENT_TOTAL_MISMATCH")) return "مجموع الدفعات يجب أن يساوي قيمة الفاتورة بالضبط";
  if (message.includes("INVALID_INSTALLMENT_SEQUENCE")) return "ترتيب الدفعات غير صالح";
  if (message.includes("INVALID_INSTALLMENT_KIND")) return "نوع دفعة غير صالح";
  if (message.includes("INSTALLMENT_DATES_OUT_OF_ORDER")) return "تواريخ الدفعات يجب أن تكون مرتبة زمنياً";
  if (message.includes("INSTALLMENT_DUE_DATE_REQUIRED")) return "يرجى تحديد تاريخ استحقاق لكل دفعة";
  if (message.includes("INVALID_INSTALLMENT_AMOUNT")) return "قيمة إحدى الدفعات غير صالحة";
  if (message.includes("INVOICE_ALREADY_CANCELLED")) return "الفاتورة ملغاة بالفعل";
  if (message.includes("VOID_REASON_REQUIRED")) return "يرجى ذكر سبب الإلغاء";
  if (message.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) return "تعارض في إعادة إرسال الطلب — أعد المحاولة من الشاشة";
  return paymentError(error);
}
