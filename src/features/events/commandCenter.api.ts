import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { OperationalReadiness } from "./operationalReadiness";
import type { NextActionCode } from "./operationalReadiness";

/**
 * Event Command Center read model (server projection, 0082).
 *
 * ONE round trip for the whole overview screen: canonical operational
 * readiness (with reasons), per-dimension detail rows, attendance progress,
 * document states, the SEPARATE commercial block and the server-chosen next
 * action. The frontend renders this payload — it does not recompute which
 * dimension is missing anything, and it never fans out dozens of per-widget
 * queries to answer one question.
 *
 * Privacy: `commercial.value_milli/collected_milli/outstanding_milli` are
 * present ONLY for callers allowed to read event money (server-enforced);
 * everyone with event access still gets `commercial.attention` (a boolean) so
 * the operator knows follow-up is needed without the office's finances being
 * disclosed. Profitability/margin never appear in this projection at all.
 */

export interface CommandCenter {
  operational: OperationalReadiness & {
    /** per REUSABLE_EQUIPMENT line that is short — actionable rows. */
    equipment_lines: {
      label: string;
      required: number;
      reserved: number;
      missing: number;
    }[];
    /** per CONSUMABLE line whose event-issue quantity does not cover the need. */
    consumable_lines: {
      label: string;
      required: number;
      prepared: number;
      missing: number;
      unit: string;
    }[];
    /** issued-but-unreceived procurement orders this event depends on. */
    procurement_orders: {
      order_number: string;
      supplier_name: string;
      order_status: string;
    }[];
  };
  attendance: {
    assigned: number;
    checked_in: number;
    checked_out: number;
    /** assigned staff still inside (no confirmed checkout). */
    pending_confirmations: number;
  };
  documents: {
    quotation_status: string | null;
    invoice_status: string | null;
    warehouse_sheet_lines: number;
    team_sheet_rows: number;
  };
  commercial: {
    attention: boolean;
    has_accepted_quotation: boolean;
    /** exact decimal strings (PostgREST numeric-as-text), milli-OMR after parse. */
    value: string | null;
    collected: string | null;
    outstanding: string | null;
  };
  next_action: { code: NextActionCode; label: string } | null;
}

export function commandCenterQueryKey(orgId: string | null, eventId: string) {
  return ["event-command-center", orgId, eventId] as const;
}

export function useEventCommandCenter(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: commandCenterQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_command_center", {
        p_org_id: orgId!,
        p_event_id: eventId,
      });
      if (error) throw error;
      return (data ?? null) as CommandCenter | null;
    },
  });
}
