import type {
  AssistantCapabilityProfile,
  AssistantContextPayload,
} from "./assistant-types";

/**
 * Gathers the read-only operations snapshot the assistant needs.
 *
 * Every figure comes straight from the existing server-authoritative RPC
 * views (`management_metrics`, `management_alerts`, `today_collections`).
 * This file performs NO client-side aggregation and NO organization
 * scoping: each call is already scoped by `p_org_id` and protected by RLS
 * inside the database, so a caller only ever sees what their role allows.
 *
 * Each section is fetched independently and fail-soft: if any single RPC is
 * unavailable or the caller lacks the underlying capability, that section
 * is omitted rather than failing the whole request. The model is then told
 * what is present (and what is not) and stays grounded in the facts only.
 */

export interface BuildOperationsContextInput {
  orgId: string;
  orgName: string;
  roleLabel: string;
  capabilities: AssistantCapabilityProfile;
  surface: string | null;
  /** Injected RPC boundary (defaults to `supabase.rpc`). */
  callRpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** Two-week window is enough for an operations recap; cheap and focused. */
const METRICS_WINDOW_DAYS = 14;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value.length > 0) {
    const row = value[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** @internal Used by tests; the public entry is `buildOperationsContext`. */
export async function fetchMetrics(
  callRpc: BuildOperationsContextInput["callRpc"],
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const value = await callRpc("management_metrics", {
    p_org_id: orgId,
    p_from: isoDaysAgo(METRICS_WINDOW_DAYS),
    p_to: new Date().toISOString(),
  });
  return firstRow(value);
}

/** @internal */
export async function fetchAlerts(
  callRpc: BuildOperationsContextInput["callRpc"],
  orgId: string,
): Promise<unknown[] | null> {
  const value = await callRpc("management_alerts", {
    p_org_id: orgId,
    p_limit: 12,
  });
  return Array.isArray(value) ? value : null;
}

/** @internal */
export async function fetchToday(
  callRpc: BuildOperationsContextInput["callRpc"],
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const value = await callRpc("today_collections", {
    p_org_id: orgId,
  });
  const rows = Array.isArray(value) ? value : null;
  return rows && rows.length > 0 ? { rows } : null;
}

/**
 * Build the context payload. Called before every assistant request so the
 * snapshot always reflects the current organization and the caller's role.
 */
export async function buildOperationsContext(
  input: BuildOperationsContextInput,
): Promise<AssistantContextPayload> {
  const base: AssistantContextPayload = {
    orgId: input.orgId,
    orgName: input.orgName,
    roleLabel: input.roleLabel,
    capabilities: input.capabilities,
    metrics: null,
    alerts: null,
    today: null,
    surface: input.surface,
  };

  const [metrics, alerts, today] = await Promise.allSettled([
    fetchMetrics(input.callRpc, input.orgId),
    fetchAlerts(input.callRpc, input.orgId),
    fetchToday(input.callRpc, input.orgId),
  ]);

  if (metrics.status === "fulfilled") base.metrics = metrics.value;
  if (alerts.status === "fulfilled") base.alerts = alerts.value;
  if (today.status === "fulfilled") base.today = today.value;

  return base;
}
