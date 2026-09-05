import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { dateOnly, sourceTypeLabel } from "@/features/accounting/presentation";
import type {
  CustomerStatementRow,
  StatementAllocation,
} from "@/features/accounting/accounting.api";

/**
 * Accounting customer statement (كشف حساب عميل) — the §20 Stage-3
 * accounting-enhanced statement, distinct from the 0080 commercial statement.
 * Impact/running outstanding come from the journal (the §17 outstanding
 * identity), and rows whose source document participates in a payment
 * allocation carry the authoritative gross/net/VAT allocation detail.
 */
export function AccountingCustomerStatement({
  identity,
  customerName,
  asOf,
  rows,
}: {
  identity: DocumentIdentity;
  customerName: string;
  asOf: string;
  rows: CustomerStatementRow[];
}) {
  const endingBalance =
    rows.length > 0 ? fromDbAmount(rows[rows.length - 1]!.running_outstanding) : 0;

  return (
    <DocumentShell
      identity={identity}
      title="كشف حساب عميل"
      dateText={dateOnly(asOf)}
      meta={
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">العميل: </span>
          <span className="font-bold">{customerName}</span>
          <span className="mr-4 text-slate-500">حالة حتى: </span>
          <span className="font-bold">{dateOnly(asOf)}</span>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد حركات محاسبية مسجّلة لهذا العميل.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-left">التأثير (ر.ع.)</th>
              <th className="py-2 text-left">الرصيد الجاري</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <StatementRow key={i} row={r} />
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3">
        <span className="text-sm font-bold text-brand-900">الرصيد الجاري (ر.ع.)</span>
        <span dir="ltr" className="text-2xl font-black text-brand-900">
          {formatOMR(endingBalance)}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        الرصيد الموجب يعني مبلغاً مستحقاً على العميل، والسالب يعني دفعة مقدمة
        صافية (عربون يزيد عن المستحق). التأثير الموجب يزيد الرصيد (فاتورة أو
        إثبات إيراد)، والسالب يخفضه (دفعة أو تطبيق عربون).
      </p>
    </DocumentShell>
  );
}

function StatementRow({ row }: { row: CustomerStatementRow }) {
  return (
    <>
      <tr className="border-b border-slate-200 align-top">
        <td className="py-1.5 whitespace-nowrap">{dateOnly(row.entry_date)}</td>
        <td className="py-1.5">
          <span className="font-bold">{sourceTypeLabel(row.source_type)}</span>
          {row.is_reversal && <span className="mr-1 text-red-600">(إلغاء)</span>}
          {row.document_number && (
            <span dir="ltr" className="mr-1 font-semibold">
              {row.document_number}
            </span>
          )}
          {row.event_number && (
            <span className="mr-1 text-slate-500">{row.event_number}</span>
          )}
          {row.memo && <span className="block text-slate-500">{row.memo}</span>}
        </td>
        <td className="py-1.5 text-left" dir="ltr">
          {formatOMR(fromDbAmount(row.impact_on_outstanding))}
        </td>
        <td className="py-1.5 text-left font-bold" dir="ltr">
          {formatOMR(fromDbAmount(row.running_outstanding))}
        </td>
      </tr>
      {row.allocations && row.allocations.length > 0 && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td className="py-1.5" />
          <td colSpan={3} className="py-1.5">
            <p className="text-xs font-bold text-slate-500">تفاصيل التخصيص:</p>
            {row.allocations.map((a, j) => (
              <AllocationLine key={j} allocation={a} />
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function AllocationLine({ allocation }: { allocation: StatementAllocation }) {
  const label = [
    allocation.payment_reference
      ? `دفعة ${allocation.payment_reference}`
      : null,
    allocation.invoice_number
      ? `فاتورة ${allocation.invoice_number}`
      : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-xs text-slate-600">
      <span dir="ltr">{label || "تخصيص"}</span>
      <span dir="ltr">
        الإجمالي {formatOMR(fromDbAmount(allocation.gross_amount))} · الصافي{" "}
        {formatOMR(fromDbAmount(allocation.net_amount))} · الضريبة{" "}
        {formatOMR(fromDbAmount(allocation.vat_amount))}
      </span>
    </div>
  );
}
