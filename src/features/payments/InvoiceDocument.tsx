import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR } from "@/lib/money";
import { FINANCE_LABELS } from "@/lib/financeLabels";
import type { InvoiceSummary, InstallmentSummary } from "./invoices.api";

const KIND_LABELS: Record<string, string> = {
  DEPOSIT: "العربون",
  INSTALLMENT: "قسط",
  FINAL: "القسط الأخير",
};

export function InvoiceDocument({
  identity,
  invoice,
  installments,
  customerName,
}: {
  identity: DocumentIdentity;
  invoice: InvoiceSummary;
  installments: ReadonlyArray<InstallmentSummary>;
  customerName?: string | null;
}) {
  return (
    <DocumentShell
      identity={identity}
      title="فاتورة"
      documentNumber={invoice.invoiceNumber}
      dateText={new Date(invoice.issuedAt).toLocaleDateString("ar-OM", {
        timeZone: "Asia/Muscat",
      })}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">{invoice.eventTitle}</span>
            {" · "}
            <span dir="ltr">{invoice.eventNumber}</span>
          </div>
          {customerName && (
            <div>
              <span className="text-slate-500">العميل: </span>
              <span className="font-bold">{customerName}</span>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex justify-between font-black">
          <span>{FINANCE_LABELS.agreed}</span>
          <span>{formatOMR(invoice.totalMilli)}</span>
        </div>
        {invoice.vatRegistered && (
          <p className="text-sm text-slate-600">
            يشمل ضريبة {invoice.vatPercent}% بقيمة {formatOMR(invoice.vatAmountMilli)}
          </p>
        )}
        <div className="flex justify-between text-sm">
          <span>{FINANCE_LABELS.collected}</span>
          <span className="font-bold">{formatOMR(invoice.paidMilli)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{FINANCE_LABELS.remaining}</span>
          <span className="font-bold">{formatOMR(invoice.remainingMilli)}</span>
        </div>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-right">
              <th className="py-2 font-black">الدفعة</th>
              <th className="py-2 font-black">الاستحقاق</th>
              <th className="py-2 text-left font-black">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((row) => (
              <tr key={row.installmentId} className="border-b border-slate-100">
                <td className="py-2">{KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className="py-2">{row.dueDate}</td>
                <td className="py-2 text-left font-bold">{formatOMR(row.amountMilli)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DocumentShell>
  );
}
