import { useState } from "react";
import {
  useDispatchEquipment,
  useEventWarehouse,
  useReconcileWarehouse,
  useReturnEquipment,
} from "./warehouse.api";
import {
  warehouseErrorMessage,
  type WarehouseLine,
} from "./warehouse.model";

/**
 * Controller for the warehouse panel: stock queries, dispatch/return/
 * reconcile mutations, and the reconciliation confirmation workflow.
 */
export function useWarehousePanel(input: {
  orgId: string | null;
  eventId: string;
  canReadCost: boolean;
}) {
  const { orgId, eventId, canReadCost } = input;
  const warehouse = useEventWarehouse(orgId, eventId, canReadCost);
  const dispatchMutation = useDispatchEquipment(orgId, eventId);
  const returnMutation = useReturnEquipment(orgId, eventId);
  const reconcileMutation = useReconcileWarehouse(orgId, eventId);

  const [error, setError] = useState("");
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  const busy =
    dispatchMutation.isPending ||
    returnMutation.isPending ||
    reconcileMutation.isPending;

  async function runDispatch(
    line: WarehouseLine,
    quantity: number,
    reference: string,
  ) {
    setError("");
    try {
      await dispatchMutation.mutateAsync({
        reservationId: line.reservationId,
        quantity,
        reference,
        notes: "",
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(warehouseErrorMessage(e));
    }
  }

  async function runReturn(
    line: WarehouseLine,
    q: { good: number; damaged: number; lost: number },
    notes: string,
  ) {
    setError("");
    try {
      await returnMutation.mutateAsync({
        reservationId: line.reservationId,
        good: q.good,
        damaged: q.damaged,
        lost: q.lost,
        reference: "",
        conditionNotes: notes,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(warehouseErrorMessage(e));
    }
  }

  async function runReconcile() {
    setError("");
    try {
      await reconcileMutation.mutateAsync({
        notes: reconcileNotes,
        idempotencyKey: crypto.randomUUID(),
      });
      setConfirmingReconcile(false);
      setReconcileNotes("");
    } catch (e) {
      setError(warehouseErrorMessage(e));
      setConfirmingReconcile(false);
    }
  }

  return {
    warehouse,
    busy,
    error,
    runDispatch,
    runReturn,
    runReconcile,
    confirmingReconcile,
    setConfirmingReconcile,
    reconcileNotes,
    setReconcileNotes,
  };
}
