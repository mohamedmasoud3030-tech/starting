import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, parseOptionalOMR, type MilliOMR } from "@/lib/money";
import { todayInMuscat } from "@/lib/dates";
import type { CompensationMethod } from "@/lib/dbTypes";
import {
  attendanceError,
  computeEarnedMilli,
  useEventAttendance,
  useRecordAttendance,
  useVoidAttendance,
  type AttendanceLiveStatus,
  type StaffShift,
} from "./staff.api";
import { InlineError } from "@/components/ui/ErrorState";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  COMPENSATION_LABELS,
  SHIFT_LABELS,
} from "./labels";

interface AssignmentLike {
  id: string;
  staffMemberId: string;
  assignmentRole: string;
  scheduledStart: string;
  scheduledEnd: string;
}
interface StaffLike {
  id: string;
  name: string;
  staffType: string;
  defaultCompensationMethod?: string | null;
  defaultRate?: string | null;
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" });
}

export function AttendancePanel({
  orgId,
  eventId,
  canMutate,
  assignments,
  staffList,
}: {
  orgId: string | null;
  eventId: string;
  canMutate: boolean;
  assignments: AssignmentLike[];
  staffList: StaffLike[];
}) {
  const attendance = useEventAttendance(orgId, eventId);
  const recordAttendance = useRecordAttendance(orgId, eventId);
  const voidAttendance = useVoidAttendance(orgId, eventId);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [staffMemberId, setStaffMemberId] = useState("");
  const [shift, setShift] = useState<StaffShift>("MORNING");
  const [date, setDate] = useState(() => todayInMuscat());
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [status, setStatus] = useState<AttendanceLiveStatus>("PRESENT");
  const [wageMethod, setWageMethod] = useState<CompensationMethod>("PER_EVENT");
  const [wageRateMilli, setWageRateMilli] = useState<MilliOMR>(0);
  const [notes, setNotes] = useState("");

  const selectedStaff = staffList.find((s) => s.id === staffMemberId);
  const selectedAssignment = assignments.find((a) => a.staffMemberId === staffMemberId);

  function prefillFromStaff() {
    const s = selectedStaff;
    if (!s) return;
    const method = (s.defaultCompensationMethod as CompensationMethod) ?? "PER_EVENT";
    setWageMethod(method);
    setWageRateMilli(parseOptionalOMR(s.defaultRate ?? "0.000"));
    if (selectedAssignment) {
      setCheckIn(toLocalInput(selectedAssignment.scheduledStart));
      setCheckOut(toLocalInput(selectedAssignment.scheduledEnd));
    }
  }

  const earnedPreviewMilli = computeEarnedMilli(
    wageMethod,
    wageRateMilli,
    status === "ABSENT" ? null : checkIn ? new Date(checkIn).toISOString() : null,
    status === "ABSENT" ? null : checkOut ? new Date(checkOut).toISOString() : null,
    breakMinutes,
    status,
  );

  const list = attendance.data ?? [];
  const totalEarned = useMemo(
    () =>
      (attendance.data ?? [])
        .filter((a) => a.recordStatus === "RECORDED")
        .reduce((n, a) => n + a.earnedMilli, 0 as MilliOMR),
    [attendance.data],
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const staff = staffList.find((s) => s.id === staffMemberId);
    if (!staff) {
      setError("يرجى اختيار مضيف");
      return;
    }
    if (status !== "ABSENT") {
      if (!checkIn || !checkOut) {
        setError("يرجى تسجيل وقت الدخول والخروج");
        return;
      }
      if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
        setError("وقت الخروج يجب أن يكون بعد الدخول");
        return;
      }
    }
    if (wageRateMilli <= 0 && status !== "ABSENT") {
      setError("يرجى إدخال الأجر");
      return;
    }
    try {
      await recordAttendance.mutateAsync({
        staffMemberId: staff.id,
        assignmentId: selectedAssignment?.id ?? null,
        attendanceDate: date,
        shift,
        checkIn: status === "ABSENT" ? null : new Date(checkIn).toISOString(),
        checkOut: status === "ABSENT" ? null : new Date(checkOut).toISOString(),
        breakMinutes,
        status,
        wageMethod,
        wageRateMilli,
        notes,
      });
      setOpen(false);
      setStaffMemberId("");
      setNotes("");
      setCheckIn("");
      setCheckOut("");
    } catch (cause) {
      setError(attendanceError(cause));
    }
  }

  async function submitVoid(id: string) {
    const reason = window.prompt("سبب إلغاء الحضور");
    if (!reason || reason.trim().length < 3) return;
    setError("");
    try {
      await voidAttendance.mutateAsync({ attendanceId: id, reason: reason.trim() });
    } catch (cause) {
      setError(attendanceError(cause));
    }
  }

  if (!canMutate) {
    return (
      <EmptyState
        title="تسجيل الحضور متاح للصلاحيات التشغيلية"
        description="يُسجَّل الحضور والخروج عبر المشرف أو المدير أو المالك."
      />
    );
  }

  return (
    <section aria-labelledby="attendance-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="attendance-heading" className="text-xl font-black">حضور المضيفين</h2>
          <p className="mt-1 text-slate-600">تثبيت الدخول والخروج لكل وردة، وحساب المستحق بدقة.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="font-bold text-slate-700" dir="ltr">
            المستحق: {formatOMR(totalEarned)}
          </p>
          <Button onClick={() => setOpen(true)} disabled={recordAttendance.isPending}>
            تسجيل حضور
          </Button>
        </div>
      </div>

      {error && (
        <InlineError message={error} />
      )}

      {attendance.isLoading ? (
        <p>جارٍ تحميل الحضور…</p>
      ) : list.length === 0 ? (
        <EmptyState title="لا يوجد حضور مسجّل" description="ابدأ بتسجيل حضور المضيفين لهذه المناسبة." />
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id}>
              <Card className={a.recordStatus === "VOIDED" ? "opacity-70" : ""}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-black">{a.staffName}</p>
                      <Badge tone={ATTENDANCE_STATUS_TONE[a.status]}>
                        {ATTENDANCE_STATUS_LABELS[a.status]}
                      </Badge>
                      <Badge tone="brand">{SHIFT_LABELS[a.shift]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {a.attendanceDate} · {fmt(a.checkIn)} — {fmt(a.checkOut)}
                      {a.breakMinutes > 0 ? ` · راحة ${a.breakMinutes} د` : ""}
                      {` · ${a.hoursWorked.toFixed(3)} ساعة`}
                    </p>
                    <p className="text-sm text-slate-500">
                      الأجر: {COMPENSATION_LABELS[a.wageMethod]}
                      {` · `}
                      <span dir="ltr">{formatOMR(a.earnedMilli)}</span>
                      {a.notes ? ` · ${a.notes}` : ""}
                    </p>
                    {a.recordStatus === "VOIDED" && a.voidReason && (
                      <p className="mt-1 text-sm font-semibold text-red-600">سبب الإلغاء: {a.voidReason}</p>
                    )}
                  </div>
                  {a.recordStatus === "RECORDED" && (
                    <Button variant="outline" disabled={voidAttendance.isPending} onClick={() => void submitVoid(a.id)}>
                      إلغاء
                    </Button>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="تسجيل حضور مضيف"
        description="سجّل وقت الدخول والخروج والأجر؛ يُحسب المستحق تلقائياً."
      >
        <form className="space-y-3" onSubmit={submit}>
          <Field label="المضيف" htmlFor="att-staff" required>
            <Select
              id="att-staff"
              value={staffMemberId}
              onChange={(e) => {
                setStaffMemberId(e.target.value);
                const s = staffList.find((x) => x.id === e.target.value);
                if (s) prefillFromStaff();
              }}
              required
            >
              <option value="">اختر المضيف</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.staffType}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="الوردة" htmlFor="att-shift" required>
              <Select id="att-shift" value={shift} onChange={(e) => setShift(e.target.value as StaffShift)}>
                <option value="MORNING">صباحي</option>
                <option value="EVENING">مسائي</option>
              </Select>
            </Field>
            <Field label="التاريخ" htmlFor="att-date" required>
              <Input id="att-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>

          <Field label="الحالة" htmlFor="att-status" required>
            <Select id="att-status" value={status} onChange={(e) => setStatus(e.target.value as AttendanceLiveStatus)}>
              <option value="PRESENT">حاضر</option>
              <option value="LATE">متأخر</option>
              <option value="PARTIAL">جزئي</option>
              <option value="ABSENT">غائب</option>
            </Select>
          </Field>

          {status !== "ABSENT" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="وقت الدخول" htmlFor="att-in" required>
                <Input id="att-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required />
              </Field>
              <Field label="وقت الخروج" htmlFor="att-out" required>
                <Input id="att-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} required />
              </Field>
              <Field label="دقائق الراحة" htmlFor="att-break">
                <Input id="att-break" type="number" min="0" value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value) || 0)} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="طريقة الأجر" htmlFor="att-wage" required>
              <Select id="att-wage" value={wageMethod} onChange={(e) => setWageMethod(e.target.value as CompensationMethod)}>
                <option value="PER_HOUR">بالساعة</option>
                <option value="PER_DAY">باليومية</option>
                <option value="PER_EVENT">بالمناسبة</option>
                <option value="MANUAL">يدوي</option>
              </Select>
            </Field>
            <MoneyInput
              id="att-rate"
              label={wageMethod === "PER_HOUR" ? "أجر الساعة (ر.ع.)" : "المبلغ (ر.ع.)"}
              value={wageRateMilli}
              onChange={(m) => setWageRateMilli(m ?? 0)}
              required
              disabled={status === "ABSENT"}
            />
          </div>

          {status !== "ABSENT" && (
            <p className="rounded-xl bg-brand-50 p-3 font-bold text-brand-800" dir="ltr">
              المستحق المقدّر: {formatOMR(earnedPreviewMilli)}
            </p>
          )}

          <Field label="ملاحظات" htmlFor="att-notes">
            <Textarea id="att-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={recordAttendance.isPending}>
              {recordAttendance.isPending ? "جارٍ الحفظ…" : "حفظ الحضور"}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
