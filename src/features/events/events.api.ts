import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";

/**
 * Events data layer: list/detail reads, the workspace aggregate read, the
 * readiness read model, and the generic event command mutation.
 *
 * TENANT SCOPE: every query key carries `orgId`, so two organizations can
 * never share a cache entry (see `src/app/tenantCache.ts` for the second,
 * redundant isolation mechanism).
 */

const db: SupabaseClient = supabase;

export type EventStatus =
  | "DRAFT"
  | "QUOTED"
  | "CONFIRMED"
  | "PREPARING"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "RETURNING"
  | "CLOSED"
  | "CANCELLED";

export interface EventRow {
  id: string;
  organization_id: string;
  customer_id: string;
  event_number: string;
  title: string;
  event_type: string;
  start_at: string;
  end_at: string;
  guest_count: number;
  venue_name: string;
  location_details: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  status: EventStatus;
  cancellation_reason: string | null;
  accepted_quotation_id: string | null;
  created_at: string;
}

export interface CommercialLine {
  id: string;
  description: string;
  item_type: string;
  unit: string;
  pricing_method: string;
  quantity: string;
  unit_selling_price: string;
  expected_unit_cost?: string;
  total_selling: string;
  total_expected_cost?: string;
  is_custom: boolean;
}

export interface Quote {
  id: string;
  quotation_number: string;
  revision: number;
  status: "ISSUED" | "ACCEPTED" | "SUPERSEDED";
  total_selling: string;
  total_expected_cost?: string;
  total_expected_profit?: string;
  issued_at: string;
}

export interface StaffMember {
  id: string;
  name: string;
  staff_type: string;
  is_active: boolean;
  default_compensation_method?: string;
  default_rate?: string;
}

export interface Assignment {
  id: string;
  staff_member_id: string;
  assignment_role: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
}

export interface EventReadiness {
  status: string;
  staff_missing: number;
  equipment_shortage: number;
}

export interface Capacity {
  id: string;
  catalog_item_id: string;
  total_quantity: number;
  catalog_items?: { name: string } | null;
}

export interface Reservation {
  id: string;
  equipment_capacity_id: string;
  quantity: number;
  status: string;
}

export interface StatusHistoryRow {
  id: number;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  created_at: string;
}

export interface WorkspaceData {
  lines: CommercialLine[];
  quotes: Quote[];
  staff: StaffMember[];
  assignments: Assignment[];
  capacities: Capacity[];
  reservations: Reservation[];
  history: StatusHistoryRow[];
  readiness: EventReadiness;
}

// ---------------------------------------------------------------------------
// Query keys (single source of truth for this feature's cache identity)
// ---------------------------------------------------------------------------

