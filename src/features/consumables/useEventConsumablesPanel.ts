import { useState } from "react";
import {
  useConsumableStock,
  useConsumeAtEvent,
  useEventConsumables,
  useIssueToEvent,
  useReconcileConsumables,
  useReturnFromEvent,
  useWasteAtEvent,
} from "./consumables.api";
import {
  consumableErrorMessage,
  validateQuantityAgainst,
  type EventConsumableLine,
} from "./consumables.model";

/**
 * Controller for the event consumables panel: event + stock queries, issue /
 * custody / reconcile mutations with idempotency keys, and the issue-form
 * and reconciliation confirmation workflow state.
 */
export function useEventConsumablesPanel(input: {
  orgId: string | null;
  eventId: string;
}) {
  const { orgId, eventId } = input;
  const eventConsumables = useEventConsumables(orgId, eventId);
  const stock = useConsumableStock(orgId);
  const issueMutation = useIssueToEvent(orgId, eventId);
  const returnMutation = useReturnFromEvent(orgId, eventId);
  const consumeMutation = useConsumeAtEvent(orgId, eventId);
  const wasteMutation = useWasteAtEvent(orgId, eventId);
  const reconcileMutation = useReconcileConsumables(orgId, eventId);

  const [error, setError] = useState("");
  const [issueStockItemId, setIssueStockItemId] = useState("");
  const [issueQuantityText, setIssueQuantityText] = useState("");
  const [issueLocalError, setIssueLocalError] = useState("");
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  const busy =
    issueMutation.isPending ||
    returnMutation.isPending ||
    consumeMutation.isPending ||
    wasteMutation.isPending ||
    reconcileMutation.isPending;

  const stockLines = (stock.data?.lines ?? []).filter(
    (l) => l.isTrackingActive && l.onHandMilli > 0,
  );
  const selectedStock = stockLines.find(
    (l) => l.stockItemId === issueStockItemId,
  );

  async function runIssue() {
    if (!selectedStock) {
      setIssueLocalError("اختر الصنف أولاً.");
      return;
    }
    const check = validateQuantityAgainst(
      issueQuantityText,
      selectedStock.onHandMilli,
      "الرصيد المتوفر",
    );
    if (!check.valid) {
      setIssueLocalError(check.message);
      return;
    }
    setIssueLocalError("");
    setError("");
    try {
      await issueMutation.mutateAsync({
        stockItemId: selectedStock.stockItemId,
        quantityMilli: check.milli,
        reference: "",
        idempotencyKey: crypto.randomUUID(),
      });
      setIssueStockItemId("");
      setIssueQuantityText("");
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runCustody(
    kind: "return" | "consume" | "waste",
    line: EventConsumableLine,
    quantityMilli: number,
    note: string,
  ) {
    setError("");
    const input = {
      stockItemId: line.stockItemId,
      quantityMilli,
      note,
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      if (kind === "return") await returnMutation.mutateAsync(input);
      else if (kind === "consume") await consumeMutation.mutateAsync(input);
      else await wasteMutation.mutateAsync(input);
    } catch (e) {
      setError(consumableErrorMessage(e));
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
      setError(consumableErrorMessage(e));
      setConfirmingReconcile(false);
    }
  }

  return {
    eventConsumables,
    stock,
    stockLines,
    selectedStock,
    busy,
    error,
    runIssue,
    runCustody,
    runReconcile,
    issueStockItemId,
    setIssueStockItemId,
    issueQuantityText,
    setIssueQuantityText,
    issueLocalError,
    confirmingReconcile,
    setConfirmingReconcile,
    reconcileNotes,
    setReconcileNotes,
  };
}
