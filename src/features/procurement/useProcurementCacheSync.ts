import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/authContext";
import type { ProcurementOrderDetail } from "./contracts";

/**
 * Cross-feature cache synchronisation for procurement commands.
 *
 * The procurement feature owns its own data source (plain async adapter, not
 * TanStack Query), so its internal screens refresh via explicit reloads. But
 * two OTHER features read TanStack-cached read models whose truth procurement
 * commands change on the server:
 *
 * 1. **Consumable stock** — receiving a CONSUMABLE order line records an
 *    authoritative `consumable_movements` IN row (migration 0030), which
 *    changes `consumable_stock_summary`. Without invalidation the central
 *    stock screen kept serving the stale pre-receipt quantity from cache.
 *
 * 2. **Event finance** — `event_finance_summaries.committed_cost` and
 *    `delivered_cost` are derived from procurement orders/receipts
 *    (migration 0037). An order lifecycle change or a receipt against an
 *    event-linked order changes those figures.
 *
 * Only reads are invalidated here; commands themselves stay idempotent and
 * server-authoritative in the data source.
 */
export function useProcurementCacheSync() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const invalidateEventFinance = (eventId: string) => {
    void queryClient.invalidateQueries({
      queryKey: ["event-finance", orgId, eventId],
    });
    // The workspace aggregate embeds quotes/lines only, but the workspace
    // finance tab reads event-finance; the aggregate itself is untouched by
    // procurement, so no broader invalidation is justified.
  };

  return {
    /** After a successful receipt against `order`. */
    receiptRecorded(order: Pick<ProcurementOrderDetail, "event" | "lines">) {
      const receivedConsumables = order.lines.some(
        (line) => line.kind === "CONSUMABLE",
      );
      if (receivedConsumables) {
        void queryClient.invalidateQueries({
          queryKey: ["consumable-stock", orgId],
        });
      }
      if (order.event) invalidateEventFinance(order.event.id);
    },

    /** After a successful approve/send/confirm/cancel of `order`. */
    orderLifecycleChanged(order: Pick<ProcurementOrderDetail, "event">) {
      if (order.event) invalidateEventFinance(order.event.id);
    },

    /**
     * Fallback when the order shape could not be resolved after a receipt.
     *
     * The receipt is already COMMITTED server-side at this point, so every
     * read model a receipt can change must be refreshed even though the
     * event linkage is unknown:
     *
     *  - consumable stock (a CONSUMABLE line may have produced an IN
     *    movement, migration 0030);
     *  - event finance — org-wide PREFIX invalidation of
     *    `["event-finance", orgId]`, because the receipt may have changed
     *    `event_finance_summaries.delivered_cost` (migration 0037) for an
     *    event we could not identify. Broad by necessity, tenant-scoped by
     *    construction; better one extra refetch than a stale delivered
     *    cost presented as fact.
     */
    receiptResolutionFailed() {
      void queryClient.invalidateQueries({
        queryKey: ["consumable-stock", orgId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["event-finance", orgId],
      });
    },
  };
}
