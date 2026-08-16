import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { PaymentMethod } from "@/lib/dbTypes";
import {
  attendanceError,
  useEventPayroll,
  useRecordAdvance,
  useRecordPayout,
} from "./staff.api";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "@/features/payments/presentation";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

export function HostPayrollPanel({
  orgId,
  eventId,
  canMutate,
}: {
  orgId: string | null;
  eventId: string;
  canMutate: boolean;
}) {
  const payroll = useEventPayroll(orgId, eventId);
  const recordAdvance = useRecordAdvance(orgId);
  const recordPayout = useRecordPayout(orgId);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"ADVANCE" | "PAYOUT">("PAYOUT");
  const [staffMemberId, setStaffMemberId] = useState("");
  const [amountMilli, setAmountMilli] = useState<MilliOMR>(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const rows = payroll.data ?? [];
  const assignedHostOptions = rows.map((r) => ({ id: r.staffMemberId, name: r.staffName }));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!staffMemberId) {
      setError("يرجى اختيار مضيف");
      return;
    }
    if (!amountMilli || amountMilli <= 0) {
      setError("يرجى إدخال مبلغ صحيح أكبر من صفر");
      return;
    }
    try {
      if (mode === "ADVANCE") {
        await recordAdvance.mutateAsync({
          staffMemberId,
          amountMilli,
          advanceDate: date,
          reason,
        });
      } else {
        await recordPayout.mutateAsync({
          staffMemberId,
          eventId,
          amountMilli,
          payoutDate: date,
          method,
          reference,
          reason,
        });
      }
      setOpen(false);
      setAmountMilli(0);
      setReference("");
      setReason("");
    } catch (cause) {
      setError(attendanceError(cause));
    }
  }

  if (!canMutate) {
    return (
      <EmptyState
        title="صلاحيات مالية مطلوبة"
        description="تظهر أجور المضيفين والسلف والصرف للمالك والمدير والمحاسب فقط."
      />
    );
  }

  return (
    <section aria-labelledby="payroll-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="payroll-heading" className="text-xl font-black">أجور المضيفين</h2>
          <p className="mt-1 text-slate-600">
            المستحق والمدفوع والمتبقي لهذه المناسبة. السلف تُسجّل على رصيد المضيف العام ولا تُكرر على كل مناسبة.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={recordPayout.isPending || recordAdvance.isPending}>
          سلفة / صرف
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {payroll.isLoading ? (
        <LoadingState label="جارٍ تحميل الأجور…" />
      ) : rows.length === 0 ? (
        <EmptyState title="لا يوجد مضيفون مسجّلون حضوراً" description="سجّل حضور المضيفين أولاً لعرض أجورهم." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={`${r.staffMemberId}-${r.eventId}`}>
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-lg font-black">{r.staffName}</p>
                    <p className="text-sm text-slate-500">
                      {r.attendanceCount} وردية · {r.eventNumber ?? "—"}
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-sm text-slate-500">المستحق للمناسبة</p>
                      <p className="text-lg font-black" dir="ltr">{formatOMR(r.dueMilli)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">المدفوع للمناسبة</p>
                      <p className="text-lg font-black" dir="ltr">{formatOMR(r.payoutsMilli)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">المتبقي للمناسبة</p>
                      <Badge tone={r.lateMilli > 0 ? "warning" : "success"}>
                        <span dir="ltr">{formatOMR(r.lateMilli)}</span>
                      </Badge>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={mode === "ADVANCE" ? "سلفة مضيف" : "صرف لمضيف"}
        description={
          mode === "ADVANCE"
            ? "السلفة تخص رصيد المضيف العام وتُخصم مرة واحدة من إجمالي مستحقاته، وليست من هذه المناسبة وحدها."
            : "مبلغ يُسدَّد فعلياً للمضيف عن هذه المناسبة."
        }
      >
        <form className="space-y-3" onSubmit={submit}>
          <Field label="نوع العملية" htmlFor="pay-mode">
            <Select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value as "ADVANCE" | "PAYOUT")}>
              <option value="PAYOUT">صرف للمناسبة (مدفوع)</option>
              <option value="ADVANCE">سلفة عامة للمضيف</option>
            </Select>
          </Field>
          <Field label="المضيف" htmlFor="pay-staff" required>
            <Select id="pay-staff" value={staffMemberId} onChange={(e) => setStaffMemberId(e.target.value)} required>
              <option value="">اختر المضيف</option>
              {assignedHostOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <MoneyInput id="pay-amount" label="المبلغ (ر.ع.)" value={amountMilli} onChange={(m) => setAmountMilli(m ?? 0)} required />
          <Field label="التاريخ" htmlFor="pay-date" required>
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {mode === "PAYOUT" && (
            <Field label="طريقة الدفع" htmlFor="pay-method" required>
              <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "PAYOUT" && (
            <Field label="المرجع" htmlFor="pay-ref">
              <Input id="pay-ref" dir="ltr" placeholder="مثال: TRX-1234" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <Field label="سبب / ملاحظات" htmlFor="pay-reason">
            <Input id="pay-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>

          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={recordPayout.isPending || recordAdvance.isPending}>
              {recordPayout.isPending || recordAdvance.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
