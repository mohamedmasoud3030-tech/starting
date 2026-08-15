import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/app/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { PaymentMethod } from "@/lib/dbTypes";
import { COST_READER_ROLES, PAYMENT_WRITE_ROLES } from "@/lib/domain";
import {
  attendanceError,
  useHostPayouts,
  useOrgPayrollArchive,
  useOrgStaffMembers,
  useRecordAdvance,
  useRecordPayout,
  useStaffAdvances,
  type PayrollRow,
  type StaffMemberRow,
} from "./staff.api";
import { STAFF_TYPE_LABELS } from "./labels";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "@/features/payments/presentation";

interface Totals {
  dueMilli: MilliOMR;
  paidMilli: MilliOMR;
  lateMilli: MilliOMR;
  advancesMilli: MilliOMR;
  payoutsMilli: MilliOMR;
  events: number;
}

function HostDetail({ orgId, staff }: { orgId: string | null; staff: StaffMemberRow }) {
  const canMutate = useCanMutate();
  const advances = useStaffAdvances(orgId, staff.id);
  const payouts = useHostPayouts(orgId, staff.id);
  const recordAdvance = useRecordAdvance(orgId);
  const recordPayout = useRecordPayout(orgId);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ADVANCE" | "PAYOUT">("PAYOUT");
  const [amountMilli, setAmountMilli] = useState<MilliOMR>(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!amountMilli || amountMilli <= 0) {
      setError("يرجى إدخال مبلغ صحيح أكبر من صفر");
      return;
    }
    try {
      if (mode === "ADVANCE") {
        await recordAdvance.mutateAsync({ staffMemberId: staff.id, amountMilli, advanceDate: date, reason });
      } else {
        await recordPayout.mutateAsync({
          staffMemberId: staff.id,
          eventId: null,
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
      <div className="space-y-2">
        <p className="font-bold text-slate-600">السلف والصرف</p>
        <p className="text-sm text-slate-500">صلاحيات مالية مطلوبة لعرض وتسجيل السلف والصرف.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)} disabled={recordAdvance.isPending || recordPayout.isPending}>
          سلفة / صرف
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardBody>
            <p className="font-black">السلف</p>
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
            <p className="font-black">الصرف</p>
            {payouts.data?.length ? (
              <ul className="mt-2 space-y-1">
                {payouts.data.map((p) => (
                  <li key={p.id} className="flex justify-between text-sm">
                    <span>{p.payoutDate} · {PAYMENT_METHOD_LABELS[p.method]}</span>
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

      <Dialog open={open} onOpenChange={setOpen} title={mode === "ADVANCE" ? "سلفة مضيف" : "صرف لمضيف"}>
        <form className="space-y-3" onSubmit={submit}>
          <Field label="نوع العملية" htmlFor="d-mode">
            <Select id="d-mode" value={mode} onChange={(e) => setMode(e.target.value as "ADVANCE" | "PAYOUT")}>
              <option value="PAYOUT">صرف (مدفوع)</option>
              <option value="ADVANCE">سلفة</option>
            </Select>
          </Field>
          <MoneyInput id="d-amount" label="المبلغ (ر.ع.)" value={amountMilli} onChange={(m) => setAmountMilli(m ?? 0)} required />
          <Field label="التاريخ" htmlFor="d-date" required>
            <Input id="d-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {mode === "PAYOUT" && (
            <Field label="طريقة الدفع" htmlFor="d-method" required>
              <Select id="d-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "PAYOUT" && (
            <Field label="المرجع" htmlFor="d-ref">
              <Input id="d-ref" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <Field label="سبب / ملاحظات" htmlFor="d-reason">
            <Input id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={recordAdvance.isPending || recordPayout.isPending}>حفظ</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function useCanMutate(): boolean {
  const { currentRole } = useAuth();
  return !!currentRole && PAYMENT_WRITE_ROLES.includes(currentRole);
}

export function StaffPage() {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const canReadCost = !!currentRole && COST_READER_ROLES.includes(currentRole);
  const staff = useOrgStaffMembers(orgId);
  const archive = useOrgPayrollArchive(orgId);
  const [expanded, setExpanded] = useState<string | null>(null);

  const byStaff = useMemo(() => {
    const map = new Map<string, { rows: PayrollRow[]; totals: Totals }>();
    for (const r of archive.data ?? []) {
      const cur = map.get(r.staffMemberId) ?? {
        rows: [],
        totals: { dueMilli: 0, paidMilli: 0, lateMilli: 0, advancesMilli: 0, payoutsMilli: 0, events: 0 },
      };
      cur.rows.push(r);
      cur.totals.dueMilli += r.dueMilli;
      cur.totals.paidMilli += r.paidMilli;
      cur.totals.lateMilli += r.lateMilli;
      cur.totals.advancesMilli += r.advancesMilli;
      cur.totals.payoutsMilli += r.payoutsMilli;
      cur.totals.events += 1;
      map.set(r.staffMemberId, cur);
    }
    return map;
  }, [archive.data]);

  if (!canReadCost) {
    return (
      <div className="space-y-4">
        <PageHeader title="المضيفون والأجور" description="سجل أجور المضيفين والسلف والصرف." />
        <EmptyState title="البيانات المالية غير متاحة لدورك" description="تظهر أجور المضيفين للمالك والمدير والمحاسب فقط." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="المضيفون والأجور" description="أرشيف كامل لكل مضيف: المستحق والمدفوع والمتأخر والسلف." />
      {staff.isLoading ? (
        <p>جارٍ التحميل…</p>
      ) : (staff.data ?? []).length === 0 ? (
        <EmptyState title="لا يوجد مضيفون" description="أضف المضيفين من تبويب الفريق في المناسبة." />
      ) : (
        <ul className="space-y-2">
          {(staff.data ?? []).map((s) => {
            const agg = byStaff.get(s.id);
            const t = agg?.totals;
            const open = expanded === s.id;
            return (
              <li key={s.id}>
                <Card>
                  <CardBody>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-3 text-right"
                      onClick={() => setExpanded(open ? null : s.id)}
                      aria-expanded={open}
                    >
                      <div>
                        <p className="text-lg font-black">{s.name}</p>
                        <p className="text-sm text-slate-500">{STAFF_TYPE_LABELS[s.staffType] ?? s.staffType}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span>مستحق <b dir="ltr">{formatOMR(t?.dueMilli ?? 0)}</b></span>
                        <span>سلف <b dir="ltr">{formatOMR(t?.advancesMilli ?? 0)}</b></span>
                        <span>مدفوع <b dir="ltr">{formatOMR(t?.payoutsMilli ?? 0)}</b></span>
                        <Badge tone={(t?.lateMilli ?? 0) > 0 ? "warning" : "success"}>
                          متأخر <span dir="ltr">{formatOMR(t?.lateMilli ?? 0)}</span>
                        </Badge>
                      </div>
                    </button>
                    {open && agg && (
                      <div className="mt-4 space-y-3 border-t pt-4">
                        <div>
                          <p className="font-black">الأجور لكل مناسبة</p>
                          {agg.rows.length ? (
                            <ul className="mt-2 space-y-1">
                              {agg.rows.map((r) => (
                                <li key={`${r.staffMemberId}-${r.eventId}`} className="flex flex-wrap justify-between gap-2 text-sm">
                                  <span>{r.eventTitle ?? r.eventNumber ?? "—"}</span>
                                  <span className="text-slate-500">
                                    {r.attendanceCount} وردية
                                  </span>
                                  <span dir="ltr">مستحق {formatOMR(r.dueMilli)} · متأخر {formatOMR(r.lateMilli)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">لا أوراق حضور بعد.</p>
                          )}
                        </div>
                        <HostDetail orgId={orgId} staff={s} />
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
