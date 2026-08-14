import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";

/**
 * Untyped client on purpose: this feature's tables/functions were added in
 * migration 0017 and the generated `database.types.ts` is refreshed by the
 * official Supabase type generation pipeline (`npm run db:types`). The
 * events API uses the same pattern; the schema is enforced server-side.
 */
const db: SupabaseClient = supabase;

export type QuickQuoteStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "CONVERTED"
  | "DISCARDED";

export interface QuickQuoteRow {
  id: string;
  organization_id: string;
  quotation_id: string | null;
  quotation_number: string | null;
  status: QuickQuoteStatus;
  prospect_name: string;
  prospect_phone: string | null;
  prospect_whatsapp: string | null;
  prospect_company: string | null;
  event_title: string | null;
  event_type: string | null;
  start_at: string | null;
  end_at: string | null;
  guest_count: number | null;
  venue_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuickQuoteLineRow {
  id: string;
  organization_id: string;
  quick_quote_id: string;
  description: string;
  item_type: CatalogItemType;
  unit: string;
  pricing_method: PricingMethod;
  quantity: string;
  unit_selling_price: string;
  total_selling: string;
  is_custom: boolean;
  sort_order: number;
}

export interface CustomerQuoteRow {
  id: string;
  organization_id: string;
  event_id: string | null;
  quotation_number: string;
  revision: number;
  status: "ISSUED" | "ACCEPTED" | "SUPERSEDED";
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  event_number_snapshot: string;
  event_title_snapshot: string;
  guest_count_snapshot: number | null;
  start_at_snapshot: string | null;
  end_at_snapshot: string | null;
  venue_snapshot: string | null;
  location_snapshot: string | null;
  terms: string | null;
  notes: string | null;
  total_selling: string;
  issued_at: string;
  accepted_at: string | null;
}

export interface CustomerQuoteLineRow {
  id: string;
  quotation_id: string;
  description: string;
  item_type: CatalogItemType;
  unit: string;
  pricing_method: PricingMethod;
  quantity: string;
  unit_selling_price: string;
  total_selling: string;
  is_custom: boolean;
  sort_order: number;
}

export interface QuickQuoteDraftValues {
  prospectName: string;
  prospectPhone: string;
  prospectWhatsapp: string;
  prospectCompany: string;
  eventTitle: string;
  eventType: string;
  startAt: string;
  endAt: string;
  guestCount: number | null;
  venueName: string;
  notes: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}

function normalizeDraft(values: QuickQuoteDraftValues) {
  return {
    p_prospect_name: values.prospectName.trim(),
    p_prospect_phone: values.prospectPhone.trim() || null,
    p_prospect_whatsapp: values.prospectWhatsapp.trim() || null,
    p_prospect_company: values.prospectCompany.trim() || null,
    p_event_title: values.eventTitle.trim() || null,
    p_event_type: values.eventType.trim() || null,
    p_start_at: values.startAt ? new Date(values.startAt).toISOString() : null,
    p_end_at: values.endAt ? new Date(values.endAt).toISOString() : null,
    p_guest_count: values.guestCount,
    p_venue_name: values.venueName.trim() || null,
    p_notes: values.notes.trim() || null,
  };
}

export function useQuickQuotes(orgId: string | null) {
  return useQuery({
    queryKey: ["quick-quotes", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [] as QuickQuoteListItem[];
      const [quotesRes, quotationsRes] = await Promise.all([
        db
          .from("quick_quotes")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
        // Totals come from the customer-facing (cost-free) projection.
        db
          .from("quotations_customer")
          .select("id, total_selling")
          .eq("organization_id", orgId)
          .is("event_id", null),
      ]);
      if (quotesRes.error) throw quotesRes.error;
      if (quotationsRes.error) throw quotationsRes.error;
      const totals = new Map(
        ((quotationsRes.data ?? []) as Array<{ id: string; total_selling: string }>).map(
          (q) => [q.id, q.total_selling],
        ),
      );
      return ((quotesRes.data ?? []) as QuickQuoteRow[]).map((row) => ({
        ...row,
        total_selling: row.quotation_id ? (totals.get(row.quotation_id) ?? null) : null,
      }));
    },
  });
}

export type QuickQuoteListItem = QuickQuoteRow & { total_selling: string | null };

export function useQuickQuote(orgId: string | null, id: string) {
  return useQuery({
    queryKey: ["quick-quote", orgId, id],
    enabled: !!orgId && !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from("quick_quotes")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as QuickQuoteRow;
    },
  });
}