export const eventKeys = {
  list: (orgId: string | null) => ["events", orgId] as const,
  detail: (orgId: string | null, eventId: string) =>
    ["event", orgId, eventId] as const,
  readiness: (orgId: string | null, eventId: string) =>
    ["event-readiness", orgId, eventId] as const,
  workspace: (orgId: string | null, eventId: string, cost: boolean) =>
    ["event-workspace", orgId, eventId, cost] as const,
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface EventList {
  /** Rows on the current page (capped by PostgREST `max_rows`). */
  rows: EventRow[];
  /** Exact organization total, or null when the count is unavailable. */
  total: number | null;
}

export function useEvents(orgId: string | null) {
  return useQuery({
    queryKey: eventKeys.list(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<EventList> => {
      const { data, error, count } = await db
        .from("events")
        .select("*", { count: "exact" })
        .eq("organization_id", orgId!)
        .order("start_at");
      if (error) throw error;
      return { rows: (data ?? []) as EventRow[], total: count ?? null };
    },
  });
}

/**
 * Paginated events list for the Events screen (defect D21): "load more"
 * pattern with exact totals. The dashboard keeps using `useEvents` so
 * today's-events filtering is never silently capped by pagination.
 */
export function useEventsPage(orgId: string | null, pageSize = 50) {
  const [size, setSize] = useState(pageSize);
  const query = useQuery({
    queryKey: ["events-page", orgId, size],
    enabled: !!orgId,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<EventList> => {
      const { data, error, count } = await db
        .from("events")
        .select("*", { count: "exact" })
        .eq("organization_id", orgId!)
        .order("start_at")
        .range(0, size - 1);
      if (error) throw error;
      return { rows: (data ?? []) as EventRow[], total: count ?? null };
    },
  });
  const loaded = query.data?.rows.length ?? 0;
  const total = query.data?.total ?? null;
  const hasMore = typeof total === "number" && loaded < total;
  return {
    ...query,
    hasMore,
    loadMore: () => setSize((current) => current + pageSize),
  };
}

export function useEvent(orgId: string | null, id: string) {
  return useQuery({
    queryKey: eventKeys.detail(orgId, id),
    enabled: !!orgId && !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from("events")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as EventRow;
    },
  });
}

/** Shared query definition for event_readiness (used per-event and in lists). */
export function eventReadinessQuery(orgId: string | null, eventId: string) {
  return {
    queryKey: eventKeys.readiness(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () =>
      callRpc<EventReadiness>("event_readiness", {
        p_org_id: orgId,
        p_event_id: eventId,
      }),
  };
}

/**
 * The workspace aggregate: everything the Event workspace needs in one
 * parallel round trip. Cost-gated views are selected by `cost` so a
 * cost-blind role never even requests the valued projections.
 */
export function useWorkspaceData(
  orgId: string | null,
  eventId: string,
  cost: boolean,
) {
  return useQuery({
    queryKey: eventKeys.workspace(orgId, eventId, cost),
    enabled: !!orgId,
    queryFn: async (): Promise<WorkspaceData> => {
      const lineTable = cost
        ? "event_commercial_lines"
        : "event_commercial_lines_operational";
      const quoteTable = cost ? "quotations" : "quotations_customer";
      const staffTable = cost ? "staff_members" : "staff_members_operational";
      const assignmentTable = cost
        ? "event_staff_assignments"
        : "event_staff_assignments_operational";

      const [
        lines,
        quotes,
        staff,
        assignments,
        capacities,
        reservations,
        history,
        readiness,
      ] = await Promise.all([
        db.from(lineTable).select("*").eq("event_id", eventId).order("sort_order"),
        db
          .from(quoteTable)
          .select("*")
          .eq("event_id", eventId)
          .order("revision", { ascending: false }),
        db
          .from(staffTable)
          .select("*")
          .eq("organization_id", orgId!)
          .eq("is_active", true),
        db.from(assignmentTable).select("*").eq("event_id", eventId),
        db
          .from("equipment_capacity")
          .select("*, catalog_items(name)")
          .eq("organization_id", orgId!)
          .eq("is_active", true),
        db.from("event_equipment_reservations").select("*").eq("event_id", eventId),
        db
          .from("event_status_history")
          .select("*")
          .eq("event_id", eventId)
          .order("created_at", { ascending: false }),
        db.rpc("event_readiness", { p_org_id: orgId, p_event_id: eventId }),
      ]);

      for (const result of [
        lines,
        quotes,
        staff,
        assignments,
        capacities,
        reservations,
        history,
        readiness,
      ]) {
        if (result.error) throw result.error;
      }

      return {
        lines: lines.data as CommercialLine[],
        quotes: quotes.data as Quote[],
        staff: staff.data as StaffMember[],
        assignments: assignments.data as Assignment[],
        capacities: capacities.data as Capacity[],
        reservations: reservations.data as Reservation[],
        history: history.data as StatusHistoryRow[],
        readiness: readiness.data as EventReadiness,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  customerId: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  guestCount: number;
  venue: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  /**
   * Stable for one dialog session (see useStableIdempotencyKey) so a retry
   * after a lost response replays the same server command instead of
   * creating a duplicate event.
   */
  idempotencyKey: string;
}

export function useCreateEvent(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateEventInput) =>
      callRpc<EventRow>("create_event", {
        p_org_id: orgId,
        p_customer_id: v.customerId,
        p_title: v.title,
        p_event_type: v.eventType,
        p_start_at: new Date(v.startAt).toISOString(),
        p_end_at: new Date(v.endAt).toISOString(),
        p_guest_count: v.guestCount,
        p_venue_name: v.venue,
        p_contact_name: v.contactName || null,
        p_contact_phone: v.contactPhone || null,
        p_notes: v.notes || null,
        p_idempotency_key: v.idempotencyKey,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.list(orgId) });
      void queryClient.invalidateQueries({ queryKey: ["events-page", orgId] });
    },
  });
}

export interface EventCommandInput {
  name: string;
  args: Record<string, unknown>;
  includeEvent?: boolean;
}

/**
 * Generic workspace command (assign staff, reserve equipment, transition
 * status, …). On success every read model a command can change is refreshed:
 *
 * - the workspace aggregate (all `cost` variants — prefix invalidation),
 * - the event row and the events list (status transitions),
 * - the STANDALONE readiness key: the operational dashboard reads readiness
 *   through `eventReadinessQuery`, not through the workspace aggregate, so
 *   omitting it left the Home screen showing stale readiness after a staff
 *   assignment or equipment reservation made in the workspace.
 * - event finance: `event_finance_summaries` derives accepted_revenue /
 *   expected_cost / outstanding_balance / gross_margin from
 *   `events.accepted_quotation_id` and event_status from `events.status`
 *   (migration 0037). `accept_event_quotation`, `cancel_event` and
 *   `transition_event_status` change those inputs, so the finance read model
 *   must be refreshed or the payments tab — and the invoice panel, which
 *   issues at the accepted revenue — keeps a stale figure.
 */
export function useEventCommand(orgId: string | null, eventId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["event-workspace", orgId, eventId],
    });
    void queryClient.invalidateQueries({
      queryKey: eventKeys.detail(orgId, eventId),
    });
    void queryClient.invalidateQueries({ queryKey: eventKeys.list(orgId) });
    void queryClient.invalidateQueries({ queryKey: ["events-page", orgId] });
    void queryClient.invalidateQueries({
      queryKey: eventKeys.readiness(orgId, eventId),
    });
    void queryClient.invalidateQueries({
      queryKey: ["event-finance", orgId, eventId],
    });
  };
  return useMutation({
    mutationFn: ({ name, args, includeEvent = true }: EventCommandInput) =>
      callRpc(name, {
        p_org_id: orgId,
        ...(includeEvent ? { p_event_id: eventId } : {}),
        ...args,
      }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Audit trail for the workspace history tab (defect D31). audit_events is
// readable by OWNER/MANAGER only, so the query is enabled exclusively for
// commercial roles to avoid a guaranteed RLS error for other roles.
// ---------------------------------------------------------------------------

export interface EventAuditRow {
  id: number;
  action: string;
  entity: string;
  entity_id: string;
  created_at: string;
}

export function useEventAudit(
  orgId: string | null,
  eventId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["event-audit", orgId, eventId],
    enabled: !!orgId && enabled,
    queryFn: async (): Promise<EventAuditRow[]> => {
      const { data, error } = await db
        .from("audit_events")
        .select("id, action, entity, entity_id, created_at")
        .eq("organization_id", orgId!)
        .eq("entity_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EventAuditRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// Event logistics editing (defect F12)
// ---------------------------------------------------------------------------

export interface UpdateEventInput {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  guestCount: number;
  venue: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

/**
 * Edits event logistics through the role-checked RLS UPDATE policy added in
 * migration 0057 (OWNER/MANAGER/SUPERVISOR; only while status is
 * DRAFT/QUOTED). Status transitions stay server-command-only, so this path
 * can never move an event between states.
 */
export function useUpdateEvent(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: UpdateEventInput) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const { error } = await db
        .from("events")
        .update({
          title: v.title.trim(),
          event_type: v.eventType.trim() || "OTHER",
          start_at: new Date(v.startAt).toISOString(),
          end_at: new Date(v.endAt).toISOString(),
          guest_count: v.guestCount,
          venue_name: v.venue.trim(),
          contact_name: v.contactName.trim() || null,
          contact_phone: v.contactPhone.trim() || null,
          notes: v.notes.trim() || null,
        })
        .eq("organization_id", orgId)
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: (_data, v) => {
      void queryClient.invalidateQueries({
        queryKey: eventKeys.detail(orgId, v.id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["event-workspace", orgId, v.id],
      });
      void queryClient.invalidateQueries({ queryKey: eventKeys.list(orgId) });
    void queryClient.invalidateQueries({ queryKey: ["events-page", orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function arabicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const entries: ReadonlyArray<readonly [string, string]> = [
    ["STAFF_CONFLICT", "الموظف مرتبط بمناسبة أخرى في هذا الوقت"],
    ["EQUIPMENT_SHORTAGE", "الكمية المطلوبة غير متاحة في هذا الوقت"],
    ["EVENT_PRICING_LOCKED", "تم اعتماد العرض ولا يمكن تعديل التسعير"],
    ["INVALID_EVENT_WINDOW", "تاريخ النهاية يجب أن يكون بعد البداية"],
    ["valid_window", "تاريخ النهاية يجب أن يكون بعد البداية"],
    ["INVALID_GUEST_COUNT", "عدد الضيوف يجب أن يكون واحداً على الأقل"],
    ["guest_count", "عدد الضيوف يجب أن يكون واحداً على الأقل"],
    ["CUSTOMER_NOT_IN_ORG", "العميل غير موجود في منشأتك أو غير نشط"],
    ["CANCELLATION_REASON_REQUIRED", "اكتب سبب الإلغاء بوضوح قبل المتابعة"],
    ["EVENT_CANNOT_BE_CANCELLED", "لا يمكن إلغاء المناسبة في حالتها الحالية"],
    ["EVENT_NOT_FOUND", "المناسبة غير موجودة"],
    ["EVENT_NOT_EDITABLE", "لا يمكن تعديل المناسبة في حالتها الحالية"],
    // RLS policy violations surface as a generic PostgREST message; the edit
    // policy's with-check is the only write path that produces this text.
    ["row-level security", "لا يمكن تعديل المناسبة في حالتها الحالية"],
    ["EVENT_NOT_PAYABLE", "هذه المناسبة لا تقبل الدفعات حالياً"],
    [
      "PAYMENT_REQUIRES_ACCEPTED_QUOTATION",
      "لا يمكن تسجيل دفعة قبل اعتماد عرض سعر لهذه المناسبة",
    ],
    [
      "RESERVATION_HAS_OUTSTANDING_EQUIPMENT",
      "لا يمكن تحرير الحجز ومعدات ما زالت في الخارج",
    ],
    ["CONSUMABLE_STOCK_SHORTAGE", "رصيد المادة لا يكفي لهذه الكمية"],
    ["INVALID_COMMERCIAL_VALUE", "الكمية أو السعر المدخل غير صالح"],
    ["QUOTE_NOT_ALLOWED", "لا يمكن التسعير في الحالة الحالية للمناسبة"],
    ["EMPTY_QUOTATION", "أضف خدمة واحدة على الأقل قبل إصدار العرض"],
    ["INVALID_EVENT_TRANSITION", "لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية"],
    ["USE_CANCEL_EVENT", "استخدم إلغاء المناسبة بدلاً من هذا الانتقال"],
    [
      "WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE",
      "لا يمكن الإغلاق ومعدات ما زالت في الخارج — أكمل إرجاعها أولاً",
    ],
    [
      "CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE",
      "لا يمكن الإغلاق ومواد ما زالت بعهدة المناسبة — سجّل استهلاكها أو إرجاعها أولاً",
    ],
    ["NOT_AUTHORIZED", "غير مصرح لك بهذا الإجراء"],
  ];
  for (const [needle, arabic] of entries) {
    if (message.includes(needle)) return arabic;
  }
  return "حدث خطأ غير متوقع في هذه العملية. أعد المحاولة.";
}
