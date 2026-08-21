import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { JobPath } from "@/components/ui/JobPath";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { FINANCE_LABELS } from "@/lib/financeLabels";
import { staffingPlan } from "@/lib/staffing";
import type { EventFinance } from "@/features/payments/payments.api";
import type { RosterCounts } from "@/features/staff/attendanceRoster.model";
import type { WarehouseSummary } from "@/features/warehouse/warehouse.model";
import { WAREHOUSE_STATUS_LABELS } from "@/features/warehouse/warehouse.model";
import type { EventRow, StatusHistoryRow } from "../events.api";
import { EVENT_STATUS_LABELS, jobPathForEventStatus, type WorkspaceTab } from "../eventWorkspace.model";
import type { ReadinessReport } from "../readinessReport";
import { buildAttentionItems, buildNextActions } from "../eventCommand.model";
import { EventTimeline } from "./EventTimeline";
import { HostStaffingBanner } from "./HostStaffingBanner";
import { ReadinessReportPanel } from "./ReadinessReportPanel";

export interface OverviewCommandData {
  assignedCount: number | null;
  roster: RosterCounts | null;
  finance: EventFinance | null;
  financeLoaded: boolean;
  invoiceStatus: string | null;
  warehouse: WarehouseSummary | null;
  warehouseLoaded: boolean;
  canAttendance: boolean;
}

/**
 * Event Command Center — the first screen for an event.
 * Identity, team, commercial, operations, finance, next action, exceptions.
 */
