import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import type {
  EventExpenseSummaryRow,
  EventExpenseCategorySummaryRow,
  EventFinancialClosureRow,
  ExpenseCategory,
  PaymentMethod,
} from "@/lib/dbTypes";
import { fromDbAmount, toDbNumeric } from "@/lib/money";

const db: SupabaseClient = supabase;

// ---------------------------------------------------------------------------
// Event expenses (unified direct-cost ledger — transport/fuel/rental/…)
// ---------------------------------------------------------------------------

export interface EventExpense {
  id: string;
  eventId: string;
  category: ExpenseCategory;
  amountMilli: number;
  expenseDate: string;
  description: string;
  payee: string | null;
  reference: string | null;
  status: "RECORDED" | "VOIDED";
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export function mapExpense(row: EventExpenseSummaryRow): EventExpense {
  return {
    id: row.id ?? "",
    eventId: row.event_id ?? "",
    category: (row.category ?? "OTHER") as ExpenseCategory,
    amountMilli: fromDbAmount(row.amount),
    expenseDate: row.expense_date ?? "",
    description: row.description ?? "",
    payee: row.payee ?? null,
    reference: row.reference ?? null,
    status: (row.status ?? "RECORDED") as "RECORDED" | "VOIDED",
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    createdAt: row.created_at ?? "",
  };
}

export function useEventExpenses(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-expenses", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("event_expense_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapExpense);
    },
  });
}

export function useEventExpenseCategories(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-expense-categories", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("event_expense_category_summaries")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId);
      if (error) throw error;
      return (data ?? []) as EventExpenseCategorySummaryRow[];
    },
  });
}

export interface RecordExpenseInput {
  category: ExpenseCategory;
  amountMilli: number;
  expenseDate: string;
  description: string;
  payee?: string;
  reference?: string;
  paymentMethod?: PaymentMethod | null;
}

function invalidateFinance(qc: ReturnType<typeof useQueryClient>, orgId: string | null, eventId: string) {
  void qc.invalidateQueries({ queryKey: ["event-expenses", orgId, eventId] });
  void qc.invalidateQueries({ queryKey: ["event-expense-categories", orgId, eventId] });
  void qc.invalidateQueries({ queryKey: ["event-finance", orgId, eventId] });
}

export function useRecordExpense(orgId: string | null, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: RecordExpenseInput) =>
      callRpc("record_event_expense", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_category: v.category,
        p_amount: toDbNumeric(v.amountMilli),
        p_expense_date: v.expenseDate,
        p_description: v.description,
        p_payment_method: v.paymentMethod ?? null,
        p_payee: v.payee || null,
        p_reference: v.reference || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateFinance(qc, orgId, eventId),
  });
}

export function useVoidExpense(orgId: string | null, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, reason }: { expenseId: string; reason: string }) =>
      callRpc("void_event_expense", {
        p_org_id: orgId,
        p_expense_id: expenseId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateFinance(qc, orgId, eventId),
  });
}

// ---------------------------------------------------------------------------
// Financial closure cycles
// ---------------------------------------------------------------------------

export interface FinancialClosure {
  id: string;
  eventId: string;
  closedAt: string;
  closedByName: string | null;
  closeNote: string | null;
  revenueAtCloseMilli: number;
  collectedAtCloseMilli: number;
  outstandingAtCloseMilli: number;
  costsAtCloseMilli: number;
  profitAtCloseMilli: number;
  marginAtClose: number | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export function mapClosure(row: EventFinancialClosureRow): FinancialClosure {
  return {
    id: row.id,
    eventId: row.event_id,
    closedAt: row.closed_at,
    closedByName: null, // resolved separately via profiles if needed
    closeNote: row.close_note,
    revenueAtCloseMilli: fromDbAmount(row.revenue_at_close),
    collectedAtCloseMilli: fromDbAmount(row.collected_at_close),
    outstandingAtCloseMilli: fromDbAmount(row.outstanding_at_close),
    costsAtCloseMilli: fromDbAmount(row.costs_at_close),
    profitAtCloseMilli: fromDbAmount(row.profit_at_close),
    marginAtClose: row.margin_at_close,
    reopenedAt: row.reopened_at,
    reopenReason: row.reopen_reason,
  };
}

export function useEventFinancialClosures(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-financial-closures", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db
        .from("event_financial_closures")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapClosure);
    },
  });
}

export interface FinancialReadinessCheck {
  check_key: string;
  ok: boolean;
  detail: string;
}

export function useFinancialReadiness(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: ["event-financial-readiness", orgId, eventId],
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_financial_readiness", {
        p_org_id: orgId!,
        p_event_id: eventId,
      });
      if (error) throw error;
      return ((data ?? []) as Array<{ check_key: string | null; ok: boolean | null; detail: string | null }>).map(
        (c) => ({ check_key: c.check_key ?? "", ok: !!c.ok, detail: c.detail ?? "" }),
      );
    },
  });
}

function invalidateClosures(qc: ReturnType<typeof useQueryClient>, orgId: string | null, eventId: string) {
  void qc.invalidateQueries({ queryKey: ["event-financial-closures", orgId, eventId] });
  void qc.invalidateQueries({ queryKey: ["event-financial-readiness", orgId, eventId] });
}

export function useCloseFinancially(orgId: string | null, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ note }: { note?: string }) =>
      callRpc<EventFinancialClosureRow>("close_event_financially", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_note: note || null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateClosures(qc, orgId, eventId),
  });
}

export function useReopenFinancially(orgId: string | null, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      callRpc<EventFinancialClosureRow>("reopen_event_financially", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => invalidateClosures(qc, orgId, eventId),
  });
}

export function financeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("FINANCIAL_CLOSE_REQUIRES_ACCEPTED_QUOTATION")) return "لا يمكن الإغلاق المالي بدون عرض سعر معتمد";
  if (message.includes("FINANCIAL_CLOSE_OUTSTANDING_BALANCE")) return "لا يمكن الإغلاق المالي ومبلغ متبقٍ على العميل";
  if (message.includes("FINANCIAL_CLOSURE_BLOCKS_MUTATION")) return "المناسبة مغلقة ماليًا — أعد فتحها مالياً قبل أي تعديل مالي";
  if (message.includes("EVENT_NOT_FINANCIALLY_CLOSED")) return "المناسبة ليست مغلقة مالياً";
  if (message.includes("REOPEN_REASON_REQUIRED")) return "اكتب سبب إعادة الفتح بوضوح";
  if (message.includes("EXPENSE_DESCRIPTION_REQUIRED")) return "اكتب وصف المصروف";
  if (message.includes("EXPENSE_VOID_REASON_REQUIRED")) return "اكتب سبب إلغاء المصروف";
  if (message.includes("EXPENSE_ALREADY_VOIDED")) return "هذا المصروف ملغى بالفعل";
  if (message.includes("TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED")) return "رصيد الصندوق لا يكفي لهذا المصروف";
  if (message.includes("TREASURY_ACCOUNT_NOT_FOUND")) return "حساب الصندوق غير موجود";
  if (message.includes("TREASURY_ACCOUNT_INACTIVE")) return "حساب الصندوق غير نشط";
  if (message.includes("INVALID_PAYMENT_AMOUNT")) return "المبلغ غير صالح — يجب أن يكون أكبر من صفر";
  if (message.includes("NOT_AUTHORIZED")) return "ليس لديك صلاحية لهذا الإجراء المالي";
  return message;
}