export function useQuickQuoteLines(orgId: string | null, quickQuoteId: string) {
  return useQuery({
    queryKey: ["quick-quote-lines", orgId, quickQuoteId],
    enabled: !!orgId && !!quickQuoteId,
    queryFn: async () => {
      const { data, error } = await db
        .from("quick_quote_lines")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("quick_quote_id", quickQuoteId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as QuickQuoteLineRow[];
    },
  });
}

export function useQuickQuoteQuotation(orgId: string | null, quotationId: string) {
  return useQuery({
    queryKey: ["quick-quote-quotation", orgId, quotationId],
    enabled: !!orgId && !!quotationId,
    queryFn: async () => {
      const { data, error } = await db
        .from("quotations_customer")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("id", quotationId)
        .single();
      if (error) throw error;
      return data as CustomerQuoteRow;
    },
  });
}

export function useQuickQuoteQuotationLines(orgId: string | null, quotationId: string) {
  return useQuery({
    queryKey: ["quick-quote-quotation-lines", orgId, quotationId],
    enabled: !!orgId && !!quotationId,
    queryFn: async () => {
      const { data, error } = await db
        .from("quotation_lines_customer")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("quotation_id", quotationId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CustomerQuoteLineRow[];
    },
  });
}

export function arabicQuickQuoteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_AUTHORIZED")) return "غير مصرح لك بهذا الإجراء";
  if (message.includes("PROSPECT_NAME_REQUIRED")) return "أدخل اسم العميل المتوقع";
  if (message.includes("GUEST_COUNT_REQUIRED"))
    return "عدد الضيوف مطلوب للخدمات المحسوبة لكل ضيف";
  if (message.includes("EMPTY_QUOTATION")) return "أضف خدمة واحدة على الأقل";
  if (message.includes("PACKAGE_ALREADY_APPLIED"))
    return "تم تطبيق هذه الباقة مسبقاً";
  if (message.includes("PACKAGE_NOT_IN_ORG")) return "الباقة غير متوفرة";
  if (message.includes("QUICK_QUOTE_NOT_EDITABLE"))
    return "عرض السعر صادر ولا يمكن تعديله";
  if (message.includes("QUOTATION_NOT_ACCEPTED"))
    return "اعتمد العرض قبل التحويل إلى مناسبة";
  if (message.includes("EVENT_DATE_REQUIRED"))
    return "تاريخ المناسبة مطلوب للتحويل";
  if (message.includes("VENUE_REQUIRED")) return "الموقع مطلوب للتحويل";
  if (message.includes("INVALID_EVENT_WINDOW"))
    return "تاريخ النهاية يجب أن يكون بعد البداية";
  if (message.includes("QUICK_QUOTE_NOT_FOUND"))
    return "عرض السعر غير موجود";
  if (message.includes("QUOTATION_NOT_FOUND")) return "عرض السعر غير موجود";
  if (message.includes("LINE_NOT_FOUND")) return "الخدمة غير موجودة";
  return message;
}

export function useCreateQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: QuickQuoteDraftValues) =>
      rpc<QuickQuoteRow>("create_quick_quote", {
        p_org_id: orgId,
        ...normalizeDraft(values),
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quick-quotes", orgId] });
    },
  });
}

