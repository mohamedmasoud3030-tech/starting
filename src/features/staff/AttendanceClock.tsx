import { useMemo, useRef, useState } from "react";
import { Camera, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineError } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { uploadEvidenceFile, evidenceError } from "@/features/attachments/attachments.api";
import {
  attendanceError,
  useClockStaffIn,
  useClockStaffOut,
  useEventAttendance,
} from "./staff.api";
import { defaultMuscatShift } from "@/lib/dates";
import { STAFF_TYPE_LABELS } from "./labels";
import {
  formatRosterTime,
  matchesHostSearch,
  matchesRosterFilter,
  pickAttendanceForRoster,
  rosterCounts,
  rosterVisualStatus,
  ROSTER_FILTER_LABELS,
  ROSTER_FILTERS,
  ROSTER_STATUS_LABELS,
  type RosterFilter,
  type RosterVisualStatus,
} from "./attendanceRoster.model";

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

type CaptureTarget =
  | { kind: "IN"; assignment: ClockAssignment }
  | { kind: "OUT"; staffMemberId: string };

const STATUS_TONE: Record<RosterVisualStatus, "neutral" | "success" | "brand"> = {
  NOT_ARRIVED: "neutral",
  ARRIVED: "success",
  CHECKED_OUT: "brand",
};

