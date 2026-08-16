import type { ReactNode } from "react";
import { Button } from "./Button";

/**
 * Standard inline confirmation block (amber warning panel with confirm /
 * cancel actions). Used for irreversible operational confirmations such as
 * final warehouse/consumables reconciliation, where the operator must
 * explicitly re-acknowledge before the command is sent.
 */
export function ConfirmPanel({
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "تراجع",
  busy = false,
  confirmTone = "primary",
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  /** Extra fields (e.g. reason/notes inputs) rendered above the actions. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmTone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-amber-50 p-3">
      <p className="font-black text-amber-900">{title}</p>
      {description && <p className="text-sm font-semibold text-amber-800">{description}</p>}
      {children}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          variant={confirmTone === "danger" ? "danger" : "primary"}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "جارٍ التنفيذ…" : confirmLabel}
        </Button>
        <Button size="lg" variant="ghost" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
