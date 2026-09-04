import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount, type MilliOMR } from "@/lib/money";
import type { PayrollPeriodRow } from "./documents.api";

function dateOnly(value: string): string {
  return new Date(value).toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" });
}

/**
 * Payroll period sheet (كشف صرف / رواتب فترة) — one row per host with any
 * recorded payroll fact inside [from, to]. Amounts are the canonical period
 * aggregates from the server (0081); the totals box is the exact sum of the
 * printed rows (milli-OMR integers — never float addition). The remaining
 * payable column is the printed period's earned − advances − payouts.
 *
 * This is a sensitive financial document: its visibility is the server-side
 * payroll.read gate; the document never carries rates or methods, only sums.
 */
export function PayrollPeriodSheet({
  identity,
  from,
  to,
  rows,
}: {
  identity: DocumentIdentity;
  from: string;
  to: string;
  rows: PayrollPeriodRow[];
}) {
  if (rows.length === 0) {
    return (
      <DocumentShell
        identity={identity}
        title="كشف صرف / رواتب فترة"
        dateText={`${dateOnly(from)} — ${dateOnly(to)}`}
      >
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد مستحقات أو صرف مسجل في هذه الفترة.
        </p>
      </DocumentShell>
    );
  }

  let earned: MilliOMR = 0;
  let advances: MilliOMR = 0;
  let payouts: MilliOMR = 0;
  let remaining: MilliOMR = 0;
  for (const r of rows) {
    earned += fromDbAmount(r.earned_total);
    advances += fromDbAmount(r.advances_total);
    payouts += fromDbAmount(r.payouts_total);
    remaining += fromDbAmount(r.balance_total);
  }

  return (
    <DocumentShell
      identity={identity}
      title="كشف صرف / رواتب فترة"
      dateText={`${dateOnly(from)} — ${dateOnly(to)}`}
      meta={
        <p className="text-sm text-slate-600">
          الفترة من <b dir="ltr">{dateOnly(from)}</b> إلى <b dir="ltr">{dateOnly(to)}</b> —
          المستحقات محسوبة من ورديات الحضور المسجلة خلال الفترة، والسلف والصرف
          من قيودها المسجلة ضمن الفترة نفسها.
        </p>
      }
      signature
    >
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-brand-700 text-brand-900">
            <th className="py-2 text-right">المضيف</th>
            <th className="py-2 text-right">الورديات</th>
            <th className="py-2 text-left">الاستحقاق (ر.ع.)</th>
            <th className="py-2 text-left">السلف (ر.ع.)</th>
            <th className="py-2 text-left">المسدد (ر.ع.)</th>
            <th className="py-2 text-left">المتبقي (ر.ع.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staff_member_id} className="border-b border-slate-200">
              <td className="py-1.5 font-bold">{r.staff_name}</td>
              <td className="py-1.5">{r.shift_count}</td>
              <td className="py-1.5 text-left" dir="ltr">
                {formatOMR(fromDbAmount(r.earned_total))}
              </td>
              <td className="py-1.5 text-left" dir="ltr">
                {formatOMR(fromDbAmount(r.advances_total))}
              </td>
              <td className="py-1.5 text-left" dir="ltr">
                {formatOMR(fromDbAmount(r.payouts_total))}
              </td>
              <td className="py-1.5 text-left font-bold" dir="ltr">
                {formatOMR(fromDbAmount(r.balance_total))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-brand-700 font-black text-brand-900">
            <td className="py-2">الإجمالي ({rows.length})</td>
            <td className="py-2">
              {rows.reduce((n, r) => n + r.shift_count, 0)}
            </td>
            <td className="py-2 text-left" dir="ltr">
              {formatOMR(earned)}
            </td>
            <td className="py-2 text-left" dir="ltr">
              {formatOMR(advances)}
            </td>
            <td className="py-2 text-left" dir="ltr">
              {formatOMR(payouts)}
            </td>
            <td className="py-2 text-left" dir="ltr">
              {formatOMR(remaining)}
            </td>
          </tr>
        </tfoot>
      </table>
    </DocumentShell>
  );
}
