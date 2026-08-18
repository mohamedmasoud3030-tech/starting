import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineError } from "@/components/ui/ErrorState";
import { formatOMR } from "@/lib/money";
import { defaultMuscatShift, todayInMuscat } from "@/lib/dates";
import {
  attendanceError,
  isOpenPunch,
  useClockStaffIn,
  useClockStaffOut,
  useEventAttendance,
} from "./staff.api";
import { SHIFT_LABELS, STAFF_TYPE_LABELS } from "./labels";

export interface ClockAssignment {
  id: string;
  staffMemberId: string;
  assignmentRole: string;
  status: string;
}

export interface ClockStaff {
  id: string;
  name: string;
  staffType: string;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ar-OM", {
    timeZone: "Asia/Muscat",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Phone punch clock for event hosts. Physical fingerprint hardware is the
 * wrong first product: hosts work at venues, not a factory gate. One tap
 * records دخول الآن / خروج الآن against the existing attendance ledger.
 */
export function AttendanceClock({
  orgId,
  eventId,
  assignments,
  staffList,
}: {
  orgId: string | null;
  eventId: string;
  assignments: ReadonlyArray<ClockAssignment>;
  staffList: ReadonlyArray<ClockStaff>;
}) {
  const attendance = useEventAttendance(orgId, eventId);
  const clockIn = useClockStaffIn(orgId, eventId);
  const clockOut = useClockStaffOut(orgId, eventId);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = assignments.filter((row) => row.status === "ACTIVE");
  const rows = attendance.data ?? [];
  const today = todayInMuscat();
  const shift = defaultMuscatShift();

  async function punchIn(assignment: ClockAssignment) {
    setError("");
    setBusyId(assignment.id);
    try {
      await clockIn.mutateAsync({
        staffMemberId: assignment.staffMemberId,
        assignmentId: assignment.id,
        shift,
      });
    } catch (cause) {
      setError(attendanceError(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function punchOut(staffMemberId: string) {
    setError("");
    setBusyId(staffMemberId);
    try {
      await clockOut.mutateAsync({ staffMemberId });
    } catch (cause) {
      setError(attendanceError(cause));
    } finally {
      setBusyId(null);
    }
  }

  if (active.length === 0) {
    return (
      <EmptyState
        title="لا يوجد فريق مسند"
        description="أسند المضيفين من تبويب الفريق أولاً، ثم اضغط دخول الآن عند وصولهم."
      />
    );
  }

  return (
    <section aria-labelledby="clock-heading" className="space-y-4">
      <div>
        <h2 id="clock-heading" className="text-xl font-black">
          بصمة الحضور
        </h2>
        <p className="mt-1 text-slate-600">
          اضغط دخول عند وصول المضيف، وخروج عند انصرافه. الأجر يُحسب بعد الخروج
          بدقة الريال العماني — بدون جهاز بصمة.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          الوردية الحالية: {SHIFT_LABELS[shift]} · قبل الرابعة عصراً صباحي، وبعدها مسائي.
        </p>
      </div>

      {error && <InlineError message={error} />}

      {attendance.isLoading ? (
        <p>جارٍ تحميل الحضور…</p>
      ) : (
        <ul className="space-y-2">
          {active.map((assignment) => {
            const staff = staffList.find((row) => row.id === assignment.staffMemberId);
            const name = staff?.name ?? assignment.staffMemberId;
            const roleLabel =
              STAFF_TYPE_LABELS[assignment.assignmentRole] ?? assignment.assignmentRole;
            const open = rows.find(
              (row) => row.staffMemberId === assignment.staffMemberId && isOpenPunch(row),
            );
            const todaySlot = rows.find(
              (row) =>
                row.staffMemberId === assignment.staffMemberId &&
                row.attendanceDate === today &&
                row.shift === shift &&
                row.recordStatus === "RECORDED",
            );
            const pending = busyId === assignment.id || busyId === assignment.staffMemberId;

            return (
              <li key={assignment.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black">{name}</p>
                      <p className="text-sm text-slate-500">{roleLabel}</p>
                      {open ? (
                        <p className="mt-1 text-sm font-semibold text-emerald-800">
                          داخل منذ {fmtTime(open.checkIn)} · المستحق يظهر بعد الخروج
                        </p>
                      ) : todaySlot?.checkOut ? (
                        <p className="mt-1 text-sm text-slate-600">
                          خرج الساعة {fmtTime(todaySlot.checkOut)} · المستحق{" "}
                          <span dir="ltr">{formatOMR(todaySlot.earnedMilli)}</span>
                        </p>
                      ) : todaySlot?.status === "ABSENT" ? (
                        <p className="mt-1 text-sm text-slate-600">مسجّل غياب لهذه الوردية</p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-500">لم يسجّل دخولاً بعد</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {open ? (
                        <>
                          <Badge tone="success">داخل الآن</Badge>
                          <Button
                            size="lg"
                            onClick={() => void punchOut(assignment.staffMemberId)}
                            disabled={pending}
                            aria-label={`خروج الآن — ${name}`}
                          >
                            {pending ? "جارٍ التسجيل…" : "خروج الآن"}
                          </Button>
                        </>
                      ) : todaySlot ? (
                        <Badge tone="brand">مسجّل لهذه الوردية</Badge>
                      ) : (
                        <Button
                          size="lg"
                          onClick={() => void punchIn(assignment)}
                          disabled={pending}
                          aria-label={`دخول الآن — ${name}`}
                        >
                          {pending ? "جارٍ التسجيل…" : "دخول الآن"}
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
