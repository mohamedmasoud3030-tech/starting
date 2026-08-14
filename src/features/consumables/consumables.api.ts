/**
 * Consumable inventory data access (S4B).
 *
 * Every write goes through a server-authoritative RPC; there is no client
 * table mutation path (the database grants SELECT only on the ledger). Each
 * command carries a client-generated idempotency key so a retry — flaky
 * warehouse Wi-Fi, a double tap on a phone — can never create a second
 * physical movement.
 *
 * EXACT QUANTITIES ON THE WIRE
 * ----------------------------
 * The generated Args declare `p_quantity: number` (PostgREST transports
 * numeric as a JSON number). Quantities are converted from exact integer
 * milli-units through `toDbNumeric`, which PROVES the round trip is lossless
 * within the 3-decimal domain before sending; PostgreSQL re-parses into exact
 * numeric on arrival, so the double is transport only, never arithmetic.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FunctionArgs } from "@/lib/dbTypes";
import { toDbNumeric } from "@/lib/money";
import {
  parseConsumableSummary,
  parseEventConsumableLine,
  parseStockLine,
  type ConsumableSummary,
  type EventConsumableLine,
  type EventConsumableLineRow,
  type EventLineDefect,
  type QuantityMilli,
  type StockLine,
  type StockLineDefect,
  type StockSummaryRow,
} from "./consumables.model";

// ---------------------------------------------------------------------------
// Central stock screen
// ---------------------------------------------------------------------------

export interface StockData {
  lines: StockLine[];
  /** Rows the read model could not fully establish; surfaced, never hidden. */
  defects: StockLineDefect[];
}

export function stockQueryKey(orgId: string | null) {
  return ["consumable-stock", orgId] as const;
}

