import { useMemo } from "react";
import { useAuth } from "@/app/authContext";
import type { ProcurementDataSource } from "./contracts";
import { createSupabaseProcurementDataSource } from "./supabaseDataSource";
import { useProcurementCacheSync } from "./useProcurementCacheSync";

/**
 * The production procurement data source, decorated with cross-feature cache
 * synchronisation.
 *
 * The procurement feature manages its own reload cycle internally, but its
 * commands change server truth that OTHER features read through TanStack
 * Query (consumable stock after receiving; event finance after lifecycle /
 * receipt on an event-linked order). Decorating here — at the composition
 * seam — keeps the adapter itself pure and keeps components ignorant of
 * caching concerns.
 *
 * Returns null while no organization is active.
 */
export function useProcurementDataSource(): ProcurementDataSource | null {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const sync = useProcurementCacheSync();

  return useMemo(() => {
    if (!orgId) return null;
    const inner = createSupabaseProcurementDataSource(orgId, currentRole);

    const withLifecycleSync =
      (command: (orderId: string, key: string) => ReturnType<typeof inner.approveOrder>) =>
      async (orderId: string, idempotencyKey: string) => {
        const detail = await command(orderId, idempotencyKey);
        sync.orderLifecycleChanged(detail);
        return detail;
      };

    return {
      ...inner,
      approveOrder: withLifecycleSync(inner.approveOrder.bind(inner)),
      sendOrder: withLifecycleSync(inner.sendOrder.bind(inner)),
      confirmOrder: withLifecycleSync(inner.confirmOrder.bind(inner)),
      cancelOrder: async (orderId, reason, idempotencyKey) => {
        const detail = await inner.cancelOrder(orderId, reason, idempotencyKey);
        sync.orderLifecycleChanged(detail);
        return detail;
      },
      recordReceipt: async (input) => {
        const receipt = await inner.recordReceipt(input);
        // The receipt result does not carry the order shape, so resolve the
        // order to learn its event linkage and line kinds. A failure here
        // must not fail the receipt — fall back to broad-but-safe stock
        // invalidation.
        try {
          const order = await inner.getOrder(input.orderId);
          sync.receiptRecorded(order);
        } catch {
          sync.receiptRecorded({ event: null, lines: [] });
          sync.stockPossiblyChanged();
        }
        return receipt;
      },
    } satisfies ProcurementDataSource;
    // sync is stable per (queryClient, orgId); recreate with the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, currentRole]);
}
