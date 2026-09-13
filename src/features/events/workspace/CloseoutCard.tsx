import { CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { useEventPayroll } from "@/features/staff/staff.api";
import { useEventWarehouse } from "@/features/warehouse/warehouse.api";
import type { CommandCenter } from "../commandCenter.api";
import type { WorkspaceTab } from "../eventWorkspace.model";

/**
 * «الإقفال» in one glance — the three numbers the office needs at zero
 * before an event is truly finished:
 *   1. الباقي على العميل      (command center · customer_payments)
 *   2. مستحقات المضيفين       (host_event_payroll_summaries)
 *   3. عدة لم ترجع            (event_warehouse_summary)
 * Each row jumps to the existing tab that settles it. Read-only; nothing new
 * on the server.
 */
export function CloseoutCard({
  orgId,
  eventId,
  center,
  canCost,
  canPayroll,
  eventStatus,
  onOpenTab,
}: {
  orgId: string | null;
  eventId: string;
  center: CommandCenter | null;
  canCost: boolean;
  canPayroll: boolean;
  eventStatus: string;
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const payroll = useEventPayroll(canPayroll ? orgId : null, eventId);
  const warehouse = useEventWarehouse(orgId, eventId, canCost);

  const outstandingMilli = center?.commercial.outstanding ? fromDbAmount(center.commercial.outstanding) : null;
  const hostsDueMilli = payroll.data ? payroll.data.reduce((n, r) => n + r.dueMilli, 0) : null;
  const kitOut = warehouse.data?.summary.outstanding ?? null;
  const kitReconciled = warehouse.data?.summary.is_reconciled ?? false;

  const rows: Array<{ label: string; value: string; ok: boolean; tab: WorkspaceTab; hint: string }> = [];
  if (canCost && outstandingMilli !== null) {
    rows.push({
      label: "الباقي على العميل",
      value: formatOMR(outstandingMilli),
      ok: outstandingMilli <= 0,
      tab: "المدفوعات",
      hint: outstandingMilli <= 0 ? "تم التحصيل بالكامل" : "سجّل الدفعة الأخيرة",
    });
  }
  if (canPayroll && hostsDueMilli !== null) {
    rows.push({
      label: "مستحقات المضيفين",
      value: formatOMR(hostsDueMilli),
      ok: hostsDueMilli <= 0,
      tab: "الأجور",
      hint: hostsDueMilli <= 0 ? "الكل قبض" : "اصرف المستحقات",
    });
  }
  if (kitOut !== null) {
    rows.push({
      label: "عدة لم ترجع",
      value: `${kitOut} قطعة`,
      ok: kitOut === 0 && kitReconciled,
      tab: "المخزن",
      hint: kitOut === 0 && kitReconciled ? "تمت التسوية" : kitOut === 0 ? "أكّد التسوية النهائية" : "سجّل الإرجاع والتالف",
    });
  }

  const allOk = rows.length > 0 && rows.every((r) => r.ok);
  const closed = eventStatus === "CLOSED";

  return (
    <section
      aria-label="إقفال المناسبة"
      className={`rounded-2xl border p-4 ${allOk || closed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">الإقفال</h2>
        {closed ? (
          <span className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-bold text-white">مغلقة</span>
        ) : allOk ? (
          <span className="rounded-lg bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">جاهزة للإقفال</span>
        ) : (
          <span className="rounded-lg bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">متبقي</span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">لا تتوفر أرقام الإقفال لدورك.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {rows.map((r) => (
            <li key={r.label}>
              <button
                type="button"
                onClick={() => onOpenTab(r.tab)}
                className={`flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-start ${
                  r.ok ? "border-emerald-200 bg-white" : "border-amber-200 bg-amber-50 hover:bg-amber-100"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-bold text-slate-600">
                  {r.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
                  {r.label}
                </span>
                <span className="text-2xl font-black text-slate-900">{r.value}</span>
                <span className="text-xs text-slate-500">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!closed && allOk && (
        <div className="mt-3">
          <Button size="lg" onClick={() => onOpenTab("ملخص")}>
            اذهب لزر «إغلاق المناسبة» في الملخص
          </Button>
        </div>
      )}
    </section>
  );
}
