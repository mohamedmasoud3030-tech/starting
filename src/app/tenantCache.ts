import type { QueryClient } from "@tanstack/react-query";

/**
 * Tenant/identity cache isolation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The TanStack Query cache lives for the lifetime of the browser tab, while the
 * signed-in identity does not. Without an explicit reset, cached rows fetched
 * as identity A remain readable — and renderable — after the app switches to
 * identity B in the same tab (sign out then sign in as a user of a different
 * tenant, or switch the active organization).
 *
 * RLS still protects the database: identity B could never *fetch* A's rows.
 * This is a presentation-layer isolation defect, but tenant isolation must hold
 * at every layer, so the cache is cleared whenever the effective identity
 * changes.
 *
 * Query keys are additionally organization-scoped (see `warehouseQueryKey`,
 * `eventConsumablesQueryKey`, `useEvent`, `useWorkspaceData`). The two
 * mechanisms are deliberately redundant: scoping prevents collisions, clearing
 * prevents a stale tenant's data from lingering in memory at all.
 */

/**
 * A stable string identifying "who is currently looking at the app".
 * `null` user + `null` org (signed out) collapses to a single anonymous key.
 */
export function identityKey(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): string {
  return `${userId ?? "anon"}::${organizationId ?? "none"}`;
}

/**
 * Drop every cached query. Called only when {@link identityKey} changes.
 *
 * `clear()` (not `invalidateQueries`) is required: invalidation keeps the stale
 * data mounted and merely refetches, which would still expose the previous
 * tenant's rows for a frame.
 */
export function resetTenantCache(queryClient: QueryClient): void {
  queryClient.clear();
}