export function useSaveQuickQuoteLine(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      quickQuoteId: string;
      lineId: string | null;
      description: string;
      itemType: CatalogItemType;
      unit: string;
      pricingMethod: PricingMethod;
      quantity: string;
      unitSellingPrice: string;
      isCustom: boolean;
    }) =>
      rpc<QuickQuoteLineRow>("save_quick_quote_line", {
        p_org_id: orgId,
        p_quick_quote_id: args.quickQuoteId,
        p_line_id: args.lineId,
        p_description: args.description,
        p_item_type: args.itemType,
        p_unit: args.unit,
        p_pricing_method: args.pricingMethod,
        p_quantity: args.quantity,
        p_unit_selling_price: args.unitSellingPrice,
        p_is_custom: args.isCustom,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["quick-quote-lines", orgId, vars.quickQuoteId] });
    },
  });
}

export function useResetQuickQuoteLines(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quickQuoteId: string) =>
      rpc<void>("reset_quick_quote_lines", {
        p_org_id: orgId,
        p_quick_quote_id: quickQuoteId,
      }),
    onSuccess: (_data, quickQuoteId) => {
      void qc.invalidateQueries({ queryKey: ["quick-quote-lines", orgId, quickQuoteId] });
    },
  });
}

export function useApplyPackageToQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { quickQuoteId: string; packageId: string }) =>
      rpc<number>("apply_package_to_quick_quote", {
        p_org_id: orgId,
        p_quick_quote_id: args.quickQuoteId,
        p_package_id: args.packageId,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["quick-quote-lines", orgId, vars.quickQuoteId] });
    },
  });
}

export function useIssueQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quickQuoteId: string) =>
      rpc<CustomerQuoteRow>("issue_quick_quote", {
        p_org_id: orgId,
        p_quick_quote_id: quickQuoteId,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (quote, quickQuoteId) => {
      void qc.invalidateQueries({ queryKey: ["quick-quotes", orgId] });
      void qc.invalidateQueries({ queryKey: ["quick-quote", orgId, quickQuoteId] });
      void qc.invalidateQueries({ queryKey: ["quick-quote-quotation", orgId, quote.id] });
    },
  });
}

export function useAcceptQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotationId: string) =>
      rpc<CustomerQuoteRow>("accept_quick_quote", {
        p_org_id: orgId,
        p_quotation_id: quotationId,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (quote) => {
      void qc.invalidateQueries({ queryKey: ["quick-quotes", orgId] });
      void qc.invalidateQueries({ queryKey: ["quick-quote-quotation", orgId, quote.id] });
    },
  });
}

export function useConvertQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      quotationId: string;
      startAt?: string;
      endAt?: string;
      venueName?: string;
      guestCount?: number;
      eventTitle?: string;
    }) =>
      rpc<{ id: string }>("convert_quick_quote", {
        p_org_id: orgId,
        p_quotation_id: args.quotationId,
        p_idempotency_key: crypto.randomUUID(),
        p_start_at: args.startAt ? new Date(args.startAt).toISOString() : null,
        p_end_at: args.endAt ? new Date(args.endAt).toISOString() : null,
        p_venue_name: args.venueName?.trim() || null,
        p_guest_count: args.guestCount ?? null,
        p_event_title: args.eventTitle?.trim() || null,
      }),
    onSuccess: (_event, args) => {
      void qc.invalidateQueries({ queryKey: ["quick-quotes", orgId] });
      void qc.invalidateQueries({ queryKey: ["quick-quote-quotation", orgId, args.quotationId] });
      void qc.invalidateQueries({ queryKey: ["events", orgId] });
    },
  });
}

export function useDiscardQuickQuote(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quickQuoteId: string) =>
      rpc<void>("discard_quick_quote", {
        p_org_id: orgId,
        p_quick_quote_id: quickQuoteId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quick-quotes", orgId] });
    },
  });
}
