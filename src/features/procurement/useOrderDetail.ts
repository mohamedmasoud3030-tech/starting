import { useEffect, useState } from "react";
import type {
  ProcurementDataSource,
  ProcurementOrderDetail,
} from "./contracts";
import { procurementErrorMessage } from "./errors";
import { ACTION_SUCCESS, type LifecycleAction } from "./presentation";

function newIntentKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Controller for the order detail dialog: detail loading with reload,
 * lifecycle action selection, and command execution with stable idempotency
 * keys (a key is kept across retries after an ambiguous error).
 */
export function useOrderDetail(
  dataSource: ProcurementDataSource,
  orderId: string | null,
  onChanged: () => void,
) {
  const [detail, setDetail] = useState<ProcurementOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  const [actionKey, setActionKey] = useState(newIntentKey);
  const [cancelReason, setCancelReason] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!orderId) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setDetail(null);
    setConfirmAction(null);
    setReceiving(false);
    void dataSource
      .getOrder(orderId)
      .then(
        (value) => {
          if (current) setDetail(value);
        },
        (cause) => {
          if (current) setLoadError(procurementErrorMessage(cause));
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [dataSource, orderId, reload]);

  function selectAction(action: LifecycleAction) {
    setSuccess("");
    setActionError("");
    setCancelReason("");
    setActionKey(newIntentKey());
    setConfirmAction(action);
  }

  function updateCancelReason(value: string) {
    if (value !== cancelReason) setActionKey(newIntentKey());
    setCancelReason(value);
    setActionError("");
  }

  async function runAction(action: LifecycleAction) {
    if (!orderId) return;
    if (action === "cancel" && cancelReason.trim().length < 3) {
      setActionError("اكتب سبب الإلغاء بوضوح (3 أحرف على الأقل).");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      let updated: ProcurementOrderDetail;
      if (action === "approve") {
        updated = await dataSource.approveOrder(orderId, actionKey);
      } else if (action === "send") {
        updated = await dataSource.sendOrder(orderId, actionKey);
      } else if (action === "confirm") {
        updated = await dataSource.confirmOrder(orderId, actionKey);
      } else {
        updated = await dataSource.cancelOrder(orderId, cancelReason.trim(), actionKey);
      }
      setDetail(updated);
      setConfirmAction(null);
      setSuccess(ACTION_SUCCESS[action]);
      onChanged();
    } catch (cause) {
      // actionKey remains stable for an unchanged retry after an ambiguous error.
      setActionError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return {
    detail,
    loading,
    loadError,
    reloadDetail: () => setReload((value) => value + 1),
    confirmAction,
    cancelReason,
    updateCancelReason,
    selectAction,
    closeConfirm: () => {
      setConfirmAction(null);
      setActionError("");
    },
    runAction,
    receiving,
    openReceiving: () => {
      setSuccess("");
      setReceiving(true);
    },
    closeReceiving: () => {
      setReceiving(false);
      setReload((value) => value + 1);
    },
    busy,
    actionError,
    success,
  };
}
