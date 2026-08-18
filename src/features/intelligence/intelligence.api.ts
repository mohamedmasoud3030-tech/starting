import { useQuery } from "@tanstack/react-query";
import type { FunctionArgs } from "@/lib/dbTypes";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import { fromDbAmount } from "@/lib/money";

/**
 * Intelligence data layer. Every management figure comes from the canonical
 * SQL functions (migrations 0070-0072); this file only binds them to React
 * Query. No aggregation, no finance math, and no organization scoping is done
 * client-side.
 */

// ---------------------------------------------------------------------------
// Alerts (E2/E3)
// ---------------------------------------------------------------------------

export interface ManagementAlert {
  alert_type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  entity_type: string;
  entity_id: string;
  title: string;
  explanation: string;
  destination: string;
  event_id: string | null;
  customer_id: string | null;
  detected_at: string;
}

export function useManagementAlerts(orgId: string | null) {
  return useQuery({
    queryKey: ["management-alerts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("management_alerts", {
        p_org_id: orgId!,
      });
      if (error) throw error;
      return (data ?? []) as ManagementAlert[];
    },
  });
}

// ---------------------------------------------------------------------------
// Management metrics (E1)
// ---------------------------------------------------------------------------

export interface ManagementMetrics {
  events_today: number;
  events_tomorrow: number;
  events_week: number;
  confirmed_upcoming: number;
  events_preparing: number;
  events_in_progress: number;
  events_waiting_return: number;
  events_low_readiness: number;
  quotes_draft: number;
  quotes_waiting: number;
  quotes_accepted: number;
  quotes_expired: number;
  quotes_rejected: number;
  quote_conversion_rate: number | null;
  avg_quote_value: number | null;
  top_packages: Array<{ name: string; count: number }>;
  revenue: number | null;
  collected: number | null;
  outstanding: number | null;
  actual_cost: number | null;
  gross_profit: number | null;
  margin_percent: number | null;
  financially_open_completed: number;
  overdue_balance: number | null;
  ready_to_close: number;
  close_blocked: number;
}

export function useManagementMetrics(
  orgId: string | null,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: ["management-metrics", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("management_metrics", {
        p_org_id: orgId!,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      const row = ((data ?? [])[0] ?? {}) as Record<string, unknown>;
      return {
        events_today: row.events_today as number,
        events_tomorrow: row.events_tomorrow as number,
        events_week: row.events_week as number,
        confirmed_upcoming: row.confirmed_upcoming as number,
        events_preparing: row.events_preparing as number,
        events_in_progress: row.events_in_progress as number,
        events_waiting_return: row.events_waiting_return as number,
        events_low_readiness: row.events_low_readiness as number,
        quotes_draft: row.quotes_draft as number,
        quotes_waiting: row.quotes_waiting as number,
        quotes_accepted: row.quotes_accepted as number,
        quotes_expired: row.quotes_expired as number,
        quotes_rejected: row.quotes_rejected as number,
        quote_conversion_rate: row.quote_conversion_rate as number | null,
        avg_quote_value: fromDbAmount(row.avg_quote_value as number),
        // The SQL aggregates by string `count` (jsonb); sort numerically here
        // so multi-digit usage counts order correctly.
        top_packages: ((row.top_packages ?? []) as Array<{ name: string; count: number }>)
          .sort((a, b) => b.count - a.count),
        revenue: fromDbAmount(row.revenue as number),
        collected: fromDbAmount(row.collected as number),
        outstanding: fromDbAmount(row.outstanding as number),
        actual_cost: fromDbAmount(row.actual_cost as number),
        gross_profit: fromDbAmount(row.gross_profit as number),
        margin_percent: row.margin_percent as number | null,
        financially_open_completed: row.financially_open_completed as number,
        overdue_balance: fromDbAmount(row.overdue_balance as number),
        ready_to_close: row.ready_to_close as number,
        close_blocked: row.close_blocked as number,
      } satisfies ManagementMetrics;
    },
  });
}

// ---------------------------------------------------------------------------
// Global search (E5)
// ---------------------------------------------------------------------------

