import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { VoidReasonPanel } from "@/components/ui/VoidReasonPanel";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatOMR } from "@/lib/money";
import { isoToMuscatWallClock, muscatWallClockToIso, todayInMuscat } from "@/lib/dates";
import {
  attendanceError,
  isOpenPunch,
  isOpenStatusRow,
  useEventAttendance,
  useEventAttendanceStatus,
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
  STAFF_TYPE_LABELS,
} from "./labels";
import { AttendanceClock } from "./AttendanceClock";

interface AssignmentLike {
  id: string;
  staffMemberId: string;
  assignmentRole: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}
interface StaffLike {
  id: string;
  name: string;
  staffType: string;
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  return isoToMuscatWallClock(iso);
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" });
}

/**
 * Attendance workspace surface.
 *
 * Split by visibility, mirroring the database boundary:
 *   * payroll/cost readers see the wage-bearing ledger (amounts come from the
 *     read model — never re-computed here);
 *   * a plain `attendance.record` holder sees the wage-free status ledger
 *     (who is inside, evidence flags, void affordance). The former manual
 *     form's wage inputs were removed: the canonical command derives
 *     method/rate from the assignment → staff-default chain server-side,
 *     which is also what makes supervisor-recorded rows carry REAL wages
 *     instead of the 0.000 they were forced to type blind.
 */
