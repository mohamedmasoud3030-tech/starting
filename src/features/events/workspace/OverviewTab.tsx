import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import type { EventRow } from "../events.api";

/**
 * Overview tab: event details plus the operational state-transition actions.
 *
 * The server (`transition_event_status`) enforces the legal step order
 * CONFIRMED → PREPARING → DISPATCHED → IN_PROGRESS → RETURNING → CLOSED;
 * this surface simply offers exactly one next step per status so the owner
 * can complete the close-out journey from the UI (defect F1).
 *
 * Cancellation asks for a written reason in a standard confirmation panel
 * (defect F7) — never a blocking `window.prompt`.
 */
export function OverviewTab({
  event,
  customerName,
  canCommercial,
  run,
}: {
  event: EventRow;
  customerName: string | null;
  canCommercial: boolean;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const nextStep: ReadonlyArray<readonly [EventRow["status"], string, string]> = [
    ["CONFIRMED", "PREPARING", "بدء التجهيز"],
    ["PREPARING", "DISPATCHED", "تأكيد الإرسال"],
    ["DISPATCHED", "IN_PROGRESS", "بدء التنفيذ"],
    ["IN_PROGRESS", "RETURNING", "بدء العودة والإرجاع"],
    ["RETURNING", "CLOSED", "إغلاق المناسبة"],
  ];

  const currentStep = nextStep.find(([from]) => from === event.status);

  const canCancel =
    ["DRAFT", "QUOTED", "CONFIRMED", "PREPARING", "DISPATCHED", "IN_PROGRESS", "RETURNING"].includes(
      event.status,
    ) && canCommercial;

  function submitCancel() {
    const reason = cancelReason.trim();
    if (!reason) return;
    setConfirmingCancel(false);
    setCancelReason("");
    void run("cancel_event", {
      p_reason: reason,
      p_idempotency_key: crypto.randomUUID(),
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="font-black">بيانات المناسبة</h2>
        <dl className="mt-3 space-y-2">
          <div>
            <dt className="text-sm text-slate-500">العميل</dt>
            <dd>{customerName ?? event.customer_id}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">الضيوف</dt>
            <dd>{event.guest_count}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">الفترة</dt>
            <dd>
              {new Date(event.start_at).toLocaleString("ar-OM")} —{" "}
              {new Date(event.end_at).toLocaleString("ar-OM")}
            </dd>
          </div>
        </dl>
      </Card>
      <Card>
        <h2 className="font-black">الإجراءات التشغيلية</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {currentStep && (
            <Button
              onClick={() =>
                void run("transition_event_status", {
                  p_to: currentStep[1],
                  p_reason: null,
                })
              }
            >
              {currentStep[2]}
            </Button>
          )}
          {canCancel && !confirmingCancel && (
            <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
              إلغاء المناسبة
            </Button>
          )}
        </div>
        {confirmingCancel && (
          <ConfirmPanel
            title="تأكيد إلغاء المناسبة"
            description="الإلغاء لا يمكن التراجع عنه. اكتب سبب الإلغاء قبل التأكيد."
            confirmLabel="تأكيد الإلغاء"
            confirmTone="danger"
            onConfirm={submitCancel}
            onCancel={() => {
              setConfirmingCancel(false);
              setCancelReason("");
            }}
          >
            <Field label="سبب الإلغاء" htmlFor="cancel-reason">
              <Input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="مثال: اعتذر العميل عن إقامة المناسبة"
              />
            </Field>
          </ConfirmPanel>
        )}
      </Card>
    </div>
  );
}