/**
 * Supervisor-controlled photo attendance on one work phone.
 *
 * The office user photographs each assigned host — this is NOT employee
 * self check-in, NOT a selfie, NOT biometrics, NOT facial recognition.
 * Photo evidence is uploaded first; the punch is recorded only after a
 * successful upload. A failed upload never shows verified attendance.
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
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [filter, setFilter] = useState<RosterFilter>("ALL");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const savedScroll = useRef(0);

  const shift = defaultMuscatShift();

  const roster = useMemo(() => {
    const rows = attendance.data ?? [];
    return assignments
      .filter((row) => row.status === "ACTIVE")
      .map((assignment) => {
        const staff = staffList.find((row) => row.id === assignment.staffMemberId);
        const att = pickAttendanceForRoster(rows, assignment.staffMemberId);
        const visual = rosterVisualStatus(att);
        return {
          assignment,
          name: staff?.name ?? assignment.staffMemberId,
          roleLabel: STAFF_TYPE_LABELS[assignment.assignmentRole] ?? assignment.assignmentRole,
          visual,
          att,
        };
      });
  }, [assignments, staffList, attendance.data]);

  const counts = useMemo(
    () => rosterCounts(roster.map((row) => row.visual)),
    [roster],
  );

  const visible = roster.filter(
    (row) =>
      matchesRosterFilter(row.visual, filter) && matchesHostSearch(row.name, query),
  );

  function startIn(assignment: ClockAssignment) {
    setError("");
    savedScroll.current = listRef.current?.scrollTop ?? 0;
    setCaptureTarget({ kind: "IN", assignment });
    fileInput.current?.click();
  }

  function startOut(staffMemberId: string) {
    setError("");
    savedScroll.current = listRef.current?.scrollTop ?? 0;
    setCaptureTarget({ kind: "OUT", staffMemberId });
    fileInput.current?.click();
  }

  function restoreScroll() {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedScroll.current;
    });
  }

  async function onCapture(file: File | null) {
    const target = captureTarget;
    setCaptureTarget(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!file || !target || !orgId) {
      restoreScroll();
      return;
    }

    const kind = target.kind === "IN" ? "ATTENDANCE_CHECKIN" : "ATTENDANCE_CHECKOUT";
    const staffMemberId =
      target.kind === "IN" ? target.assignment.staffMemberId : target.staffMemberId;

    setBusyId(target.kind === "IN" ? target.assignment.id : target.staffMemberId);
    try {
      const uploaded = await uploadEvidenceFile(orgId, kind, "staff_attendance", file);
      if (target.kind === "IN") {
        await clockIn.mutateAsync({
          staffMemberId: target.assignment.staffMemberId,
          assignmentId: target.assignment.id,
          shift,
          evidencePath: uploaded.storagePath,
          evidenceFileName: uploaded.fileName,
          evidenceMimeType: uploaded.mimeType,
          evidenceSizeBytes: uploaded.sizeBytes,
        });
      } else {
        await clockOut.mutateAsync({
          staffMemberId,
          evidencePath: uploaded.storagePath,
          evidenceFileName: uploaded.fileName,
          evidenceMimeType: uploaded.mimeType,
          evidenceSizeBytes: uploaded.sizeBytes,
        });
      }
    } catch (cause) {
      setError(attendanceError(cause) || evidenceError(cause));
    } finally {
      setBusyId(null);
      restoreScroll();
    }
  }

  if (roster.length === 0) {
    return (
      <EmptyState
        title="لا يوجد فريق مسند"
        description="أسند المضيفين من تبويب الفريق أولاً، ثم صوّر دخول كل مضيف عند وصوله."
      />
    );
  }

  return (
    <section aria-labelledby="clock-heading" className="space-y-4">
      <div>
        <h2 id="clock-heading" className="text-xl font-black">
          إثبات الحضور بالصورة
        </h2>
        <p className="mt-1 text-slate-600">
          المشرف يصوّر كل مضيف من هاتف العمل — تصوير دخول قبل المغادرة، وتصوير
          خروج بعد العودة. ليست دخولاً ذاتياً للمضيف وليست تحققاً بيومترياً.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CountChip label="المضيفون" value={counts.total} />
        <CountChip label="حضر" value={counts.arrived} of={counts.total} />
        <CountChip label="لم يصل" value={counts.notArrived} />
        {(counts.checkedOut > 0 || counts.present > 0) && (
          <>
            <CountChip label="خرج" value={counts.checkedOut} of={counts.total} />
            <CountChip label="ما زال مفتوح الحضور" value={counts.present} className="col-span-2 sm:col-span-1" />
          </>
        )}
      </div>

      {error && <InlineError message={error} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">بحث باسم المضيف</span>
          <Search className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-10"
            placeholder="ابحث عن مضيف…"
          />
        </label>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="تصفية الحضور">
          {ROSTER_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold ${
                filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {ROSTER_FILTER_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onCapture(e.target.files?.[0] ?? null)}
      />

      {attendance.isLoading ? (
        <p>جارٍ تحميل الحضور…</p>
      ) : attendance.isError ? (
        <InlineError message="تعذر تحميل الحضور. أعد المحاولة قبل تسجيل أي دخول." />
      ) : visible.length === 0 ? (
        <EmptyState title="لا توجد نتائج" description="غيّر البحث أو عامل التصفية." />
      ) : (
        <ul
          ref={listRef}
          className="max-h-[70dvh] divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 bg-white"
        >
          {visible.map((row) => {
            const pending =
              busyId === row.assignment.id || busyId === row.assignment.staffMemberId;
            const action =
              row.visual === "NOT_ARRIVED"
                ? {
                    label: pending ? "جارٍ التصوير…" : "تصوير دخول",
                    aria: `تصوير دخول — ${row.name}`,
                    onClick: () => startIn(row.assignment),
                  }
                : row.visual === "ARRIVED"
                  ? {
                      label: pending ? "جارٍ التصوير…" : "تصوير خروج",
                      aria: `تصوير خروج — ${row.name}`,
                      onClick: () => startOut(row.assignment.staffMemberId),
                    }
                  : null;

            return (
              <li key={row.assignment.id} className="flex min-h-16 items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-black">{row.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {row.roleLabel}
                    {row.att?.checkIn ? ` · دخول ${formatRosterTime(row.att.checkIn)}` : ""}
                    {row.att?.checkOut ? ` · خروج ${formatRosterTime(row.att.checkOut)}` : ""}
                    {row.visual === "ARRIVED" || row.visual === "CHECKED_OUT"
                      ? " · إثبات بالصورة"
                      : ""}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[row.visual]}>{ROSTER_STATUS_LABELS[row.visual]}</Badge>
                {action && (
                  <Button
                    size="sm"
                    onClick={action.onClick}
                    disabled={pending}
                    aria-label={action.aria}
                    className="shrink-0"
                  >
                    <Camera className="h-4 w-4" />
                    {action.label}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CountChip({
  label,
  value,
  of,
  className,
}: {
  label: string;
  value: number;
  of?: number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white px-3 py-2 ${className ?? ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-black">
        {value}
        {of != null ? ` / ${of}` : ""}
      </p>
    </div>
  );
}
