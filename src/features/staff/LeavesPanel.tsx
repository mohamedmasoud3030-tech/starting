import { useEffect, useState, type FormEvent } from "react";
import { CalendarCheck, CalendarPlus, Check, X, Ban } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { todayInMuscat } from "@/lib/dates";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONE,
  LEAVE_TYPE_LABELS,
} from "./labels";
import {
  useOrgLeaves,
  useSaveLeave,
  useUpdateLeaveStatus,
  type LeaveStatus,
  type LeaveType,
} from "./staff.api";

const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABELS) as LeaveType[];

/** Human display of a YYYY-MM-DD date in the app's usual Arabic locale. */
function humanDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ar-OM", {
    timeZone: "Asia/Muscat",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * سجل الإجازات والغياب.
 *
 * This is a lightweight REGISTER, not a duty schedule: work in this business is
 * event-driven, so attendance is only ever recorded from inside an event (a
 * member who was called but did not show simply has no attendance row). These
 * records are the HR notices around that reality — planned/annual leave, sick
 * notes, urgent circumstances, unpaid time, or a noted absence from an event.
 */
export function LeavesPanel({
  orgId,
  memberId,
  names,
  canManage,
}: {
  orgId: string | null;
  /** When set, only this member's records show (the profile page case). */
  memberId?: string | null;
  /** orgId → display name lookup for the org-wide register (roster page). */
  names?: ReadonlyMap<string, string>;
  canManage: boolean;
}) {
  const { user } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const leavesQuery = useOrgLeaves(orgId);
  const decide = useUpdateLeaveStatus(orgId);
  const decideError = decide.isError ? "تعذر تحديث الحالة — أعد المحاولة." : null;

  const all = leavesQuery.data ?? [];
  const rows = memberId
    ? all.filter((row) => row.staffMemberId === memberId)
    : all;
  const memberName = (id: string) => names?.get(id) ?? null;

  const pendingRow = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row || row.status !== "PENDING") return null;
    return row;
  };

  const act = async (rowId: string, status: LeaveStatus) => {
    if (!orgId || decide.isPending) return;
    try {
      await decide.mutateAsync({
        leaveId: rowId,
        status,
        decidedBy: user?.id ?? null,
      });
    } catch {
      // inline error below
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm leading-6 text-slate-500">
          الدوام هنا لا يرتبط بساعات أو أيام محددة — الحضور يُسجَّل من داخل كل
          مناسبة. هذا السجل يوثّق الإجازات والظروف والغيابات المسجَّلة فقط.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <CalendarPlus className="h-4 w-4" />
            تسجيل إجازة / غياب
          </Button>
        )}
      </div>

      {decideError && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">
          {decideError}
        </p>
      )}

      {leavesQuery.isLoading ? (
        <p className="text-sm text-slate-500">جارٍ تحميل السجل...</p>
      ) : leavesQuery.isError ? (
        <p className="text-sm text-red-700">تعذر تحميل السجل — أعد المحاولة.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <CalendarCheck className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-slate-600">
            {memberId
              ? "لا توجد إجازات أو غيابات مسجلة لهذا العضو بعد."
              : "لا توجد إجازات أو غيابات مسجلة بعد."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((row) => {
            const pending = pendingRow(row.id);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!memberId && memberName(row.staffMemberId) && (
                      <span className="font-black text-slate-900">
                        {memberName(row.staffMemberId)}
                      </span>
                    )}
                    <Badge tone="brand">{LEAVE_TYPE_LABELS[row.leaveType]}</Badge>
                    <Badge tone={LEAVE_STATUS_TONE[row.status]}>
                      {LEAVE_STATUS_LABELS[row.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600">
                    من <b>{humanDate(row.startDate)}</b>
                    {row.endDate ? (
                      <>
                        {" "}
                        إلى <b>{humanDate(row.endDate)}</b>
                      </>
                    ) : null}{" "}
                    · <b>{row.daysCount}</b> يوم
                    {row.reason ? ` — ${row.reason}` : ""}
                  </p>
                </div>
                {pending && canManage ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void act(row.id, "APPROVED")}
                      disabled={decide.isPending}
                      aria-label="الموافقة على الطلب"
                      className="text-emerald-700"
                    >
                      <Check className="h-4 w-4" />
                      موافقة
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void act(row.id, "REJECTED")}
                      disabled={decide.isPending}
                      aria-label="رفض الطلب"
                      className="text-red-700"
                    >
                      <X className="h-4 w-4" />
                      رفض
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void act(row.id, "CANCELLED")}
                      disabled={decide.isPending}
                      aria-label="إلغاء القيد"
                    >
                      <Ban className="h-4 w-4" />
                      إلغاء
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <LeaveDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgId={orgId}
        memberId={memberId ?? null}
        names={names}
        canManage={canManage}
      />
    </div>
  );
}

function LeaveDialog({
  open,
  onOpenChange,
  orgId,
  memberId,
  names,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  memberId: string | null;
  names?: ReadonlyMap<string, string>;
  canManage: boolean;
}) {
  const save = useSaveLeave(orgId);
  const today = todayInMuscat();

  const [target, setTarget] = useState<string>(memberId ?? "");
  const [leaveType, setLeaveType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>("");
  const [daysCount, setDaysCount] = useState<string>("1");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // When the dialog is opened from the org-wide register pick a member there.
  const memberOptions = Array.from(names?.entries() ?? []);
  const allowPickMember = !memberId && memberOptions.length > 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const finalMemberId = memberId ?? target;
    if (!finalMemberId) {
      setError("اختر العضو أولاً");
      return;
    }
    if (!startDate) {
      setError("تاريخ البداية مطلوب");
      return;
    }
    if (endDate && endDate < startDate) {
      setError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مثله");
      return;
    }
    const days = Number(daysCount);
    if (!Number.isFinite(days) || days <= 0 || days > 366) {
      setError("عدد الأيام يجب أن يكون بين 1 و 366");
      return;
    }
    try {
      await save.mutateAsync({
        staffMemberId: finalMemberId,
        values: {
          leaveType,
          startDate,
          endDate: endDate || null,
          daysCount: days,
          reason,
          status: "PENDING",
        },
      });
      onOpenChange(false);
      setEndDate("");
      setReason("");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذر تسجيل الطلب",
      );
    }
  }

  // Fresh form each time the dialog opens (target member, dates, reason).
  useEffect(() => {
    if (open) {
      setTarget(memberId ?? "");
      setLeaveType("ANNUAL");
      setStartDate(todayInMuscat());
      setEndDate("");
      setDaysCount("1");
      setReason("");
      setError(null);
    }
  }, [open, memberId]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="تسجيل إجازة / غياب"
      description={
        canManage
          ? "قيد خفيف في سجل العضو — لا يُنشئ أي التزام بدوام. يُسجَّل على أنه بانتظار الموافقة، ثم تُتخذ الموافقة أو الرفض هنا."
          : "سجل بانتظار الموافقة من مالك الصلاحية."
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        {allowPickMember && (
          <Field label="العضو" htmlFor="leave-member" required>
            <Select
              id="leave-member"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">اختر العضو…</option>
              {memberOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="النوع" htmlFor="leave-type" required>
            <Select
              id="leave-type"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="عدد الأيام" htmlFor="leave-days" required>
            <Input
              id="leave-days"
              type="number"
              min={1}
              max={366}
              inputMode="numeric"
              dir="ltr"
              value={daysCount}
              onChange={(e) => setDaysCount(e.target.value)}
            />
          </Field>
          <Field label="من تاريخ" htmlFor="leave-from" required>
            <Input
              id="leave-from"
              type="date"
              dir="ltr"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="إلى تاريخ (اختياري)" htmlFor="leave-to">
            <Input
              id="leave-to"
              type="date"
              dir="ltr"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="السبب / ملاحظة" htmlFor="leave-reason">
          <Textarea
            id="leave-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: إجازة سنوية، ظرف عائلي، لم يستجب لنداء مناسبة…"
          />
        </Field>
        {error && (
          <p className="text-sm font-bold text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            إلغاء
          </Button>
          <Button type="submit" disabled={save.isPending || !orgId}>
            {save.isPending ? "جارٍ التسجيل…" : "تسجيل القيد"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
