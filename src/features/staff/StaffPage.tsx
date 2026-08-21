import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/app/authContext";
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
import { todayInMuscat } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/dbTypes";
import { COST_READER_ROLES, PAYMENT_WRITE_ROLES } from "@/lib/domain";
import {
  attendanceError,
  useHostPayouts,
  useOrgPayrollArchive,
  useOrgStaffMembers,
  useRecordAdvance,
  useRecordPayoutMulti,
  useStaffAdvances,
  type PayrollRow,
  type StaffMemberRow,
} from "./staff.api";
import { STAFF_TYPE_LABELS } from "./labels";
import { StaffMemberDialog } from "./StaffMemberDialog";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "@/features/payments/presentation";

function HostDetail({
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
        <Button size="sm" onClick={() => setOpen(true)} disabled={recordAdvance.isPending || recordPayout.isPending}>
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
          <Field label="نوع العملية" htmlFor="d-mode">
            <Select id="d-mode" value={mode} onChange={(e) => setMode(e.target.value as "ADVANCE" | "PAYOUT")}>
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
                      id={`alloc-${r.eventId}`}
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
            <MoneyInput id="d-amount" label="المبلغ (ر.ع.)" value={amountMilli} onChange={(m) => setAmountMilli(m ?? 0)} required />
          )}
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

function StaffSummaryCard({
  orgId,
  staff,
  rows,
  open,
  onToggle,
  onEdit,
}: {
  orgId: string | null;
  staff: StaffMemberRow;
  rows: PayrollRow[];
  open: boolean;
  onToggle: () => void;
  onEdit: (staff: StaffMemberRow) => void;
}) {
  // Event rows are intentionally event-scoped. Staff advances are a global
  // ledger and global payouts may have event_id=NULL, so aggregate those ledgers
  // exactly once here instead of summing them once per event.
  const advances = useStaffAdvances(orgId, staff.id);
  const payouts = useHostPayouts(orgId, staff.id);

  const dueMilli = rows.reduce((sum, row) => sum + row.dueMilli, 0 as MilliOMR);
  const advancesMilli = (advances.data ?? [])
    .filter((row) => row.status === "RECORDED")
    .reduce((sum, row) => sum + row.amountMilli, 0 as MilliOMR);
  const payoutsMilli = (payouts.data ?? [])
    .filter((row) => row.status === "RECORDED")
    .reduce((sum, row) => sum + row.amountMilli, 0 as MilliOMR);
  const paidMilli = (advancesMilli + payoutsMilli) as MilliOMR;
  const lateMilli = (dueMilli - paidMilli) as MilliOMR;
  const ledgersLoading = advances.isLoading || payouts.isLoading;

  return (
    <Card>
      <CardBody>
        <div className="flex w-full items-center justify-between gap-2">
          <button
            type="button"
            className="flex flex-1 flex-wrap items-center justify-between gap-3 text-right"
            onClick={onToggle}
            aria-expanded={open}
          >
            <div>
              <p className="text-lg font-black">{staff.name}</p>
              <p className="text-sm text-slate-500">{STAFF_TYPE_LABELS[staff.staffType] ?? staff.staffType}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>مستحق <b dir="ltr">{formatOMR(dueMilli)}</b></span>
              <span>سلف <b dir="ltr">{ledgersLoading ? "…" : formatOMR(advancesMilli)}</b></span>
              <span>صرف <b dir="ltr">{ledgersLoading ? "…" : formatOMR(payoutsMilli)}</b></span>
              <Badge tone={!ledgersLoading && lateMilli > 0 ? "warning" : "success"}>
                متبقي <span dir="ltr">{ledgersLoading ? "…" : formatOMR(lateMilli)}</span>
              </Badge>
            </div>
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(staff)}
            aria-label={`تعديل بيانات ${staff.name}`}
          >
            تعديل
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <div>
              <p className="font-black">الأجور لكل مناسبة</p>
              {rows.length ? (
                <ul className="mt-2 space-y-1">
                  {rows.map((r) => (
                    <li key={`${r.staffMemberId}-${r.eventId}`} className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>{r.eventTitle ?? r.eventNumber ?? "—"}</span>
                      <span className="text-slate-500">{r.attendanceCount} وردية</span>
                      <span dir="ltr">
                        مستحق {formatOMR(r.dueMilli)} · مدفوع للمناسبة {formatOMR(r.payoutsMilli)} · متبقي {formatOMR(r.lateMilli)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">لا أوراق حضور بعد.</p>
              )}
            </div>
            <HostDetail orgId={orgId} staff={staff} rows={rows} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function StaffPage() {
  const { currentOrganization, currentRole, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const canReadCost = !!currentRole && COST_READER_ROLES.includes(currentRole);
  const staff = useOrgStaffMembers(orgId);
  const archive = useOrgPayrollArchive(orgId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMemberRow | null>(null);

  const byStaff = useMemo(() => {
    const map = new Map<string, PayrollRow[]>();
    for (const row of archive.data ?? []) {
      const rows = map.get(row.staffMemberId) ?? [];
      rows.push(row);
      map.set(row.staffMemberId, rows);
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
      <PageHeader
        title="المضيفون والأجور"
        description="هنا الأجور والسلف والصرف. تسجيل الشغل يتم من داخل المناسبة بزر دخول الآن / خروج الآن."
        actions={
          canManageCommercial ? (
            <Button
              onClick={() => {
                setEditing(null);
                setRosterOpen(true);
              }}
            >
              <Plus className="h-5 w-5" />
              مضيف جديد
            </Button>
          ) : undefined
        }
      />
      {staff.isLoading || archive.isLoading ? (
        <p>جارٍ التحميل…</p>
      ) : (staff.data ?? []).length === 0 ? (
        <EmptyState
          title="لا يوجد مضيفون"
          description="أضف أول مضيف لبدء إسناد الفريق وحساب الحضور والأجور."
        />
      ) : (
        <ul className="space-y-2">
          {(staff.data ?? []).map((member) => (
            <li key={member.id}>
              <StaffSummaryCard
                orgId={orgId}
                staff={member}
                rows={byStaff.get(member.id) ?? []}
                open={expanded === member.id}
                onToggle={() => setExpanded(expanded === member.id ? null : member.id)}
                onEdit={(target) => {
                  setEditing(target);
                  setRosterOpen(true);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <StaffMemberDialog
        open={rosterOpen}
        onOpenChange={setRosterOpen}
        orgId={orgId}
        member={editing}
      />
    </div>
  );
}