export function OverviewTab({
  event,
  customerName,
  canCommercial,
  canFinance,
  run,
  report,
  history,
  acceptedQuote,
  financiallyClosed,
  onOpenTab,
  command,
}: {
  event: EventRow;
  customerName: string | null;
  canCommercial: boolean;
  canFinance: boolean;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
  report: ReadinessReport;
  history: StatusHistoryRow[];
  acceptedQuote: { id?: string; quotation_number: string | null; revision: number; total_selling: string } | null;
  financiallyClosed: boolean;
  onOpenTab: (tab: WorkspaceTab) => void;
  command?: OverviewCommandData;
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
    ) && canCommercial;

  const assignedCount = command?.assignedCount ?? null;
  const plan = staffingPlan({
    guestCount: event.guest_count,
    assigned: assignedCount,
  });
  const roster = command?.roster ?? null;

  const actions = useMemo(
    () =>
      buildNextActions({
        status: event.status,
        assignedCount: assignedCount ?? 0,
        roster,
        outstandingMilli: command?.financeLoaded ? (command.finance?.outstandingMilli ?? 0) : null,
        warehouseOutstanding: command?.warehouseLoaded
          ? (command.warehouse?.outstanding ?? 0)
          : null,
        financiallyClosed,
        canCommercial,
        canFinance,
        canAttendance: command?.canAttendance ?? false,
        hasAcceptedQuote: !!acceptedQuote,
      }),
    [
      event.status,
      assignedCount,
      roster,
      command,
      financiallyClosed,
      canCommercial,
      canFinance,
      acceptedQuote,
    ],
  );

  const attention = useMemo(
    () =>
      buildAttentionItems({
        status: event.status,
        roster,
        staffing: plan,
        outstandingMilli: command?.financeLoaded ? (command.finance?.outstandingMilli ?? null) : null,
        warehouseOutstanding: command?.warehouseLoaded
          ? (command.warehouse?.outstanding ?? null)
          : null,
        warehouseDamaged: command?.warehouseLoaded ? (command.warehouse?.damaged ?? null) : null,
        warehouseLost: command?.warehouseLoaded ? (command.warehouse?.lost ?? null) : null,
        readinessIncomplete: report.overall === "INCOMPLETE",
        financiallyClosed,
        canFinance,
      }),
    [event.status, roster, plan, command, report.overall, financiallyClosed, canFinance],
  );

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

  function runCommand(id: string) {
    if (id === "prepare" || id === "dispatch" || id === "start" || id === "return" || id === "close-ops") {
      if (needsOverride && id === "dispatch") {
        setOverrideOpen(true);
        return;
      }
      transition();
      return;
    }
    const action = actions.find((a) => a.id === id);
    if (action?.tab) onOpenTab(action.tab);
  }

  const startText = new Date(event.start_at).toLocaleString("ar-OM", {
    timeZone: "Asia/Muscat",
  });

  return (
    <div className="space-y-4">
      <JobPath current={jobPathForEventStatus(event.status, financiallyClosed)} />

      <Card className="p-4 sm:p-5">
        <p className="text-sm font-bold text-slate-500" dir="ltr">
          {event.event_number}
        </p>
        <h2 className="text-xl font-black">{event.title}</h2>
        <p className="mt-1 text-slate-600">
          {customerName ?? "عميل"} · {startText} · {event.venue_name}
        </p>
        <p className="mt-2 font-bold">
          {event.guest_count} ضيف · {EVENT_STATUS_LABELS[event.status] ?? event.status}
        </p>
      </Card>

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

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-black">الخطوة التالية</h2>
          {command?.canAttendance && (
            <Button variant="outline" size="sm" onClick={() => onOpenTab("الحضور")}>
              فتح الحضور
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {currentStep && (
            <Button onClick={() => (needsOverride ? setOverrideOpen(true) : transition())}>
              {currentStep[2]}
            </Button>
          )}
          {actions
            .filter(
              (a) =>
                ![
                  "prepare",
                  "dispatch",
                  "start",
                  "return",
                  "close-ops",
                  "pay",
                  "pay-secondary",
                  "close-fin",
                  "done",
                ].includes(a.id),
            )
            .map((action) => (
              <Button
                key={action.id}
                variant={action.primary && !currentStep ? "primary" : "secondary"}
                onClick={() => runCommand(action.id)}
              >
                {action.label}
              </Button>
            ))}
          {canFinance && (
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

      {attention.length > 0 && (
        <Card className="border-amber-200 p-4 sm:p-5">
          <h2 className="font-black text-amber-900">يحتاج انتباهاً</h2>
          <ul className="mt-2 space-y-1">
            {attention.map((item) => (
              <li key={item.id}>
                {item.tab ? (
                  <button
                    type="button"
                    className="text-right font-semibold text-amber-900 underline-offset-2 hover:underline"
                    onClick={() => onOpenTab(item.tab!)}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span className="font-semibold text-amber-900">{item.label}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <HostStaffingBanner plan={plan} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-black">الفريق والحضور</h2>
            {command?.canAttendance && (
              <Button variant="outline" size="sm" onClick={() => onOpenTab("الحضور")}>
                الحضور
              </Button>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-slate-500">الضيوف</dt>
              <dd className="font-black">{event.guest_count}</dd>
            </div>
            <div>
              <dt className="text-slate-500">المقترح</dt>
              <dd className="font-black">{plan.recommended ?? "غير متاح"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">المعيّن</dt>
              <dd className="font-black">{assignedCount ?? "غير متاح"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">حضر</dt>
              <dd className="font-black">{roster ? roster.arrived : "غير متاح"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">لم يصل</dt>
              <dd className="font-black">{roster ? roster.notArrived : "غير متاح"}</dd>
            </div>
            {roster && roster.checkedOut > 0 && (
              <>
                <div>
                  <dt className="text-slate-500">خرج</dt>
                  <dd className="font-black">
                    {roster.checkedOut} / {roster.total}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">ما زال مفتوح</dt>
                  <dd className="font-black">{roster.present}</dd>
                </div>
              </>
            )}
          </dl>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-black">الحالة التجارية</h2>
          {canFinance ? (
            command && !command.financeLoaded ? (
              <p className="mt-3 text-sm text-slate-500">جارٍ تحميل الأرقام التجارية…</p>
            ) : command?.finance ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{FINANCE_LABELS.agreed}</dt>
                  <dd className="font-black">{formatOMR(command.finance.acceptedRevenueMilli)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{FINANCE_LABELS.collected}</dt>
                  <dd className="font-black">{formatOMR(command.finance.amountPaidMilli)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{FINANCE_LABELS.remaining}</dt>
                  <dd className="font-black">{formatOMR(command.finance.outstandingMilli)}</dd>
                </div>
                {command.invoiceStatus && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">الفاتورة</dt>
                    <dd className="font-bold">{command.invoiceStatus === "ISSUED" ? "صادرة" : command.invoiceStatus}</dd>
                  </div>
                )}
              </dl>
            ) : acceptedQuote ? (
              <dl className="mt-3 space-y-2">
                <div>
                  <dt className="text-sm text-slate-500">رقم العرض</dt>
                  <dd className="font-bold" dir="ltr">
                    {acceptedQuote.quotation_number ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">{FINANCE_LABELS.agreed}</dt>
                  <dd className="text-lg font-black text-brand-800">
                    {formatOMR(fromDbAmount(acceptedQuote.total_selling))}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-slate-500">لا يوجد عرض سعر معتمد مرتبط بهذه المناسبة بعد.</p>
            )
          ) : acceptedQuote ? (
            <p className="mt-3 font-bold">عرض معتمد {acceptedQuote.quotation_number ?? ""}</p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">غير متاح لدورك</p>
          )}
        </Card>
      </div>

      <ReadinessReportPanel report={report} />

      <Card className="p-4 sm:p-5">
        <h2 className="font-black">الجاهزية التشغيلية</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">المعدات</dt>
            <dd className="font-bold">
              {command && !command.warehouseLoaded
                ? "غير متاح"
                : command?.warehouse
                  ? WAREHOUSE_STATUS_LABELS[command.warehouse.status]
                  : report.equipmentShortage > 0
                    ? `ناقص ${report.equipmentShortage}`
                    : "جاهزة أو غير مطلوبة"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">التسليم / الإرجاع</dt>
            <dd className="font-bold">
              {command?.warehouseLoaded && command.warehouse
                ? command.warehouse.outstanding > 0
                  ? `لم يعد ${command.warehouse.outstanding}`
                  : command.warehouse.dispatched > 0
                    ? "عاد"
                    : "لم يخرج بعد"
                : "غير متاح"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">تلف / فقد</dt>
            <dd className="font-bold">
              {command?.warehouseLoaded && command.warehouse
                ? command.warehouse.damaged + command.warehouse.lost > 0
                  ? `${command.warehouse.damaged} تالف · ${command.warehouse.lost} فقد`
                  : "لا يوجد"
                : "غير متاح"}
            </dd>
          </div>
        </dl>
      </Card>

      {canFinance && (
        <Card className="p-4 sm:p-5">
          <h2 className="font-black">النتيجة المالية</h2>
          {!command || !command.financeLoaded ? (
            <p className="mt-3 text-sm text-slate-500">غير متاح</p>
          ) : command.finance ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MoneyFact label={FINANCE_LABELS.agreed} value={formatOMR(command.finance.acceptedRevenueMilli)} />
              <MoneyFact label={FINANCE_LABELS.collected} value={formatOMR(command.finance.amountPaidMilli)} />
              <MoneyFact label={FINANCE_LABELS.remaining} value={formatOMR(command.finance.outstandingMilli)} />
              <MoneyFact label={FINANCE_LABELS.costs} value={formatOMR(command.finance.actualCostMilli)} />
              <MoneyFact label={FINANCE_LABELS.expenses} value={formatOMR(command.finance.expenseCostMilli)} />
              <MoneyFact label={FINANCE_LABELS.hostCosts} value={formatOMR(command.finance.staffCostMilli)} />
              <MoneyFact label={FINANCE_LABELS.profit} value={formatOMR(command.finance.actualProfitMilli)} tone="brand" />
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">غير متاح</p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            القيمة المتفق عليها ليست المبلغ المحصّل، والمتبقي على العميل ليس الربح.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 sm:p-5">
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
                {startText} —{" "}
                {new Date(event.end_at).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4 sm:p-5">
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
                <dt className="text-sm text-slate-500">{FINANCE_LABELS.agreed}</dt>
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

      <EventTimeline history={history} />
    </div>
  );
}

function MoneyFact({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "brand";
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 font-black ${tone === "brand" ? "text-brand-800" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
