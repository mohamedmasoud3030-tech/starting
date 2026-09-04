import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/features/payments/presentation";
import type { PaymentReceiptRow } from "./documents.api";

function muhcatDate(value: string | null): string | null {
  return value
    ? new Date(value).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })
    : null;
}

/**
 * Payment receipt (سند قبض) — the printable proof of a customer payment.
 * A VOIDED payment renders with an explicit void banner and metadata: it is
 * never presented as a valid receipt (validity is the server status).
 */
export function PaymentReceipt({
  identity,
  row,
}: {
  identity: DocumentIdentity;
  row: PaymentReceiptRow;
}) {
  const voided = row.status === "VOIDED";

  return (
    <DocumentShell
      identity={identity}
      title={voided ? "سند قبض — ملغي" : "سند قبض"}
      documentNumber={row.receipt_number}
      dateText={muhcatDate(row.paid_at)}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">العميل: </span>
            <span className="font-bold">{row.customer_name}</span>
          </div>
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">
              {row.event_number}
              {row.event_title ? ` — ${row.event_title}` : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">طريقة الدفع: </span>
            <span className="font-bold">
              {PAYMENT_METHOD_LABELS[row.payment_method as keyof typeof PAYMENT_METHOD_LABELS] ?? row.payment_method}
            </span>
          </div>
          {row.reference && (
            <div>
              <span className="text-slate-500">المرجع: </span>
              <span dir="ltr" className="font-bold">
                {row.reference}
              </span>
            </div>
          )}
          {row.notes && (
            <div className="sm:col-span-2">
              <span className="text-slate-500">ملاحظات: </span>
              <span className="font-bold">{row.notes}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500">سجّلها: </span>
            <span className="font-bold">{row.recorded_by_name || "—"}</span>
          </div>
        </div>
      }
    >
      <div className="my-4 flex items-center justify-between rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3">
        <span className="text-sm font-bold text-brand-900">المبلغ المستلم (ر.ع.)</span>
        <span dir="ltr" className="text-2xl font-black text-brand-900">
          {formatOMR(fromDbAmount(row.amount))}
        </span>
      </div>

      {voided && (
        <div className="rounded-xl border-2 border-red-600 bg-red-50 p-3 text-sm font-bold leading-6 text-red-700">
          <p className="text-base">هذا السند ملغي ولا يُعتمد كدليل قبض.</p>
          {row.void_reason && <p>سبب الإلغاء: {row.void_reason}</p>}
          {row.voided_at && (
            <p>تاريخ الإلغاء: {muhcatDate(row.voided_at)}</p>
          )}
        </div>
      )}
    </DocumentShell>
  );
}
