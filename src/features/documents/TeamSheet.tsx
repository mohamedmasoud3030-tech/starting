import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { ATTENDANCE_STATUS_LABELS, STAFF_TYPE_LABELS } from "@/features/staff/labels";
import type { EventTeamSheetRow } from "./documents.api";

function muscatTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("ar-OM", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Muscat",
      })
    : "—";
}

function muscatDate(value: string): string {
  return new Date(value).toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" });
}

function presenceLabel(status: string | null): string {
  if (!status) return "لم يُسجَّل";
  return ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status;
}

/**
 * Event team sheet (كشف فريق المناسبة) — generated from the event's ACTIVE
 * staff assignments and the non-confidential attendance state.
 *
 * Deliberately wage-free: names, tasks, shift times, arrival state and paper
 * check boxes only. Even for a cost/payroll-authorized viewer this document
 * never renders rates or earnings — the operational roster is not a payroll
 * document (use the host statement or the period sheet for money).
 */
export function TeamSheet({
  identity,
  eventNumber,
  eventTitle,
  printedAt,
  rows,
}: {
  identity: DocumentIdentity;
  eventNumber: string;
  eventTitle: string;
  printedAt: string;
  rows: EventTeamSheetRow[];
}) {
  return (
    <DocumentShell
      identity={identity}
      title="كشف فريق المناسبة"
      documentNumber={eventNumber}
      dateText={muscatDate(printedAt)}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">
              {eventNumber}
              {eventTitle ? ` — ${eventTitle}` : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">وقت الطباعة: </span>
            <span className="font-bold">
              {new Date(printedAt).toLocaleString("ar-OM", {
                timeZone: "Asia/Muscat",
              })}
            </span>
          </div>
        </div>
      }
      signature={false}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا يوجد فريق مسند لهذه المناسبة بعد.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-center">وصول</th>
              <th className="py-2 text-right">المضيف</th>
              <th className="py-2 text-right">الجوال</th>
              <th className="py-2 text-right">المهمة</th>
              <th className="py-2 text-right">الوردية</th>
              <th className="py-2 text-right">الحالة</th>
              <th className="py-2 text-right">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.staff_member_id}-${i}`}
                className="border-b border-slate-200 align-top"
              >
                <td className="py-2 text-center">
                  <span className="inline-block h-4 w-4 rounded border-2 border-slate-500" />
                </td>
                <td className="py-2 font-bold">{r.staff_name}</td>
                <td className="py-2" dir="ltr">
                  {r.staff_phone || "—"}
                </td>
                <td className="py-2">
                  {STAFF_TYPE_LABELS[r.assignment_role] ?? r.assignment_role}
                </td>
                <td className="py-2 whitespace-nowrap" dir="ltr">
                  {muscatTime(r.scheduled_start)} — {muscatTime(r.scheduled_end)}
                </td>
                <td className="py-2 whitespace-nowrap">{presenceLabel(r.presence_status)}</td>
                <td className="py-2 text-slate-600">{r.assignment_notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-3 text-xs text-slate-500">
        هذا الكشف تشغيلي فقط ولا يتضمن أي بيانات أجور أو معدلات.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-6 text-sm">
        <div className="text-center">
          <div className="mx-auto h-12 w-44 border-b border-slate-400" />
          <p className="mt-1 font-bold">توقيع مسؤول المناسبة</p>
        </div>
        <div className="text-center">
          <div className="mx-auto h-12 w-44 border-b border-slate-400" />
          <p className="mt-1 font-bold">التاريخ</p>
        </div>
      </div>
    </DocumentShell>
  );
}
