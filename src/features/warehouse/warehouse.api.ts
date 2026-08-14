/**
 * Warehouse data access.
 *
 * OPTIONAL TEXT PARAMETERS
 * ------------------------
 * The RPC text parameters (reference / notes / condition notes) are declared
 * without a SQL DEFAULT, so the generated `Args` type declares them as
 * non-nullable `string`. That is the real generated boundary and is used as-is
 * rather than being widened by hand. Passing an empty string is equivalent to
 * passing NULL: every command normalizes with `nullif(trim(coalesce(x,'')),'')`
 * BEFORE both persistence and idempotency fingerprinting, so "" and NULL
 * produce byte-identical stored rows and identical fingerprints.
 *
 * Every write goes through a server-authoritative RPC; there is no client
 * table mutation path (the database grants SELECT only on the ledger). Each
 * command carries a client-generated idempotency key so a retry — a flaky
 * warehouse Wi-Fi connection, a double tap on a phone — can never create a
 * second physical movement.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FunctionArgs } from "@/lib/dbTypes";
import {
  parseWarehouseLine,
  type WarehouseLine,
  type WarehouseLineDefect,
  type WarehouseLineRow,
  type WarehouseSummary,
  type WarehouseValuedRow,
} from "./warehouse.model";

export interface WarehouseData {
  lines: WarehouseLine[];
  /** Rows the read model could not fully establish; surfaced, never hidden. */
  defects: WarehouseLineDefect[];
  summary: WarehouseSummary;
}

export function warehouseQueryKey(eventId: string, canReadCost: boolean) {
  return ["event-warehouse", eventId, canReadCost] as const;
}

/**
 * Load the operator view of an Event's warehouse state.
 *
 * `canReadCost` selects whether the cost-gated valued projection is joined in.
 * It is a UI hint only: a WAREHOUSE user who forced it to true would still
 * receive zero rows, because the view itself is gated by can_read_cost().
 */
export function useEventWarehouse(
  orgId: string | null,
  eventId: string,
  canReadCost: boolean,
) {
  return useQuery({
    queryKey: warehouseQueryKey(eventId, canReadCost),
    enabled: !!orgId && !!eventId,
    queryFn: async (): Promise<WarehouseData> => {
      const [linesResult, summaryResult, valuedResult] = await Promise.all([
        supabase
          .from("event_warehouse_lines")
          .select("*")
          .eq("organization_id", orgId!)
          .eq("event_id", eventId),
        supabase.rpc("event_warehouse_summary", {
          p_org_id: orgId!,
          p_event_id: eventId,
        }),
        canReadCost
          ? supabase
              .from("event_warehouse_lines_valued")
              .select("*")
              .eq("organization_id", orgId!)
              .eq("event_id", eventId)
          : Promise.resolve({ data: [] as WarehouseValuedRow[], error: null }),
      ]);

      if (linesResult.error) throw linesResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (valuedResult.error) throw valuedResult.error;

      const valuedByReservation = new Map<string, WarehouseValuedRow>();
      for (const row of (valuedResult.data ?? []) as WarehouseValuedRow[]) {
        if (row.reservation_id !== null) {
          valuedByReservation.set(row.reservation_id, row);
        }
      }

      const lines: WarehouseLine[] = [];
      const defects: WarehouseLineDefect[] = [];
      for (const row of (linesResult.data ?? []) as WarehouseLineRow[]) {
        const parsed = parseWarehouseLine(
          row,
          row.reservation_id
            ? (valuedByReservation.get(row.reservation_id) ?? null)
            : null,
        );
        if (parsed.ok) lines.push(parsed.line);
        else defects.push(parsed.defect);
      }
      lines.sort((a, b) => a.equipmentName.localeCompare(b.equipmentName, "ar"));

      return {
        lines,
        defects,
        summary: summaryResult.data as unknown as WarehouseSummary,
      };
    },
  });
}

/** Invalidate every query whose data a warehouse movement can change. */
function useWarehouseInvalidation(orgId: string | null, eventId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["event-warehouse", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["event-workspace", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["events", orgId] });
  };
}

export interface DispatchInput {
  reservationId: string;
  quantity: number;
  reference: string;
  notes: string;
  /** Stable across retries of the SAME user intent. */
  idempotencyKey: string;
}

export function useDispatchEquipment(orgId: string | null, eventId: string) {
  const invalidate = useWarehouseInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: DispatchInput) => {
      const args: FunctionArgs<"dispatch_event_equipment"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_reservation_id: input.reservationId,
        p_quantity: input.quantity,
        p_reference: input.reference.trim(),
        p_notes: input.notes.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("dispatch_event_equipment", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface ReturnInput {
  reservationId: string;
  good: number;
  damaged: number;
  lost: number;
  reference: string;
  conditionNotes: string;
  idempotencyKey: string;
}

export function useReturnEquipment(orgId: string | null, eventId: string) {
  const invalidate = useWarehouseInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: ReturnInput) => {
      const args: FunctionArgs<"return_event_equipment"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_reservation_id: input.reservationId,
        p_returned_good_quantity: input.good,
        p_damaged_quantity: input.damaged,
        p_lost_quantity: input.lost,
        p_reference: input.reference.trim(),
        p_condition_notes: input.conditionNotes.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("return_event_equipment", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface ReconcileInput {
  notes: string;
  idempotencyKey: string;
}

export function useReconcileWarehouse(orgId: string | null, eventId: string) {
  const invalidate = useWarehouseInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: ReconcileInput) => {
      const args: FunctionArgs<"reconcile_event_warehouse"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_notes: input.notes.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("reconcile_event_warehouse", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}
