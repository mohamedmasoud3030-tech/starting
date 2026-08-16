import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EventRow } from "../events.api";

/**
 * Overview tab: event details plus the operational state-transition actions.
 * The `run` callback is the workspace command dispatcher.
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
          {event.status === "CONFIRMED" && (
            <Button
              onClick={() => void run("transition_event_status", { p_to: "PREPARING", p_reason: null })}
            >
              بدء التجهيز
            </Button>
          )}
          {event.status === "PREPARING" && (
            <Button
              onClick={() => void run("transition_event_status", { p_to: "DISPATCHED", p_reason: null })}
            >
              تأكيد الإرسال
            </Button>
          )}
          {["DRAFT", "QUOTED", "CONFIRMED", "PREPARING"].includes(event.status) &&
            canCommercial && (
              <Button
                variant="danger"
                onClick={() => {
                  const reason = window.prompt("سبب الإلغاء");
                  if (reason)
                    void run("cancel_event", {
                      p_reason: reason,
                      p_idempotency_key: crypto.randomUUID(),
                    });
                }}
              >
                إلغاء المناسبة
              </Button>
            )}
        </div>
      </Card>
    </div>
  );
}
