import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount, type MilliOMR } from "@/lib/money";
import type { HostStatementRow } from "./documents.api";

function dateOnly(value: string): string {
  return new Date(value).toLocaleDateString("ar-OM", {
    timeZone: "Asia/Muscat",
  });
}

/**
 * Host statement (كشف حساب مضيف) for one staff member: one row per event
 * from the canonical payroll rollup. `advances_total` is host-WIDE and is
 * repeated on every row by design (the per-event view carries 0); the
 * surface presents it ONCE, above the table, exactly as the payroll
 * workspace does. The totals row is the sum of the canonical rows.
 */
export function HostStatement({
  identity,
  rows,
}: {
  identity: DocumentIdentity;
  rows: HostStatementRow[];
}) {
  if (rows.length === 0) {
    return (
      <DocumentShell identity={identity} title="كشف حساب مضيف">
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد بيانات أجور لهذا المضيف.
        </p>
      </DocumentShell>
    );
  }

  const first = rows[0]!;
  const hostName = first.host_name;
  const hostPhone = first.host_phone;
  // Host-wide canonical advances (same value on every row — present once).
  const advances = fromDbAmount(first.advances_total);

  let earned: MilliOMR = 0;
  let paid: MilliOMR = 0;
  for (const r of rows) {
    earned += fromDbAmount(r.earned_total);
    paid += fromDbAmount(r.paid_total);
  }
  const remaining = earned - paid - advances;

  return (
    <DocumentShell
      identity={identity}
      title="كشف حساب مضيف"
      dateText={dateOnly(new Date().toISOString())}
      meta={
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">المضيف: </span>
          <span className="font-bold">{hostName}</span>
          {hostPhone && (
            <>
              <span className="mr-4 text-slate-500">الجوال: </span>
              <span dir="ltr" className="font-bold">
                {hostPhone}
              </span>
            </>
          )}
        </div>
      }
    >
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-brand-700 text-brand-900">
            <th className="py-2 text-right">التاريخ</th>
            <th className="py-2 text-right">المناسبة</th>
            <th className="py-2 text-left">الاستحقاق (ر.ع.)</th>
            <th className="py-2 text-left">المسدد (ر.ع.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.event_id} className="border-b border-slate-200">
              <td className="py-1.5 whitespace-nowrap">
                {dateOnly(r.start_at)}
              </td>
              <td className="py-1.5">
                <span className="font-bold">{r.event_number}</span>
                {r.event_title ? ` — ${r.event_title}` : ""}
              </td>
              <td className="py-1.5 text-left" dir="ltr">
                {formatOMR(fromDbAmount(r.earned_total))}
              </td>
              <td className="py-1.5 text-left" dir="ltr">
                {formatOMR(fromDbAmount(r.paid_total))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 space-y-1.5 rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="font-bold text-brand-900">إجمالي الاستحقاق (ر.ع.)</span>
          <span dir="ltr" className="font-black text-brand-900">
            {formatOMR(earned)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold text-brand-900">
            السلف (إجمالي على مستوى المضيف، ر.ع.)
          </span>
          <span dir="ltr" className="font-black text-brand-900">
            {formatOMR(advances)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold text-brand-900">إجمالي المسدد (ر.ع.)</span>
          <span dir="ltr" className="font-black text-brand-900">
            {formatOMR(paid)}
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t border-brand-300 pt-2">
          <span className="text-base font-black text-brand-900">
            المتبقي للمضيف (ر.ع.)
          </span>
          <span dir="ltr" className="text-base font-black text-brand-900">
            {formatOMR(remaining)}
          </span>
        </div>
      </div>
    </DocumentShell>
  );
}