export interface SearchResult {
  entity_type: "customer" | "event" | "quote" | "invoice";
  entity_id: string;
  title: string;
  subtitle: string;
  destination: string;
}

export function useGlobalSearch(orgId: string | null, term: string) {
  return useQuery({
    queryKey: ["global-search", orgId, term],
    enabled: !!orgId && term.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("global_search", {
        p_org_id: orgId!,
        p_term: term.trim(),
      });
      if (error) throw error;
      return (data ?? []) as SearchResult[];
    },
  });
}

// ---------------------------------------------------------------------------
// Customer 360 (E4)
// ---------------------------------------------------------------------------

export interface Customer360Row {
  customer_id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  customer_type: string;
  notes: string | null;
  is_active: boolean;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  quotes_count: number;
  accepted_quotes: number;
  rejected_quotes: number;
  events_count: number;
  upcoming_events: number;
  completed_events: number;
  last_event_at: string | null;
  total_commercial_value: number | null;
  total_collected: number | null;
  outstanding: number | null;
  gross_profit: number | null;
  days_since_last_event: number | null;
}

export function useCustomer360(orgId: string | null) {
  return useQuery({
    queryKey: ["customer-360", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_360", {
        p_org_id: orgId!,
      });
      if (error) throw error;
      return (data ?? []) as Customer360Row[];
    },
  });
}

// ---------------------------------------------------------------------------
// Integrity findings (E6)
// ---------------------------------------------------------------------------

export interface IntegrityFinding {
  severity: string;
  category: string;
  finding_code: string;
  problem: string;
  why_it_matters: string;
  entity_type: string;
  entity_id: string;
  destination: string;
}

export function useIntegrityFindings(orgId: string | null) {
  return useQuery({
    queryKey: ["integrity-findings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integrity_findings", {
        p_org_id: orgId!,
      });
      if (error) throw error;
      return (data ?? []) as IntegrityFinding[];
    },
  });
}

// ---------------------------------------------------------------------------
// Reports (E7/E8)
// ---------------------------------------------------------------------------

export interface ReportEventRow {
  event_id: string;
  event_number: string;
  title: string;
  status: string;
  start_at: string;
  guest_count: number;
  revenue: number | null;
  collected: number | null;
  outstanding: number | null;
  actual_cost: number | null;
  gross_profit: number | null;
  margin_percent: number | null;
}

export interface ReportCustomerRow {
  customer_id: string;
  name: string;
  events_count: number;
  total_value: number | null;
  collected: number | null;
  outstanding: number | null;
  actual_cost: number | null;
  gross_profit: number | null;
}

export interface ReportPackageRow {
  package_id: string;
  package_name: string;
  usage_count: number;
  commercial_value: number | null;
  actual_cost: number | null;
  gross_profit: number | null;
  margin_percent: number | null;
}

export function useReportEvents(orgId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["report-events", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => callRpc<ReportEventRow[]>("report_events", { p_org_id: orgId, p_from: from, p_to: to }),
  });
}

export function useReportCustomers(orgId: string | null) {
  return useQuery({
    queryKey: ["report-customers", orgId],
    enabled: !!orgId,
    queryFn: async () => callRpc<ReportCustomerRow[]>("report_customers", { p_org_id: orgId }),
  });
}

export function useReportPackages(orgId: string | null) {
  return useQuery({
    queryKey: ["report-packages", orgId],
    enabled: !!orgId,
    queryFn: async () => callRpc<ReportPackageRow[]>("report_packages", { p_org_id: orgId }),
  });
}

// Time-filter helper (E8) — always Muscat-local day boundaries.
export function muscatDayRange(daysAgo: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const end = new Date(start.getTime() + 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export type TimeFilter = "today" | "week" | "month" | "all";

export function rangeForFilter(filter: TimeFilter): { from: string; to: string } {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  switch (filter) {
    case "today":
      return { from: todayStart.toISOString(), to: to.toISOString() };
    case "week":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)).toISOString(), to: to.toISOString() };
    case "month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: to.toISOString() };
    case "all":
      return { from: new Date(0).toISOString(), to: new Date(Date.now() + 365 * 86400_000).toISOString() };
  }
}

export type { FunctionArgs };
