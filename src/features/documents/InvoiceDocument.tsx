import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR } from "@/lib/money";
import type { InvoiceSummary, InstallmentSummary } from "@/features/payments/invoices.api";

const EFFECTIVE_LABELS: Record<string, string> = {
  PAID: "مسدّد",
  PENDING: "مستحق",
  CANCELLED: "ملغي",
};

function dateOnly(value: string | null): string | null {
  return value
    ? new Date(value).toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" })
    : null;
}

/**
 * Printable invoice (فاتورة) built from the authoritative invoice read
 * model — never from client-side recomputation. Carries the VAT snapshot
 * frozen at issue time, the installment plan, and the collected/remaining
 * totals. A voided invoice renders with an explicit void banner.
 */
export function InvoiceDocument({
  identity,
  invoice,
  installments,
  customerName,
}: {
  identity: DocumentIdentity;
  invoice: InvoiceSummary;
  installments: InstallmentSummary[];
  customerName: string | null;
}) {
  const voided = invoice.status === "CANCELLED";

  return (
    <DocumentShell
      identity={identity}
      title={voided ? "فاتورة — ملغاة" : "فاتورة"}
      documentNumber={invoice.invoiceNumber}
      dateText={dateOnly(invoice.issuedAt)}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">العميل: </span>
            <span className="font-bold">{customerName ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">
              {invoice.eventNumber}
              {invoice.eventTitle ? ` — ${invoice.eventTitle}` : ""}
            </span>
          </div>
          {invoice.dueAt && (
            <div>
              <span className="text-slate-500">تاريخ الاستحقاق: </span>
              <span className="font-bold">{dateOnly(invoice.dueAt)}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500">الحالة: </span>
            <span className="font-bold">{voided ? "ملغاة" : "صادرة"}</span>
          </div>
          {invoice.note && (
            <div className="sm:col-span-2">
              <span className="text-slate-500">ملاحظات: </span>
              <span className="font-bold">{invoice.note}</span>
            </div>
          )}
        </div>
      }
    >
      <div className="mt-4 space-y-1 rounded-xl border border-slate-300 px-4 py-3 text-sm">
        {invoice.vatRegistered ? (
          <>
            <div className="flex justify-between">
              <span>الإجمالي قبل الضريبة (ر.ع.)</span>
              <span dir="ltr" className="font-bold">
                {formatOMR(invoice.preVatMilli)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>
                ضريبة القيمة المضافة {invoice.vatPercent}%
                {invoice.vatRegistrationNumber ? ` (س.ض ${invoice.vatRegistrationNumber})` : ""}
              </span>
              <span dir="ltr" className="font-bold">
                {formatOMR(invoice.vatAmountMilli)}
              </span>
            </div>
          </>
        ) : null}
        <div className="flex justify-between border-t border-slate-300 pt-1 text-base">
          <span className="font-black">الإجمالي المستحق (ر.ع.)</span>
          <span dir="ltr" className="font-black">
            {formatOMR(invoice.totalMilli)}
          </span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>المسدد (ر.ع.)</span>
          <span dir="ltr" className="font-bold">
            {formatOMR(invoice.paidMilli)}
          </span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>المتبقي (ر.ع.)</span>
          <span dir="ltr" className="font-bold">
            {formatOMR(invoice.remainingMilli)}
          </span>
        </div>
      </div>

      {installments.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-right">القسط</th>
              <th className="py-2 text-right">الاستحقاق</th>
              <th className="py-2 text-left">المبلغ (ر.ع.)</th>
              <th className="py-2 text-left">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((i) => (
              <tr key={i.installmentId} className="border-b border-slate-200">
                <td className="py-1.5">
                  {i.kind === "DEPOSIT"
                    ? "العربون"
                    : i.kind === "FINAL"
                      ? "القسط الأخير"
                      : `قسط ${i.seq}`}
                </td>
                <td className="py-1.5 whitespace-nowrap">
                  {dateOnly(i.dueDate) ?? "—"}
                </td>
                <td className="py-1.5 text-left" dir="ltr">
                  {formatOMR(i.amountMilli)}
                </td>
                <td className="py-1.5 text-left">
                  {EFFECTIVE_LABELS[i.effectiveStatus] ?? i.effectiveStatus}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {voided && (
        <div className="mt-4 rounded-xl border-2 border-red-600 bg-red-50 p-3 text-sm font-bold leading-6 text-red-700">
          <p className="text-base">هذه الفاتورة ملغاة ولا تُعتمد.</p>
          {invoice.voidReason && <p>سبب الإلغاء: {invoice.voidReason}</p>}
        </div>
      )}
    </DocumentShell>
  );
}