export function useConsumableStock(orgId: string | null) {
  return useQuery({
    queryKey: stockQueryKey(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<StockData> => {
      const { data, error } = await supabase
        .from("consumable_stock_summary")
        .select("*")
        .eq("organization_id", orgId!);
      if (error) throw error;

      const lines: StockLine[] = [];
      const defects: StockLineDefect[] = [];
      for (const row of (data ?? []) as StockSummaryRow[]) {
        const parsed = parseStockLine(row);
        if (parsed.ok) lines.push(parsed.line);
        else defects.push(parsed.defect);
      }
      lines.sort((a, b) => a.itemName.localeCompare(b.itemName, "ar"));
      return { lines, defects };
    },
  });
}

/** Active CONSUMABLE catalog items not yet stock-tracked (for activation). */
export function useUntrackedConsumables(orgId: string | null) {
  return useQuery({
    queryKey: ["consumable-untracked", orgId] as const,
    enabled: !!orgId,
    queryFn: async () => {
      const [catalogResult, trackedResult] = await Promise.all([
        supabase
          .from("catalog_items_operational")
          .select("id,name,unit")
          .eq("organization_id", orgId!)
          .eq("item_type", "CONSUMABLE")
          .eq("status", "ACTIVE"),
        supabase
          .from("consumable_stock_items")
          .select("catalog_item_id")
          .eq("organization_id", orgId!),
      ]);
      if (catalogResult.error) throw catalogResult.error;
      if (trackedResult.error) throw trackedResult.error;
      const tracked = new Set(
        (trackedResult.data ?? []).map((r) => r.catalog_item_id),
      );
      return (catalogResult.data ?? [])
        .filter((c) => c.id !== null && !tracked.has(c.id))
        .map((c) => ({
          id: c.id as string,
          name: c.name ?? "",
          unit: c.unit ?? "",
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    },
  });
}

function useStockInvalidation(orgId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["consumable-stock", orgId] });
    void queryClient.invalidateQueries({ queryKey: ["consumable-untracked", orgId] });
  };
}

// ---------------------------------------------------------------------------
// Stock-policy + warehouse commands
// ---------------------------------------------------------------------------

export interface SaveStockItemInput {
  catalogItemId: string;
  minimumMilli: QuantityMilli;
  isTrackingActive: boolean;
}

export function useSaveStockItem(orgId: string | null) {
  const invalidate = useStockInvalidation(orgId);
  return useMutation({
    mutationFn: async (input: SaveStockItemInput) => {
      const args: FunctionArgs<"save_consumable_stock_item"> = {
        p_org_id: orgId!,
        p_catalog_item_id: input.catalogItemId,
        p_minimum_stock_quantity: toDbNumeric(input.minimumMilli),
        p_is_tracking_active: input.isTrackingActive,
      };
      const { data, error } = await supabase.rpc("save_consumable_stock_item", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface ReceiveInput {
  stockItemId: string;
  quantityMilli: QuantityMilli;
  reference: string;
  /** Stable across retries of the SAME user intent. */
  idempotencyKey: string;
}

export function useReceiveStock(orgId: string | null) {
  const invalidate = useStockInvalidation(orgId);
  return useMutation({
    mutationFn: async (input: ReceiveInput) => {
      const args: FunctionArgs<"receive_consumable_stock"> = {
        p_org_id: orgId!,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reference: input.reference.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("receive_consumable_stock", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface WarehouseWasteInput {
  stockItemId: string;
  quantityMilli: QuantityMilli;
  reason: string;
  idempotencyKey: string;
}

export function useWasteStock(orgId: string | null) {
  const invalidate = useStockInvalidation(orgId);
  return useMutation({
    mutationFn: async (input: WarehouseWasteInput) => {
      const args: FunctionArgs<"waste_consumable_stock"> = {
        p_org_id: orgId!,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reason: input.reason.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("waste_consumable_stock", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface AdjustInput {
  stockItemId: string;
  /** Signed exact correction delta. */
  quantityMilli: QuantityMilli;
  reason: string;
  idempotencyKey: string;
}

export function useAdjustStock(orgId: string | null) {
  const invalidate = useStockInvalidation(orgId);
  return useMutation({
    mutationFn: async (input: AdjustInput) => {
      const args: FunctionArgs<"adjust_consumable_stock"> = {
        p_org_id: orgId!,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reason: input.reason.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("adjust_consumable_stock", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Event consumable state
// ---------------------------------------------------------------------------

export interface EventConsumableData {
  lines: EventConsumableLine[];
  defects: EventLineDefect[];
  summary: ConsumableSummary | null;
}

export function eventConsumablesQueryKey(eventId: string) {
  return ["event-consumables", eventId] as const;
}

export function useEventConsumables(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: eventConsumablesQueryKey(eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async (): Promise<EventConsumableData> => {
      const [linesResult, summaryResult] = await Promise.all([
        supabase
          .from("event_consumable_lines")
          .select("*")
          .eq("organization_id", orgId!)
          .eq("event_id", eventId),
        supabase.rpc("event_consumable_summary", {
          p_org_id: orgId!,
          p_event_id: eventId,
        }),
      ]);
      if (linesResult.error) throw linesResult.error;
      if (summaryResult.error) throw summaryResult.error;

      const lines: EventConsumableLine[] = [];
      const defects: EventLineDefect[] = [];
      for (const row of (linesResult.data ?? []) as EventConsumableLineRow[]) {
        const parsed = parseEventConsumableLine(row);
        if (parsed.ok) lines.push(parsed.line);
        else defects.push(parsed.defect);
      }
      lines.sort((a, b) => a.itemName.localeCompare(b.itemName, "ar"));

      return {
        lines,
        defects,
        summary: parseConsumableSummary(summaryResult.data),
      };
    },
  });
}

function useEventConsumableInvalidation(orgId: string | null, eventId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["event-consumables", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["consumable-stock", orgId] });
  };
}

export interface IssueInput {
  stockItemId: string;
  quantityMilli: QuantityMilli;
  reference: string;
  idempotencyKey: string;
}

export function useIssueToEvent(orgId: string | null, eventId: string) {
  const invalidate = useEventConsumableInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: IssueInput) => {
      const args: FunctionArgs<"issue_consumable_to_event"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reference: input.reference.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("issue_consumable_to_event", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface CustodyMovementInput {
  stockItemId: string;
  quantityMilli: QuantityMilli;
  /** Reference for returns/consumption; reason for waste. */
  note: string;
  idempotencyKey: string;
}

export function useReturnFromEvent(orgId: string | null, eventId: string) {
  const invalidate = useEventConsumableInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: CustodyMovementInput) => {
      const args: FunctionArgs<"return_consumable_from_event"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reference: input.note.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("return_consumable_from_event", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useConsumeAtEvent(orgId: string | null, eventId: string) {
  const invalidate = useEventConsumableInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: CustodyMovementInput) => {
      const args: FunctionArgs<"consume_consumable_at_event"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reference: input.note.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("consume_consumable_at_event", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useWasteAtEvent(orgId: string | null, eventId: string) {
  const invalidate = useEventConsumableInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: CustodyMovementInput) => {
      const args: FunctionArgs<"waste_consumable_at_event"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_stock_item_id: input.stockItemId,
        p_quantity: toDbNumeric(input.quantityMilli),
        p_reason: input.note.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("waste_consumable_at_event", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export interface ReconcileConsumablesInput {
  notes: string;
  idempotencyKey: string;
}

export function useReconcileConsumables(orgId: string | null, eventId: string) {
  const invalidate = useEventConsumableInvalidation(orgId, eventId);
  return useMutation({
    mutationFn: async (input: ReconcileConsumablesInput) => {
      const args: FunctionArgs<"reconcile_event_consumables"> = {
        p_org_id: orgId!,
        p_event_id: eventId,
        p_notes: input.notes.trim(),
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc("reconcile_event_consumables", args);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}
