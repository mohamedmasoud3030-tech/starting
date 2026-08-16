import { useEffect, useMemo, useState } from "react";
import type {
  ProcurementConsumableOption,
  ProcurementDataSource,
  ProcurementOrderListItem,
  ProcurementOrderStatus,
  SupplierListItem,
} from "./contracts";
import { procurementErrorMessage } from "./errors";
import { filterOrders, hasActiveFilters } from "./orderList.model";

export type OrderStatusFilter = ProcurementOrderStatus | "ALL";

/**
 * Controller for the orders feed: parallel load of orders/suppliers/
 * consumables with explicit reload, plus search/status filtering state.
 */
export function useOrdersFeed(dataSource: ProcurementDataSource) {
  const [orders, setOrders] = useState<ProcurementOrderListItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [consumables, setConsumables] = useState<ProcurementConsumableOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatusFilter>("ALL");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void Promise.all([
      dataSource.listOrders(),
      dataSource.listSuppliers(),
      dataSource.listConsumableOptions(),
    ]).then(
      ([orderItems, supplierItems, consumableItems]) => {
        if (current) {
          setOrders(orderItems);
          setSuppliers(supplierItems);
          setConsumables(consumableItems);
        }
      },
      (cause) => {
        if (current) setError(procurementErrorMessage(cause));
      },
    ).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [dataSource, reload]);

  const visible = useMemo(
    () => filterOrders(orders, search, status),
    [orders, search, status],
  );
  const filtered = hasActiveFilters(search, status);

  return {
    orders,
    suppliers,
    consumables,
    loading,
    error,
    reload: () => setReload((value) => value + 1),
    search,
    setSearch,
    status,
    setStatus,
    visible,
    filtered,
  };
}
