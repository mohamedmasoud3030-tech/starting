import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import { muscatWallClockToIso } from "@/lib/dates";
import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";

const db: SupabaseClient = supabase;

export type QuotationStatus =
  | "DRAFT"
  | "ISSUED"
  | "EXPIRED"
  | "ACCEPTED"
  | "REJECTED"
  | "CONVERTED"
  | "CANCELLED"
  | "SUPERSEDED";

export type QuotationDiscountType = "NONE" | "FIXED" | "PERCENT";

export interface QuotationRow {
  id: string;
  organization_id: string;
  event_id: string | null;
  quotation_number: string | null;
  revision: number;
  status: QuotationStatus;
  customer_id: string | null;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  prospect_whatsapp: string | null;
  prospect_company: string | null;
  event_number_snapshot: string | null;
  event_title_snapshot: string;
  event_type_snapshot: string;
  guest_count_snapshot: number | null;
  start_at_snapshot: string | null;
  end_at_snapshot: string | null;
  venue_snapshot: string | null;
  location_snapshot: string | null;
  terms: string | null;
  notes: string | null;
  subtotal: string;
  total_selling: string;
  transport_required: boolean;
  transport_zone: string | null;
  transport_amount: string;
  transport_note: string | null;
  surcharge_amount: string;
  surcharge_note: string | null;
  discount_type: QuotationDiscountType;
  discount_value: string;
  discount_amount: string;
  valid_until: string | null;
  series_id: string | null;
  superseded_reason: string | null;
  issued_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  expired_at: string | null;
  converted_event_id: string | null;
  is_expired: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuotationLineRow {
  id: string;
  organization_id: string;
  quotation_id: string;
  source_catalog_item_id: string | null;
  source_package_id: string | null;
  description: string;
  item_type: CatalogItemType;
  unit: string;
  pricing_method: PricingMethod;
  quantity: string;
  unit_selling_price: string;
  expected_unit_cost: string | null;
  total_selling: string;
  total_expected_cost: string | null;
  is_custom: boolean;
  notes: string | null;
  sort_order: number;
}

export interface QuotationDraftLineValues {
  id: string | null;
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantity: string;
  unitSellingPrice: string;
  expectedUnitCost: string;
  isCustom: boolean;
  sourceCatalogItemId: string | null;
  sourcePackageId: string | null;
  notes?: string | null;
}

export interface QuotationDraftValues {
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
  customerId?: string | null;
}

function normalizeDraft(values: QuotationDraftValues) {
  return {
    p_customer_id: values.customerId ?? null,
    p_prospect_name: values.prospectName.trim(),
    p_prospect_phone: values.prospectPhone.trim() || null,
    p_prospect_whatsapp: values.prospectWhatsapp.trim() || null,
    p_prospect_company: values.prospectCompany.trim() || null,
    p_event_title: values.eventTitle.trim() || null,
    p_event_type: values.eventType.trim() || null,
    p_start_at: values.startAt ? (muscatWallClockToIso(values.startAt) ?? new Date(values.startAt).toISOString()) : null,
    p_end_at: values.endAt ? (muscatWallClockToIso(values.endAt) ?? new Date(values.endAt).toISOString()) : null,
    p_guest_count: values.guestCount,
    p_venue_name: values.venueName.trim() || null,
    p_notes: values.notes.trim() || null,
  };
}

export function useQuotations(orgId: string | null) {
  return useQuery({
    queryKey: ["quotations", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("quotations_customer")
        .select("*")
        .eq("organization_id", orgId!)
        .is("event_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QuotationRow[];
    },
  });
}

export function useQuotation(orgId: string | null, id: string) {
  return useQuery({
    queryKey: ["quotation", orgId, id],
    enabled: !!orgId && !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from("quotations_customer")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as QuotationRow;
    },
  });
}

export function useQuotationLines(orgId: string | null, quotationId: string) {
  return useQuery({
    queryKey: ["quotation-lines", orgId, quotationId],
    enabled: !!orgId && !!quotationId,
    queryFn: async () => {
      const { data, error } = await db
        .from("quotation_lines_customer")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("quotation_id", quotationId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as QuotationLineRow[];
    },
  });
}

export function arabicQuotationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_AUTHORIZED")) return "غير مصرح لك بهذا الإجراء";
  if (message.includes("PROSPECT_NAME_REQUIRED")) return "أدخل اسم العميل أو الجهة";
  if (message.includes("GUEST_COUNT_REQUIRED")) return "عدد الضيوف مطلوب للخدمات المحسوبة لكل ضيف";
  if (message.includes("EMPTY_QUOTATION")) return "أضف خدمة واحدة على الأقل";
  if (message.includes("PACKAGE_ALREADY_APPLIED")) return "تم تطبيق هذه الباقة مسبقاً";
  if (message.includes("PACKAGE_NOT_IN_ORG")) return "الباقة غير متوفرة";
  if (message.includes("QUOTATION_NOT_EDITABLE")) return "العرض صادر ولا يمكن تعديل حقائقه التجارية";
  if (message.includes("QUOTATION_NOT_ACCEPTED")) return "اعتمد العرض قبل التحويل إلى مناسبة";
  if (message.includes("QUOTATION_NOT_REVISABLE")) return "لا يمكن إنشاء نسخة معدلة من هذا العرض";
  if (message.includes("QUOTATION_REJECT_NOT_ALLOWED")) return "لا يمكن رفض هذا العرض في حالته الحالية";
  if (message.includes("QUOTATION_EXPIRE_NOT_ALLOWED")) return "لا يمكن إنهاء صلاحية هذا العرض في حالته الحالية";
  if (message.includes("INVALID_DISCOUNT")) return "قيمة الخصم غير صالحة (النسبة بين 0 و100)";
  if (message.includes("NEGATIVE_TOTAL")) return "الخصم أكبر من المبلغ — لا يمكن أن يصبح الإجمالي سالباً";
  if (message.includes("INVALID_TRANSPORT_AMOUNT")) return "مبلغ النقل لا يمكن أن يكون سالباً";
  if (message.includes("INVALID_SURCHARGE_AMOUNT")) return "الرسوم الإضافية لا يمكن أن تكون سالبة";
  if (message.includes("EVENT_DATE_REQUIRED")) return "تاريخ المناسبة مطلوب للتحويل";
  if (message.includes("VENUE_REQUIRED")) return "الموقع مطلوب للتحويل";
  if (message.includes("INVALID_EVENT_WINDOW")) return "تاريخ النهاية يجب أن يكون بعد البداية";
  if (message.includes("QUOTATION_NOT_FOUND")) return "عرض السعر غير موجود";
  if (message.includes("LINE_NOT_FOUND")) return "الخدمة غير موجودة";
  if (message.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) return "تعذر تكرار العملية لأن بيانات الطلب تغيرت";
  return message;
}

function invalidateQuotation(qc: ReturnType<typeof useQueryClient>, orgId: string | null, id?: string) {
  void qc.invalidateQueries({ queryKey: ["quotations", orgId] });
  if (id) {
    void qc.invalidateQueries({ queryKey: ["quotation", orgId, id] });
    void qc.invalidateQueries({ queryKey: ["quotation-lines", orgId, id] });
  }
}

export function usePersistQuotationDraft(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quotationId,
      idempotencyKey,
      values,
      lines,
    }: {
      quotationId: string | null;
      idempotencyKey: string;
      values: QuotationDraftValues;
      lines: QuotationDraftLineValues[];
    }) => callRpc<QuotationRow>("persist_quotation_draft", {
      p_org_id: orgId,
      p_quotation_id: quotationId,
      p_idempotency_key: idempotencyKey,
      ...normalizeDraft(values),
      p_lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        item_type: line.itemType,
        unit: line.unit,
        pricing_method: line.pricingMethod,
        quantity: line.quantity,
        unit_selling_price: line.unitSellingPrice,
        expected_unit_cost: line.expectedUnitCost,
        is_custom: line.isCustom,
        source_catalog_item_id: line.sourceCatalogItemId,
        source_package_id: line.sourcePackageId,
        notes: line.notes ?? null,
      })),
    }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useIssueQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotationId: string) => callRpc<QuotationRow>("issue_quotation", {
      p_org_id: orgId,
      p_quotation_id: quotationId,
      p_idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useAcceptQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotationId: string) => callRpc<QuotationRow>("accept_quotation", {
      p_org_id: orgId,
      p_quotation_id: quotationId,
      p_idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useConvertQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { quotationId: string; startAt?: string; endAt?: string; venueName?: string; guestCount?: number; eventTitle?: string }) =>
      callRpc<{ id: string }>("convert_quotation_to_event", {
        p_org_id: orgId,
        p_quotation_id: args.quotationId,
        p_idempotency_key: crypto.randomUUID(),
        p_start_at: args.startAt ? (muscatWallClockToIso(args.startAt) ?? new Date(args.startAt).toISOString()) : null,
        p_end_at: args.endAt ? (muscatWallClockToIso(args.endAt) ?? new Date(args.endAt).toISOString()) : null,
        p_venue_name: args.venueName?.trim() || null,
        p_guest_count: args.guestCount ?? null,
        p_event_title: args.eventTitle?.trim() || null,
      }),
    onSuccess: (_event, args) => {
      invalidateQuotation(qc, orgId, args.quotationId);
      void qc.invalidateQueries({ queryKey: ["events", orgId] });
      // convert_quotation_to_event CREATES a customer row when the quotation
      // was for an unlinked prospect (migration 0051). Without this refresh
      // the customers screen kept showing a stale list that omitted the
      // just-created customer.
      void qc.invalidateQueries({ queryKey: ["customers", orgId] });
    },
  });
}

