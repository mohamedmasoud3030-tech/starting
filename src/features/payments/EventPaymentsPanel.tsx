import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { PaymentMethod } from "@/lib/dbTypes";
import {
  paymentError,
  useEventFinance,
  useEventPayments,
  useRecordPayment,
  useVoidPayment,
} from "./payments.api";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "./presentation";

/**
 * S6 Event Workspace integration seam: the customer financial layer for one
 * event. Reads are cost-gated server-side (can_read_cost) so operational roles
 * see nothing here; mutations are OWNER/MANAGER/ACCOUNTANT server-authoritative
 * commands with idempotency keys. No financial truth is derived or duplicated
 * in this component — every figure comes from the authoritative read model.
 */
export function EventPaymentsPanel({
  orgId,
  eventId,
  canReadCost,
  canMutate,
}: {
  orgId: string | null;
  eventId: string;
  canReadCost: boolean;
  canMutate: boolean;
}) {
  const finance = useEventFinance(orgId, eventId);
  const payments = useEventPayments(orgId, eventId);
  const recordPayment = useRecordPayment(orgId, eventId);
  const voidPayment = useVoidPayment(orgId, eventId);

  const [amountMilli, setAmountMilli] = useState<MilliOMR>(0);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

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

  async function submitVoid(paymentId: string) {
    const reason = window.prompt("سبب إلغاء الدفعة");
    if (!reason || reason.trim().length < 3) return;
    setError("");
    try {
      await voidPayment.mutateAsync({ paymentId, reason: reason.trim() });
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

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{error}</p>}

      {canMutate && (
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
                    {p.status === "RECORDED" && canMutate && (
                      <Button
                        variant="outline"
                        disabled={voidPayment.isPending}
                        onClick={() => void submitVoid(p.id)}
                      >
                        إلغاء الدفعة
                      </Button>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
