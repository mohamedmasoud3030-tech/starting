import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, type MilliOMR } from "@/lib/money";
import { todayInMuscat } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/dbTypes";
import { PAYROLL_PAY_ROLES } from "@/lib/domain";
import { useAuth } from "@/app/authContext";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "@/features/payments/presentation";
import {
  attendanceError,
  useHostPayouts,
  useRecordAdvance,
  useRecordPayoutMulti,
  useStaffAdvances,
  type PayrollRow,
  type StaffMemberRow,
} from "./staff.api";

function useCanMutate(): boolean {
  // 0079: payouts/advances are gated server-side by payroll.pay.
  const { currentRole, capabilities } = useAuth();
  return capabilities !== null
    ? capabilities.has("payroll.pay")
    : !!currentRole && PAYROLL_PAY_ROLES.includes(currentRole);
}

/**
 * Advances & payouts operations for ONE host — shared by the staff list and
 * the staff profile page (ملف المضيف) so there is exactly one mutation UI for
 * these financial operations. Every write goes through the canonical payroll
 * commands; the printed sheets (payroll period / host statement) are OUTPUTS
 * of the same ledgers, never a source of truth.
 */
export function HostFinanceSection({
  orgId,
  staff,
  rows,
}: {
  orgId: string | null;
  staff: StaffMemberRow;
  rows: PayrollRow[];
}) {
  const canMutate = useCanMutate();
  const advances = useStaffAdvances(orgId, staff.id);
  const payouts = useHostPayouts(orgId, staff.id);
  const recordAdvance = useRecordAdvance(orgId);
  const recordPayout = useRecordPayoutMulti(orgId);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ADVANCE" | "PAYOUT">("PAYOUT");
  const [amountMilli, setAmountMilli] = useState<MilliOMR>(0);
  const [date, setDate] = useState(() => todayInMuscat());
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [allocations, setAllocations] = useState<Record<string, MilliOMR>>({});

  const unpaidEvents = rows.filter((r) => r.lateMilli > 0);
  const allocationTotal = unpaidEvents.reduce(
    (sum, r) => sum + (allocations[r.eventId] ?? 0),
    0 as MilliOMR,
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "ADVANCE") {
        if (!amountMilli || amountMilli <= 0) {
          setError("يرجى إدخال مبلغ صحيح أكبر من صفر");
          return;
        }
        await recordAdvance.mutateAsync({
          staffMemberId: staff.id,
          amountMilli,
          advanceDate: date,
          reason,
        });
      } else {
        const split = unpaidEvents
          .filter((r) => (allocations[r.eventId] ?? 0) > 0)
          .map((r) => ({ eventId: r.eventId, amountMilli: allocations[r.eventId] ?? 0 }));
        if (allocationTotal <= 0) {
          setError("حدد مبلغاً لمناسبة واحدة على الأقل");
          return;
        }
        await recordPayout.mutateAsync({
          staffMemberId: staff.id,
          amountMilli: allocationTotal,
          payoutDate: date,
          method,
          reference,
          reason,
          allocations: split,
          receipt: null,
        });
      }
      setOpen(false);
      setAmountMilli(0);
      setReference("");
      setReason("");
      setAllocations({});
    } catch (cause) {
      setError(attendanceError(cause));
    }
  }

  if (!canMutate) {
    return (
      <div className="space-y-2">
        <p className="font-bold text-slate-600">السلف والصرف</p>
        <p className="text-sm text-slate-500">صلاحيات مالية مطلوبة لعرض وتسجيل السلف والصرف.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          disabled={recordAdvance.isPending || recordPayout.isPending}
          onClick={() => setOpen(true)}
        >
          سلفة / صرف لمناسبات
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardBody>
            <p className="font-black">السلف العامة</p>
            {advances.data?.length ? (
              <ul className="mt-2 space-y-1">
                {advances.data.map((a) => (
                  <li key={a.id} className="flex justify-between text-sm">
                    <span>{a.advanceDate} · {a.reason ?? "—"}</span>
                    <span className={a.status === "VOIDED" ? "line-through opacity-60" : ""} dir="ltr">
                      {formatOMR(a.amountMilli)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">لا سلف مسجّلة.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="font-black">كل عمليات الصرف</p>
            {payouts.data?.length ? (
              <ul className="mt-2 space-y-1">
                {payouts.data.map((p) => (
                  <li key={p.id} className="flex justify-between text-sm">
                    <span>
                      {p.payoutDate} · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.eventNumber ? ` · ${p.eventNumber}` : " · متعدد / عام"}
                    </span>
                    <span className={p.status === "VOIDED" ? "line-through opacity-60" : ""} dir="ltr">
                      {formatOMR(p.amountMilli)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">لا صرف مسجّل.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={mode === "ADVANCE" ? "سلفة مضيف" : "صرف من مستحقات المناسبات"}
        description={
          mode === "ADVANCE"
            ? "السلفة تخص رصيد المضيف العام وتُخصم مرة واحدة."
            : "وزّع المبلغ على مناسبات المضيف غير المدفوعة؛ المجموع يساوي مبلغ الصرف تلقائياً."
        }
      >
        <form className="space-y-3" onSubmit={submit}>
          <Field label="نوع العملية" htmlFor="hf-mode">
            <Select id="hf-mode" value={mode} onChange={(e) => setMode(e.target.value as "ADVANCE" | "PAYOUT")}>
              <option value="PAYOUT">صرف من مستحقات المناسبات</option>
              <option value="ADVANCE">سلفة عامة</option>
            </Select>
          </Field>
          {mode === "PAYOUT" ? (
            unpaidEvents.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد مناسبات بمستحقات غير مدفوعة لهذا المضيف.</p>
            ) : (
              <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
                {unpaidEvents.map((r) => (
                  <div key={r.eventId} className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      {r.eventTitle ?? r.eventNumber ?? "—"}
                      <span className="text-slate-500"> · متبقي {formatOMR(r.lateMilli)}</span>
                    </span>
                    <MoneyInput
                      label=""
                      id={`hf-alloc-${r.eventId}`}
                      value={allocations[r.eventId] ?? 0}
                      onChange={(m) =>
                        setAllocations((prev) => ({ ...prev, [r.eventId]: m ?? 0 }))
                      }
                    />
                  </div>
                ))}
                <p className="pt-1 font-black">
                  إجمالي الصرف: <span dir="ltr">{formatOMR(allocationTotal)}</span>
                </p>
              </div>
            )
          ) : (
            <MoneyInput id="hf-amount" label="المبلغ (ر.ع.)" value={amountMilli} onChange={(m) => setAmountMilli(m ?? 0)} required />
          )}
          <Field label="التاريخ" htmlFor="hf-date" required>
            <Input id="hf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {mode === "PAYOUT" && (
            <Field label="طريقة الدفع" htmlFor="hf-method" required>
              <Select id="hf-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "PAYOUT" && (
            <Field label="المرجع" htmlFor="hf-ref">
              <Input id="hf-ref" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <Field label="سبب / ملاحظات" htmlFor="hf-reason">
            <Input id="hf-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={recordAdvance.isPending || recordPayout.isPending}>حفظ</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
