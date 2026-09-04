import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount, type MilliOMR } from "@/lib/money";
import type { CustomerStatementRow } from "./documents.api";

function dateOnly(value: string): string {
  return new Date(value).toLocaleDateString("ar-OM", {
    timeZone: "Asia/Muscat",
  });
}

/**
 * Customer statement (كشف حساب عميل): the customer's charge and payment
 * movements in order with a running balance, ending with the canonical
 * outstanding figure (from customer_360 — never re-summed from the rows).
 *
 * Amounts are rendered positive; the sign is carried by the column (debit
 * for charges, credit for payments) so a pen-and-paper reader never has to
 * interpret signs.
 */
export function CustomerStatement({
  identity,
  customerName,
  asOf,
  rows,
  outstanding,
}: {
  identity: DocumentIdentity;
  customerName: string;
  asOf: string;
  rows: CustomerStatementRow[];
  /** Canonical outstanding OMR from customer_360 (nullable while unknown). */
  outstanding: string | number | null;
}) {
  let running: MilliOMR = 0;
  const withBalance = rows.map((r) => {
    const amount = fromDbAmount(r.amount);
    if (r.row_kind === "CHARGE") running += amount;
    else running -= amount;
    return { r, amount, running };
  });

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
      {withBalance.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد حركات مسجّلة لهذا العميل.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-left">مدين (ر.ع.)</th>
              <th className="py-2 text-left">دائن (ر.ع.)</th>
              <th className="py-2 text-left">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map(({ r, amount, running: balance }, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="py-1.5 whitespace-nowrap">{dateOnly(r.occurred_at)}</td>
                <td className="py-1.5">
                  {r.row_kind === "CHARGE" ? (
                    <>
                      <span className="font-bold">{r.event_number}</span>
                      {r.event_title ? ` — ${r.event_title}` : ""}
                    </>
                  ) : (
                    <>
                      دفعة{r.reference ? ` (${r.reference})` : ""}
                      {r.notes ? ` — ${r.notes}` : ""}
                    </>
                  )}
                </td>
                <td className="py-1.5 text-left" dir="ltr">
                  {r.row_kind === "CHARGE" ? formatOMR(amount) : "—"}
                </td>
                <td className="py-1.5 text-left" dir="ltr">
                  {r.row_kind === "PAYMENT" ? formatOMR(amount) : "—"}
                </td>
                <td className="py-1.5 text-left font-bold" dir="ltr">
                  {formatOMR(balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3">
        <span className="text-sm font-bold text-brand-900">
          المتبقي المستحق (ر.ع.)
        </span>
        <span dir="ltr" className="text-2xl font-black text-brand-900">
          {outstanding === null ? "—" : formatOMR(fromDbAmount(outstanding))}
        </span>
      </div>
    </DocumentShell>
  );
}
