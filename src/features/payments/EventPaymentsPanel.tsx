import { useState, type FormEvent } from "react";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { VoidReasonPanel } from "@/components/ui/VoidReasonPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { PaymentMethod } from "@/lib/dbTypes";
import { useAuth } from "@/app/authContext";
import { buildDocumentIdentity } from "@/components/documents/documentIdentity";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { usePaymentReceipt } from "@/features/documents/documents.api";
import { PrintDocumentDialog } from "@/features/documents/PrintDocumentDialog";
import { PaymentReceipt } from "@/features/documents/PaymentReceipt";
import {
  paymentError,
  useEventFinance,
  useEventPayments,
  useRecordPayment,
  useVoidPayment,
} from "./payments.api";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "./presentation";
import { InlineError } from "@/components/ui/ErrorState";

/**
 * S6 Event Workspace integration seam: the customer financial layer for one
 * event. Reads are cost-gated server-side (cost.visibility) so operational
 * roles see nothing here; recording requires payment.record and voiding
 * payment.void, each enforced by the RPC itself with idempotency keys. The
 * `canRecord`/`canVoid` props only mirror that contract for the UI — hiding
 * is presentation, the database stays authoritative. No financial truth is
 * derived or duplicated in this component.
 */
export function EventPaymentsPanel({
  orgId,
  eventId,
  canReadCost,
  /** payment.record — the record-payment form (0079). */
  canRecord,
  /** payment.void — the void action on recorded payments (0079). */
  canVoid,
}: {
  orgId: string | null;
  eventId: string;
  canReadCost: boolean;
  canRecord: boolean;
  canVoid: boolean;
}) {
  const { currentOrganization } = useAuth();
  const finance = useEventFinance(orgId, eventId);
  const payments = useEventPayments(orgId, eventId);
  const recordPayment = useRecordPayment(orgId, eventId);
  const voidPayment = useVoidPayment(orgId, eventId);
  const settings = useOrganizationSettings(orgId);

  const [amountMilli, setAmountMilli] = useState<MilliOMR>(0);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const receipt = usePaymentReceipt(orgId, receiptFor);

  if (!canReadCost) {
    return (
      <EmptyState
        title="البيانات المالية غير متاحة لدورك"
        description="تظهر المدفوعات واقتصاديات المناسبة للمالك والمدير والمحاسب فقط."
      />
    );
  }

  if (finance.isLoading || payments.isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white" aria-busy="true">
        <Spinner />
        <span className="font-bold text-slate-600">جارٍ تحميل مدفوعات المناسبة…</span>
      </div>
    );
  }

  async function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!amountMilli || amountMilli <= 0) {
      setError("يرجى إدخال مبلغ صحيح أكبر من صفر");
      return;
    }
    try {
      await recordPayment.mutateAsync({
        amountMilli,
        method,
        reference,
        notes,
      });
      setAmountMilli(0);
      setReference("");
      setNotes("");
    } catch (cause) {
      setError(paymentError(cause));
    }
  }

  async function submitVoid(paymentId: string, reason: string) {
    setError("");
    try {
      await voidPayment.mutateAsync({ paymentId, reason });
      setVoiding(null);
    } catch (cause) {
      setError(paymentError(cause));
    }
  }

  const f = finance.data;
  const list = payments.data ?? [];

  return (
    <section aria-labelledby="event-payments-heading" className="space-y-5">
      <div>
        <h2 id="event-payments-heading" className="text-xl font-black">المدفوعات واقتصاديات المناسبة</h2>
        <p className="mt-1 text-slate-600">ما تم الاتفاق عليه، وما دُفع، وما تبقّى، وهامش المناسبة.</p>
      </div>

      {f && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card><CardBody>
            <p className="text-sm text-slate-500">الإيراد المقبول</p>
            <p className="text-2xl font-black">{formatOMR(f.acceptedRevenueMilli)}</p>
            <p className="mt-1 text-xs text-slate-400">وفق عرض السعر المعتمد</p>
          </CardBody></Card>
          <Card className="border-emerald-200"><CardBody>
            <p className="text-sm text-slate-500">المدفوع</p>
            <p className="text-2xl font-black">{formatOMR(f.amountPaidMilli)}</p>
          </CardBody></Card>
          <Card className={f.outstandingMilli > 0 ? "border-amber-300" : "border-emerald-200"}><CardBody>
            <p className="text-sm text-slate-500">المتبقي على العميل</p>
            <p className="text-2xl font-black">{formatOMR(f.outstandingMilli)}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-sm text-slate-500">التكلفة الملتزم بها</p>
            <p className="text-2xl font-black">{formatOMR(f.committedCostMilli)}</p>
            <p className="mt-1 text-xs text-slate-400">من طلبات التوريد النشطة</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-sm text-slate-500">التكلفة المسلّمة فعلياً</p>
            <p className="text-2xl font-black">{formatOMR(f.deliveredCostMilli)}</p>
          </CardBody></Card>
          <Card className={f.grossMarginMilli >= 0 ? "border-brand-200" : "border-red-300"}><CardBody>
            <p className="text-sm text-slate-500">الهامش الإجمالي الحالي</p>
            <p className="text-2xl font-black" dir="ltr">{formatOMR(f.grossMarginMilli)}</p>
          </CardBody></Card>
        </div>
      )}

      {error && <InlineError message={error} />}

      {canRecord && (
        <Card>
          <CardBody>
            <h3 className="mb-3 font-black">تسجيل دفعة من العميل</h3>
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submitPayment}>
              <MoneyInput
                id="payment-amount"
                label="المبلغ (ر.ع.)"
                value={amountMilli}
                onChange={(m) => setAmountMilli(m ?? 0)}
                required
              />
              <Field label="طريقة الدفع" htmlFor="payment-method" required>
                <Select id="payment-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="المرجع" htmlFor="payment-reference">
                <Input id="payment-reference" dir="ltr" placeholder="مثال: TRX-1234" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label="ملاحظات" htmlFor="payment-notes">
                <Input id="payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={recordPayment.isPending}>
                  {recordPayment.isPending ? "جارٍ الحفظ…" : "تسجيل الدفعة"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-black">سجل المدفوعات</h3>
        {list.length === 0 ? (
          <EmptyState title="لا توجد مدفوعات مسجّلة" description="ستظهر الدفعات هنا بعد تسجيلها." />
        ) : (
          <ul className="space-y-2">
            {list.map((p) => (
              <li key={p.id}>
                <Card className={p.status === "VOIDED" ? "opacity-70" : ""}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black" dir="ltr">{formatOMR(p.amountMilli)}</p>
                        <Badge tone={p.status === "VOIDED" ? "danger" : "success"}>
                          {p.status === "VOIDED" ? "ملغاة" : PAYMENT_METHOD_LABELS[p.method]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {new Date(p.paidAt).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
                        {p.reference ? ` · ${p.reference}` : ""}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </p>
                      {p.status === "VOIDED" && p.voidReason && (
                        <p className="mt-1 text-sm font-semibold text-red-600">سبب الإلغاء: {p.voidReason}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReceiptFor(p.id)}
                      >
                        <Printer className="h-4 w-4" />
                        سند القبض
                      </Button>
                      {p.status === "RECORDED" && canVoid && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={voidPayment.isPending}
                          onClick={() => setVoiding(p.id)}
                        >
                          إلغاء الدفعة
                        </Button>
                      )}
                    </div>
                    {voiding === p.id && (
                      <VoidReasonPanel
                        title="تأكيد إلغاء الدفعة"
                        description="الإلغاء لا يحذف الدفعة من السجل، بل يثبتها ملغاة بسبب موثق."
                        confirmLabel="تأكيد الإلغاء"
                        reasonLabel="سبب إلغاء الدفعة"
                        busy={voidPayment.isPending}
                        onConfirm={(reason) => void submitVoid(p.id, reason)}
                        onCancel={() => setVoiding(null)}
                      />
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PrintDocumentDialog
        open={receiptFor !== null}
        onOpenChange={(open) => {
          if (!open) setReceiptFor(null);
        }}
        title="سند قبض"
        description="السند من بيانات الدفع الرسمية — الدفعات الملغاة تُطبع بشارة إلغاء ولا تُعتمد."
      >
        {receipt.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner className="h-7 w-7" />
          </div>
        )}
        {receipt.data && (
          <PaymentReceipt
            identity={buildDocumentIdentity(
              currentOrganization,
              settings.data ?? null,
            )}
            row={receipt.data}
          />
        )}
        {receipt.data === null && !receipt.isLoading && (
          <EmptyState
            title="لا يوجد سند لهذه الدفعة"
            description="تأكد أنك ضمن المنشأة الصحيحة."
          />
        )}
      </PrintDocumentDialog>
    </section>
  );
}
