import { useState, type FormEvent } from "react";
import { InlineError } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { MoneyInput } from "@/components/MoneyInput";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatOMR, type MilliOMR } from "@/lib/money";
import {
  buildInstallmentSchedule,
  invoiceError,
  useCreateInvoice,
  useEventInstallments,
  useEventInvoice,
  useVoidInvoice,
  type InstallmentKind,
} from "./invoices.api";

const KIND_LABELS: Record<InstallmentKind, string> = {
  DEPOSIT: "العربون",
  INSTALLMENT: "قسط",
  FINAL: "القسط الأخير",
};

export function InvoicesPanel({
  orgId,
  eventId,
  eventNumber,
  canReadCost,
  canMutate,
  acceptedRevenueMilli,
}: {
  orgId: string | null;
  eventId: string;
  eventNumber: string;
  canReadCost: boolean;
  canMutate: boolean;
  /**
   * Exact milli-OMR of the accepted quotation, or `null` while the finance
   * read model is unresolved. Unknown must render as loading — a fabricated
   * 0 made this panel claim "no accepted quotation" during load.
   */
  acceptedRevenueMilli: number | null;
}) {
  const invoice = useEventInvoice(orgId, eventId);
  const installments = useEventInstallments(orgId, eventId);
  const createInvoice = useCreateInvoice(orgId, eventId);
  const voidInvoice = useVoidInvoice(orgId, eventId);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${eventNumber}`);
  const [depositMilli, setDepositMilli] = useState<MilliOMR>(0);
  const [count, setCount] = useState(2);
  const [firstDue, setFirstDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [intervalDays, setIntervalDays] = useState(30);

  const financeLoaded = acceptedRevenueMilli !== null;
  const totalMilli = (acceptedRevenueMilli ?? 0) as MilliOMR;
  const canIssue = canMutate && financeLoaded && totalMilli > 0;

  if (!canReadCost) {
    return (
      <EmptyState
        title="الفواتير غير متاحة لدورك"
        description="تظهر الفواتير والجدول المالي للمالك والمدير والمحاسب فقط."
      />
    );
  }

  const inv = invoice.data;
  const rows = installments.data ?? [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!invoiceNumber.trim()) {
      setError("يرجى إدخال رقم الفاتورة");
      return;
    }
    if (totalMilli <= 0) {
      setError("يجب اعتماد عرض سعر بقيمة أكبر من صفر قبل إصدار الفاتورة");
      return;
    }
    if (depositMilli < 0 || depositMilli > totalMilli) {
      setError("العربون يجب أن يكون بين صفر وقيمة الفاتورة");
      return;
    }
    if (count < 1) {
      setError("يجب تحديد قسط واحد على الأقل");
      return;
    }
    const schedule = buildInstallmentSchedule(totalMilli, depositMilli, count, firstDue, intervalDays);
    try {
      await createInvoice.mutateAsync({
        invoiceNumber: invoiceNumber.trim(),
        dueAt: null,
        totalMilli,
        installments: schedule,
        note: "",
      });
      setOpen(false);
    } catch (cause) {
      setError(invoiceError(cause));
    }
  }

  async function submitVoid() {
    if (!inv) return;
    const reason = window.prompt("سبب إلغاء الفاتورة");
    if (!reason || reason.trim().length < 3) return;
    setError("");
    try {
      await voidInvoice.mutateAsync({ invoiceId: inv.invoiceId, reason: reason.trim() });
    } catch (cause) {
      setError(invoiceError(cause));
    }
  }

  if (invoice.isLoading || !financeLoaded) {
    return <LoadingState label="جارٍ تحميل الفاتورة…" />;
  }

  if (!inv) {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">فاتورة العميل</h2>
            <p className="mt-1 text-slate-600">
              الفاتورة تُصدر بقيمة عرض السعر المعتمد؛ العربون والدفعات يكوّنان جدول التحصيل فقط.
            </p>
          </div>
          {canMutate && (
            <Button onClick={() => setOpen(true)} disabled={!canIssue || createInvoice.isPending}>
              إصدار فاتورة
            </Button>
          )}
        </div>
        {error && <InlineError message={error} />}
        {canMutate && totalMilli <= 0 && (
          <EmptyState
            title="لا يوجد عرض سعر معتمد قابل للفوترة"
            description="اعتمد عرض السعر أولاً؛ قاعدة البيانات ترفض أي فاتورة لا تطابق قيمته المعتمدة."
          />
        )}
        {!canMutate && (
          <EmptyState title="لا توجد فاتورة" description="لم يُصدر أي فاتورة لهذه المناسبة بعد." />
        )}

        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="إصدار فاتورة"
          description="قيمة الفاتورة ثابتة من عرض السعر المعتمد، ويمكنك فقط توزيعها على العربون والأقساط."
        >
          <form className="space-y-3" onSubmit={submit}>
            <Field label="رقم الفاتورة" htmlFor="inv-num" required>
              <Input id="inv-num" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
            </Field>
            <div className="rounded-xl border bg-slate-50 p-3">
              <p className="text-sm text-slate-500">قيمة الفاتورة من عرض السعر المعتمد</p>
              <p className="mt-1 text-xl font-black" dir="ltr">{formatOMR(totalMilli)}</p>
            </div>
            <MoneyInput id="inv-deposit" label="العربون (ر.ع.)" value={depositMilli} onChange={(m) => setDepositMilli(m ?? 0)} required />
            <div className="grid grid-cols-2 gap-3">
              <Field label="عدد الأقساط" htmlFor="inv-count">
                <Input id="inv-count" type="number" min="1" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="المدة بين الأقساط (يوم)" htmlFor="inv-interval">
                <Input id="inv-interval" type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </div>
            <Field label="تاريخ أول قسط" htmlFor="inv-firstdue" required>
              <Input id="inv-firstdue" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} required />
            </Field>
            {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button type="submit" disabled={!canIssue || createInvoice.isPending}>
                {createInvoice.isPending ? "جارٍ الإصدار…" : "إصدار الفاتورة"}
              </Button>
            </div>
          </form>
        </Dialog>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">فاتورة {inv.invoiceNumber}</h2>
          <p className="mt-1 text-slate-600">{inv.eventTitle}</p>
        </div>
        {canMutate && (
          <Button variant="outline" onClick={() => void submitVoid()} disabled={voidInvoice.isPending}>
            إلغاء الفاتورة
          </Button>
        )}
      </div>

      {error && <InlineError message={error} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody>
          <p className="text-sm text-slate-500">قيمة الفاتورة</p>
          <p className="text-2xl font-black" dir="ltr">{formatOMR(inv.totalMilli)}</p>
        </CardBody></Card>
        <Card className="border-emerald-200"><CardBody>
          <p className="text-sm text-slate-500">المحصَّل</p>
          <p className="text-2xl font-black" dir="ltr">{formatOMR(inv.paidMilli)}</p>
        </CardBody></Card>
        <Card className={inv.remainingMilli > 0 ? "border-amber-300" : "border-emerald-200"}><CardBody>
          <p className="text-sm text-slate-500">المتبقي</p>
          <p className="text-2xl font-black" dir="ltr">{formatOMR(inv.remainingMilli)}</p>
        </CardBody></Card>
      </div>

      <div>
        <h3 className="mb-3 font-black">جدول الدفعات</h3>
        {rows.length === 0 ? (
          <EmptyState title="لا يوجد جدول دفعات" description="لم يُعثر على جدول دفعات للفـاتورة الحالية." />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.installmentId}>
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-black">{KIND_LABELS[r.kind]}</p>
                        <Badge tone={r.effectiveStatus === "PAID" ? "success" : "warning"}>
                          {r.effectiveStatus === "PAID" ? "مدفوع" : "مستحق"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">استحقاق {r.dueDate}</p>
                    </div>
                    <p className="text-lg font-black" dir="ltr">{formatOMR(r.amountMilli)}</p>
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
