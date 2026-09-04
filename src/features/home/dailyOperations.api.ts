import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fromDbAmount, formatOMR, type MilliOMR } from "@/lib/money";

/**
 * Daily-operations sections of the Today screen (0082 projections).
 *
 * Both queries are server-gated the same way every other read model is:
 * the caller must hold a money-visible capability, and the server decides —
 * the UI only calls them when its capability mirror says the user can see
 * anything, so an operations-only role never fans out a forbidden request
 * (and never renders another office's figures even if the key leaked).
 *
 * Amounts cross the wire as exact decimal text; milli-OMR numbers are derived
 * ONLY for display through `fromDbAmount` — these projections never re-sum
 * customer money client-side.
 */

export interface TodayCollectionRow {
  event_id: string;
  event_number: string;
  event_title: string;
  customer_name: string;
  start_at: string;
  /** exact decimal text (numeric-as-text transport, never a JS float). */
  outstanding: string;
  overdue: boolean;
}

export interface ClosureCandidateRow {
  event_id: string;
  event_number: string;
  event_title: string;
  start_at: string;
  /** CLOSE_OPS = execute the operational close; CLOSE_FINANCIAL = record the financial closure. */
  action: "CLOSE_OPS" | "CLOSE_FINANCIAL";
  /** Outstanding balance — ONLY for money-visible roles; null otherwise. */
  outstanding: string | null;
}

export function todayCollectionsQueryKey(orgId: string | null, now: string) {
  return ["today-collections", orgId, now] as const;
}

export function useTodayCollections(orgId: string | null, enabled: boolean, nowIso: string) {
  return useQuery({
    queryKey: todayCollectionsQueryKey(orgId, nowIso),
    enabled: !!orgId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("today_collections", {
        p_org_id: orgId!,
        p_now: nowIso,
      });
      if (error) throw error;
      return (data ?? []) as TodayCollectionRow[];
    },
  });
}

export function closureCandidatesQueryKey(orgId: string | null, now: string) {
  return ["closure-candidates", orgId, now] as const;
}

export function useClosureCandidates(orgId: string | null, enabled: boolean, nowIso: string) {
  return useQuery({
    queryKey: closureCandidatesQueryKey(orgId, nowIso),
    enabled: !!orgId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("today_closure_candidates", {
        p_org_id: orgId!,
        p_now: nowIso,
      });
      if (error) throw error;
      return (data ?? []) as ClosureCandidateRow[];
    },
  });
}

/** Milli value for a display line — harmless presentation math only. */
export function outstandingMilliText(outstanding: string | null): string | null {
  if (outstanding === null) return null;
  const milli = fromDbAmount(outstanding) as MilliOMR;
  return formatOMR(milli);
}
