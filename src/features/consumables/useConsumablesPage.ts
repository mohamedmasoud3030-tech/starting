import { useState } from "react";
import type { AppRole } from "@/lib/dbTypes";
import {
  useAdjustStock,
  useConsumableStock,
  useReceiveStock,
  useWasteStock,
} from "./consumables.api";
import {
  canManageConsumables,
  canOperateConsumables,
  consumableErrorMessage,
  type StockLine,
} from "./consumables.model";

/**
 * Controller for the central consumables stock screen: queries, receive/
 * waste/adjust mutations with idempotency keys, and shared error state.
 */
export function useConsumablesPage(
  orgId: string | null,
  role: AppRole | null,
  capabilities: Set<string> | null = null,
) {
  const stock = useConsumableStock(orgId);
  const receive = useReceiveStock(orgId);
  const waste = useWasteStock(orgId);
  const adjust = useAdjustStock(orgId);

  const [error, setError] = useState("");

  const canOperate = canOperateConsumables(role, capabilities);
  const canManage = canManageConsumables(role, capabilities);
  const busy = receive.isPending || waste.isPending || adjust.isPending;

  async function runReceive(line: StockLine, quantityMilli: number, reference: string) {
    setError("");
    try {
      await receive.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reference,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runWaste(line: StockLine, quantityMilli: number, reason: string) {
    setError("");
    try {
      await waste.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runAdjust(line: StockLine, quantityMilli: number, reason: string) {
    setError("");
    try {
      await adjust.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  return {
    stock,
    canOperate,
    canManage,
    busy,
    error,
    setError,
    runReceive,
    runWaste,
    runAdjust,
  };
}
