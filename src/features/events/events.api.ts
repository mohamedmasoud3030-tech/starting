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

export function useEvents(orgId: string | null) {
  return useQuery({
    queryKey: eventKeys.list(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("events")
        .select("*")
        .eq("organization_id", orgId!)
        .order("start_at");
      if (error) throw error;
      return data as EventRow[];
    },
  });
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

export function useEventReadiness(orgId: string | null, eventId: string) {
  return useQuery(eventReadinessQuery(orgId, eventId));
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
          .select("*")
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
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: eventKeys.list(orgId) }),
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
    void queryClient.invalidateQueries({
      queryKey: eventKeys.readiness(orgId, eventId),
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
// Errors
// ---------------------------------------------------------------------------

export function arabicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("STAFF_CONFLICT"))
    return "الموظف مرتبط بمناسبة أخرى في هذا الوقت";
  if (message.includes("EQUIPMENT_SHORTAGE"))
    return "الكمية المطلوبة غير متاحة في هذا الوقت";
  if (message.includes("EVENT_PRICING_LOCKED"))
    return "تم اعتماد العرض ولا يمكن تعديل التسعير";
  return message;
}