export function AttendancePanel({
  orgId,
  eventId,
  canMutate,
  canReadPayroll,
  assignments,
  staffList,
}: {
  orgId: string | null;
  eventId: string;
  canMutate: boolean;
  /** payroll.read / cost visibility — whether wage figures may be listed at all. */
  canReadPayroll: boolean;
  assignments: AssignmentLike[];
  staffList: StaffLike[];
}) {
  const attendance = useEventAttendance(orgId, eventId);
  const statusRows = useEventAttendanceStatus(orgId, eventId);
  const recordAttendance = useRecordAttendance(orgId, eventId);
  const voidAttendance = useVoidAttendance(orgId, eventId);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);

  // Form state
  const [staffMemberId, setStaffMemberId] = useState("");
  const [shift, setShift] = useState<StaffShift>("MORNING");
  const [date, setDate] = useState(() => todayInMuscat());
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [status, setStatus] = useState<AttendanceLiveStatus>("PRESENT");
  const [notes, setNotes] = useState("");

  const selectedAssignment = assignments.find((a) => a.staffMemberId === staffMemberId);

  function applyStaffDefaults(id: string) {
    const assignment = assignments.find((row) => row.staffMemberId === id);
    if (assignment) {
      setCheckIn(toLocalInput(assignment.scheduledStart));
      setCheckOut(toLocalInput(assignment.scheduledEnd));
    }
  }

  const list = attendance.data ?? [];
  const totalEarned = useMemo(
    () =>
      (attendance.data ?? [])
        .filter((a) => a.recordStatus === "RECORDED")
        .reduce((n, a) => n + a.earnedMilli, 0),
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
    try {
      await recordAttendance.mutateAsync({
        staffMemberId: staff.id,
        assignmentId: selectedAssignment?.id ?? null,
        attendanceDate: date,
        shift,
        checkIn:
          status === "ABSENT"
            ? null
            : (muscatWallClockToIso(checkIn) ?? new Date(checkIn).toISOString()),
        checkOut:
          status === "ABSENT"
            ? null
            : (muscatWallClockToIso(checkOut) ?? new Date(checkOut).toISOString()),
        breakMinutes,
        status,
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

  async function submitVoid(id: string, reason: string) {
    setError("");
    try {
      await voidAttendance.mutateAsync({ attendanceId: id, reason });
      setVoiding(null);
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

  const statusList = statusRows.data ?? [];

  return (
    <section aria-labelledby="attendance-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="attendance-heading" className="text-xl font-black">حضور المضيفين</h2>
          <p className="mt-1 text-slate-600">
            اضغط دخول الآن عند وصول المضيف وخروج الآن عند انصرافه. التسجيل اليدوي للتصحيح أو الغياب فقط.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canReadPayroll && (
            <p className="font-bold text-slate-700" dir="ltr">
              المستحق: {formatOMR(totalEarned)}
            </p>
          )}
          <Button variant="outline" onClick={() => setOpen(true)} disabled={recordAttendance.isPending}>
            تسجيل يدوي
          </Button>
        </div>
      </div>

      <AttendanceClock
        orgId={orgId}
        eventId={eventId}
        assignments={assignments}
        staffList={staffList}
      />

      {error && <InlineError message={error} />}

      {canReadPayroll ? (
        attendance.isLoading ? (
          <p>جارٍ تحميل الحضور…</p>
        ) : list.length === 0 ? (
          <EmptyState
            title="لا يوجد حضور مسجّل"
            description="ابدأ بتسجيل حضور المضيفين لهذه المناسبة."
          />
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
                        {isOpenPunch(a) && <Badge tone="success">داخل الآن</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {a.attendanceDate} · {fmt(a.checkIn)} — {fmt(a.checkOut)}
                        {a.breakMinutes > 0 ? ` · راحة ${a.breakMinutes} د` : ""}
                        {` · ${a.hoursWorked.toFixed(3)} ساعة`}
                      </p>
                      <p className="text-sm text-slate-500">
                        الأجر: {COMPENSATION_LABELS[a.wageMethod]} · <span dir="ltr">{formatOMR(a.earnedMilli)}</span>
                        {a.notes ? ` · ${a.notes}` : ""}
                      </p>
                      {a.recordStatus === "VOIDED" && a.voidReason && (
                        <p className="mt-1 text-sm font-semibold text-red-600">
                          سبب الإلغاء: {a.voidReason}
                        </p>
                      )}
                    </div>
                    {a.recordStatus === "RECORDED" && (
                      <Button
                        variant="outline"
                        disabled={voidAttendance.isPending}
                        onClick={() => setVoiding(a.id)}
                      >
                        إلغاء
                      </Button>
                    )}
                    {voiding === a.id && (
                      <VoidReasonPanel
                        title="تأكيد إلغاء سجل الحضور"
                        description="يبقى السجل محفوظاً كحقيقة مالية، ويُعلَّم ملغى بسبب موثق."
                        confirmLabel="تأكيد الإلغاء"
                        reasonLabel="سبب إلغاء الحضور"
                        busy={voidAttendance.isPending}
                        onConfirm={(reason) => void submitVoid(a.id, reason)}
                        onCancel={() => setVoiding(null)}
                      />
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : (
        // Non-payroll recorder: wage-free operational rows with the same
        // void affordance — visibility of MONEY is not required to operate
        // the clock, and the server decides who may mutate either way.
        statusRows.isLoading ? (
          <p>جارٍ تحميل الحضور…</p>
        ) : statusList.length === 0 ? (
          <EmptyState
            title="لا يوجد حضور مسجّل"
            description="ابدأ بتسجيل حضور المضيفين لهذه المناسبة."
          />
        ) : (
          <ul className="space-y-2">
            {statusList.map((a) => (
              <li key={a.attendance_id}>
                <Card className={a.status === "VOIDED" ? "opacity-70" : ""}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black">{a.staff_name}</p>
                        <Badge tone={ATTENDANCE_STATUS_TONE[a.status]}>
                          {ATTENDANCE_STATUS_LABELS[a.status]}
                        </Badge>
                        <Badge tone="brand">{SHIFT_LABELS[a.shift]}</Badge>
                        {isOpenStatusRow(a) && <Badge tone="success">داخل الآن</Badge>}
                        {a.check_in_method === "FACE_ASSISTED" && (
                          <Badge tone="neutral">تطابق وجه مؤكَّد</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {a.attendance_date} · {fmt(a.check_in)} — {fmt(a.check_out)}
                        {a.has_checkin_evidence ? " · إثبات دخول محفوظ" : ""}
                        {a.has_checkout_evidence ? " · إثبات خروج محفوظ" : ""}
                      </p>
                    </div>
                    {a.status !== "VOIDED" && (
                      <Button
                        variant="outline"
                        disabled={voidAttendance.isPending}
                        onClick={() => setVoiding(a.attendance_id)}
                      >
                        إلغاء
                      </Button>
                    )}
                    {voiding === a.attendance_id && (
                      <VoidReasonPanel
                        title="تأكيد إلغاء سجل الحضور"
                        description="يبقى السجل محفوظاً كحقيقة مالية، ويُعلَّم ملغى بسبب موثق."
                        confirmLabel="تأكيد الإلغاء"
                        reasonLabel="سبب إلغاء الحضور"
                        busy={voidAttendance.isPending}
                        onConfirm={(reason) => void submitVoid(a.attendance_id, reason)}
                        onCancel={() => setVoiding(null)}
                      />
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="تسجيل حضور مضيف"
        description="سجّل وقت الدخول والخروج؛ طريقة الأجر وسعره تشتقهما الخادم من الإسناد الرسمي، والمستحق يُحسب في قاعدة البيانات."
      >
        <form className="space-y-3" onSubmit={submit}>
          <Field label="المضيف" htmlFor="att-staff" required>
            <Select
              id="att-staff"
              value={staffMemberId}
              onChange={(e) => {
                const id = e.target.value;
                setStaffMemberId(id);
                if (id) applyStaffDefaults(id);
              }}
              required
            >
              <option value="">اختر المضيف</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {STAFF_TYPE_LABELS[s.staffType] ?? s.staffType}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="الوردة" htmlFor="att-shift" required>
              <Select
                id="att-shift"
                value={shift}
                onChange={(e) => setShift(e.target.value as StaffShift)}
              >
                <option value="MORNING">صباحي</option>
                <option value="EVENING">مسائي</option>
              </Select>
            </Field>
            <Field label="التاريخ" htmlFor="att-date" required>
              <Input
                id="att-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="الحالة" htmlFor="att-status" required>
            <Select
              id="att-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceLiveStatus)}
            >
              <option value="PRESENT">حاضر</option>
              <option value="LATE">متأخر</option>
              <option value="PARTIAL">جزئي</option>
              <option value="ABSENT">غائب</option>
            </Select>
          </Field>

          {status !== "ABSENT" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="وقت الدخول" htmlFor="att-in" required>
                <Input
                  id="att-in"
                  type="datetime-local"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  required
                />
              </Field>
              <Field label="وقت الخروج" htmlFor="att-out" required>
                <Input
                  id="att-out"
                  type="datetime-local"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  required
                />
              </Field>
              <Field label="دقائق الراحة" htmlFor="att-break">
                <Input
                  id="att-break"
                  type="number"
                  min="0"
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value) || 0)}
                />
              </Field>
            </div>
          )}

          <Field label="ملاحظات" htmlFor="att-notes">
            <Textarea id="att-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={recordAttendance.isPending}>
              {recordAttendance.isPending ? "جارٍ الحفظ…" : "حفظ الحضور"}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
