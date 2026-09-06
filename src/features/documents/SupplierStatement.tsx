import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { dateOnly, sourceTypeLabel } from "@/features/accounting/presentation";
import type { SupplierStatementRow } from "@/features/accounting/accounting.api";

/**
 * Supplier statement (كشف حساب مورد) — the printable AP statement for one
 * supplier, built from the accounting read model (0096). Every figure
 * (debit / credit / running balance) is server-computed in the journal; the
 * document only renders it. The running balance is credit-normal: a positive
 * value is what the office still owes the supplier.
 */
export function SupplierStatement({
  identity,
  supplierName,
  asOf,
  rows,
}: {
  identity: DocumentIdentity;
  supplierName: string;
  asOf: string;
  rows: SupplierStatementRow[];
}) {
  const endingBalance = rows.length > 0 ? fromDbAmount(rows[rows.length - 1]!.running_balance) : 0;

  return (
    <DocumentShell
      identity={identity}
      title="كشف حساب مورد"
      dateText={dateOnly(asOf)}
      meta={
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">المورد: </span>
          <span className="font-bold">{supplierName}</span>
          <span className="mr-4 text-slate-500">حالة حتى: </span>
          <span className="font-bold">{dateOnly(asOf)}</span>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد حركات مسجّلة لهذا المورد.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-left">مدين (ر.ع.)</th>
              <th className="py-2 text-left">دائن (ر.ع.)</th>
              <th className="py-2 text-left">الرصيد المستحق</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-200 align-top">
                <td className="py-1.5 whitespace-nowrap">{dateOnly(r.entry_date)}</td>
                <td className="py-1.5">
                  <span className="font-bold">{sourceTypeLabel(r.source_type)}</span>
                  {r.is_reversal && <span className="mr-1 text-red-600">(إلغاء)</span>}
                  {r.document_number && (
                    <span dir="ltr" className="mr-1 font-semibold">
                      {r.document_number}
                    </span>
                  )}
                  {r.event_number && (
                    <span className="mr-1 text-slate-500">
                      {r.event_number}
                    </span>
                  )}
                  {r.memo && <span className="block text-slate-500">{r.memo}</span>}
                </td>
                <td className="py-1.5 text-left" dir="ltr">
                  {formatOMR(fromDbAmount(r.ap_debit))}
                </td>
                <td className="py-1.5 text-left" dir="ltr">
                  {formatOMR(fromDbAmount(r.ap_credit))}
                </td>
                <td className="py-1.5 text-left font-bold" dir="ltr">
                  {formatOMR(fromDbAmount(r.running_balance))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3">
        <span className="text-sm font-bold text-brand-900">الرصيد المستحق (ر.ع.)</span>
        <span dir="ltr" className="text-2xl font-black text-brand-900">
          {formatOMR(endingBalance)}
        </span>
      </div>
    </DocumentShell>
  );
}
