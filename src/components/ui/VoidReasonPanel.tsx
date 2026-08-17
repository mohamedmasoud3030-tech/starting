import { useState } from "react";
import { Input } from "./Input";
import { Field } from "./Field";
import { ConfirmPanel } from "./ConfirmPanel";

/**
 * Standard void-with-reason confirmation (defect D35): replaces the blocking
 * `window.prompt` pattern for irreversible financial/attendance voids. The
 * operator writes the mandatory reason inside the design-system panel.
 */
export function VoidReasonPanel({
  title,
  description,
  confirmLabel,
  reasonLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  reasonLabel: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <ConfirmPanel
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      busy={busy}
      confirmTone="danger"
      onConfirm={() => {
        const trimmed = reason.trim();
        if (trimmed.length >= 3) onConfirm(trimmed);
      }}
      onCancel={onCancel}
    >
      <Field label={reasonLabel} htmlFor="void-reason">
        <Input
          id="void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="اكتب السبب (٣ أحرف على الأقل)"
        />
      </Field>
    </ConfirmPanel>
  );
}