export function useCancelQuotationDraft(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotationId: string) => callRpc<QuotationRow>("cancel_quotation_draft", { p_org_id: orgId, p_quotation_id: quotationId }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export interface QuotationPricingInput {
  transportRequired?: boolean | null;
  transportZone?: string | null;
  transportAmount?: string | null;
  transportNote?: string | null;
  surchargeAmount?: string | null;
  surchargeNote?: string | null;
  discountType?: QuotationDiscountType | null;
  discountValue?: string | null;
  validUntil?: string | null;
}

export function useSetQuotationPricing(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quotationId, input }: { quotationId: string; input: QuotationPricingInput }) =>
      callRpc<QuotationRow>("set_quotation_pricing", {
        p_org_id: orgId,
        p_quotation_id: quotationId,
        p_idempotency_key: crypto.randomUUID(),
        p_transport_required: input.transportRequired ?? null,
        p_transport_zone: input.transportZone ?? null,
        p_transport_amount: input.transportAmount ?? null,
        p_transport_note: input.transportNote ?? null,
        p_surcharge_amount: input.surchargeAmount ?? null,
        p_surcharge_note: input.surchargeNote ?? null,
        p_discount_type: input.discountType ?? null,
        p_discount_value: input.discountValue ?? null,
        p_valid_until: input.validUntil ?? null,
      }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useRejectQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quotationId, reason }: { quotationId: string; reason?: string }) =>
      callRpc<QuotationRow>("reject_quotation", {
        p_org_id: orgId,
        p_quotation_id: quotationId,
        p_reason: reason ?? null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useExpireQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quotationId: string) =>
      callRpc<QuotationRow>("expire_quotation", {
        p_org_id: orgId,
        p_quotation_id: quotationId,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}

export function useReviseQuotation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quotationId, reason }: { quotationId: string; reason?: string }) =>
      callRpc<QuotationRow>("revise_quotation", {
        p_org_id: orgId,
        p_quotation_id: quotationId,
        p_reason: reason ?? null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (quote) => invalidateQuotation(qc, orgId, quote.id),
  });
}
