import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { JobPath } from "@/components/ui/JobPath";
import { formatOMR, fromDbAmount } from "@/lib/money";
import type { EventRow, StatusHistoryRow } from "../events.api";
import type { WorkspaceTab } from "../eventWorkspace.model";
import { jobPathForEventStatus } from "../eventWorkspace.model";
import type { ReadinessReport } from "../readinessReport";
import { EventTimeline } from "./EventTimeline";
import { ReadinessReportPanel } from "./ReadinessReportPanel";

/**
 * Overview tab: the event's single source of truth — details, linked accepted
 * quotation, explainable readiness, timeline, and the operational transitions.
 *
 * The server (`transition_event_status`) enforces the legal step order and the
 * readiness gate on PREPARING → DISPATCHED. This surface surfaces that gate
 * explicitly: when resources are incomplete the owner must type an override
 * reason (recorded + audited server-side) instead of the dispatch passing
 * silently.
 */
export function OverviewTab({
  event,
  customerName,
  canManage,
  canCost,
  canFinance,
  run,
  report,
  history,
  acceptedQuote,
  financiallyClosed,
  onOpenTab,
}: {
  event: EventRow;
  customerName: string | null;
  /** event.manage — status transitions and cancellation. */
  canManage: boolean;
  /** cost.visibility — the financial shortcut targets. */
  canCost: boolean;
  /** finance.manage — financial closure. */
  canFinance: boolean;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
  report: ReadinessReport;
  history: StatusHistoryRow[];
  acceptedQuote: { id?: string; quotation_number: string | null; revision: number; total_selling: string } | null;
  financiallyClosed: boolean;
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const nextStep: ReadonlyArray<readonly [EventRow["status"], string, string]> = [
    ["CONFIRMED", "PREPARING", "بدء التجهيز"],
    ["PREPARING", "DISPATCHED", "تأكيد الإرسال"],
    ["DISPATCHED", "IN_PROGRESS", "بدء التنفيذ"],
    ["IN_PROGRESS", "RETURNING", "بدء العودة والإرجاع"],
    ["RETURNING", "CLOSED", "إغلاق المناسبة"],
  ];

  const currentStep = nextStep.find(([from]) => from === event.status);
  const needsOverride =
    currentStep?.[1] === "DISPATCHED" && report.overall === "INCOMPLETE";

  const canCancel =
    ["DRAFT", "QUOTED", "CONFIRMED", "PREPARING", "DISPATCHED", "IN_PROGRESS", "RETURNING"].includes(
      event.status,
    ) && canManage;

  function transition(overrideReasonText?: string) {
    if (!currentStep) return;
    void run("transition_event_status", {
      p_to: currentStep[1],
      p_reason: null,
      p_override_reason: overrideReasonText ?? null,
    });
  }

  function submitOverride() {
    const reason = overrideReason.trim();
    if (reason.length < 3) return;
    setOverrideOpen(false);
    setOverrideReason("");
    transition(reason);
  }

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
    <div className="space-y-4">
      <JobPath current={jobPathForEventStatus(event.status, financiallyClosed)} />

      {event.status === "CONFIRMED" && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          الخطوة التالية: ابدأ التجهيز، ثم نفّذ المناسبة، وبعدها سجّل التحصيل والمصروف لتعرف الربح.
        </p>
      )}
      {event.status === "CLOSED" && !financiallyClosed && canFinance && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          أُغلقت تشغيلياً. سجّل الدفعات والمصروفات ثم أغلق مالياً لمعرفة الربح الحقيقي.
        </p>
      )}

      <ReadinessReportPanel report={report} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-black">بيانات المناسبة</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-sm text-slate-500">العميل</dt>
              <dd className="font-bold">{customerName ?? event.customer_id}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">الضيوف</dt>
              <dd className="font-bold">{event.guest_count}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">الموقع</dt>
              <dd className="font-bold">{event.venue_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">الفترة</dt>
              <dd className="font-bold">
                {new Date(event.start_at).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })} —{" "}
                {new Date(event.end_at).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="font-black">العرض المعتمد المرتبط</h2>
          {acceptedQuote ? (
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-sm text-slate-500">رقم العرض</dt>
                <dd className="font-bold" dir="ltr">
                  {acceptedQuote.quotation_number ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">الإصدار</dt>
                <dd className="font-bold">{acceptedQuote.revision}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">القيمة التجارية</dt>
                <dd className="text-lg font-black text-brand-800">
                  {formatOMR(fromDbAmount(acceptedQuote.total_selling))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              لا يوجد عرض سعر معتمد مرتبط بهذه المناسبة بعد.
            </p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-black">الإجراءات التشغيلية</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {currentStep && canManage && (
            <Button onClick={() => (needsOverride ? setOverrideOpen(true) : transition())}>
              {currentStep[2]}
            </Button>
          )}
          {canCost && (
            <>
              <Button variant="secondary" onClick={() => onOpenTab("المدفوعات")}>
                تسجيل دفعة
              </Button>
              <Button variant="secondary" onClick={() => onOpenTab("المالية")}>
                المصروف والربح
              </Button>
            </>
          )}
          {canCancel && !confirmingCancel && (
            <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
              إلغاء المناسبة
            </Button>
          )}
        </div>

        {needsOverride && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
            التجهيز غير مكتمل. يمكنك الإرسال مع سبب موثّق — سيُسجَّل التجاوز في سجل المناسبة.
          </p>
        )}

        {overrideOpen && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Field label="سبب التجاوز (3 أحرف على الأقل)" htmlFor="override-reason">
              <Input
                id="override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="مثال: العميل أصر على الموعد وسنكمل الفريق ميدانياً"
              />
            </Field>
            <div className="mt-2 flex gap-2">
              <Button onClick={submitOverride} disabled={overrideReason.trim().length < 3}>
                تأكيد الإرسال مع التجاوز
              </Button>
              <Button variant="secondary" onClick={() => setOverrideOpen(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}

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

      <EventTimeline history={history} />
    </div>
  );
}
