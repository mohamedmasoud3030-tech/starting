import type {
  ProcurementOrderListItem,
  ProcurementOrderStatus,
} from "./contracts";

/** Pure order-list filtering used by the orders feed. */
export function filterOrders(
  orders: ReadonlyArray<ProcurementOrderListItem>,
  search: string,
  status: ProcurementOrderStatus | "ALL",
): ProcurementOrderListItem[] {
  const needle = search.trim().toLocaleLowerCase("ar");
  return orders.filter((order) => {
    const haystack =
      `${order.orderNumber} ${order.supplier.name} ${order.event?.title ?? ""}`
        .toLocaleLowerCase("ar");
    return (
      (!needle || haystack.includes(needle)) &&
      (status === "ALL" || order.status === status)
    );
  });
}

export function hasActiveFilters(
  search: string,
  status: ProcurementOrderStatus | "ALL",
): boolean {
  return Boolean(search.trim() || status !== "ALL");
}
