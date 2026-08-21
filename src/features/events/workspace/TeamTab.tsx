import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { formatOMR, fromDbAmount } from "@/lib/money";
import type { CompensationMethod } from "@/lib/dbTypes";
import {
  ASSIGNMENT_STATUS_LABELS,
  COMPENSATION_LABELS,
  STAFF_TYPE_LABELS,
} from "@/features/staff/labels";
import type { Assignment, StaffMember } from "../events.api";

function staffTypeLabel(code: string): string {
  return STAFF_TYPE_LABELS[code] ?? code;
}

function compensationLabel(code: string | null | undefined): string {
  if (!code) return "";
  return COMPENSATION_LABELS[code as CompensationMethod] ?? code;
}

function assignmentStatusLabel(code: string): string {
  return ASSIGNMENT_STATUS_LABELS[code] ?? code;
}

function staffOptionLabel(staff: StaffMember, canCost: boolean): string {
  const type = staffTypeLabel(staff.staff_type);
  if (!canCost || staff.default_rate == null) return `${staff.name} · ${type}`;
  const method = compensationLabel(staff.default_compensation_method);
  return `${staff.name} · ${type} · ${formatOMR(fromDbAmount(staff.default_rate))}${
    method ? ` (${method})` : ""
  }`;
}

export function TeamTab({
  staff,
  assignments,
  run,
  canAssign,
  canCost,
  onOpenAttendance,
}: {
  staff: ReadonlyArray<StaffMember>;
  assignments: ReadonlyArray<Assignment>;
  run: (
    name: string,
    args: Record<string, unknown>,
    includeEvent?: boolean,
  ) => Promise<void>;
  canAssign: boolean;
  canCost: boolean;
  onOpenAttendance?: () => void;
}) {
  const active = assignments.filter((row) => row.status === "ACTIVE");
  const released = assignments.filter((row) => row.status !== "ACTIVE");
  const assignedIds = new Set(active.map((row) => row.staff_member_id));
  const available = staff.filter((row) => row.is_active && !assignedIds.has(row.id));

  return (
    <div className="space-y-4">
      {canAssign && (
        <Card>
          <CardBody>
            <h2 className="mb-1 font-black">إسناد موظف</h2>
            <p className="mb-3 text-sm text-slate-500">
              أسند المضيف لهذه المناسبة بأجره الافتراضي. تسجيل الدخول والخروج يتم من تبويب الحضور.
            </p>
            {staff.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                أضف المضيفين أولاً من صفحة المضيفون والأجور.
              </p>
            ) : available.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                كل المضيفين النشطين مسندون لهذه المناسبة.
              </p>
            ) : (
              <form
                className="grid gap-3 sm:grid-cols-[1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const selected = staff.find((row) => row.id === form.get("staff"));
                  if (!selected) return;
                  void run("assign_event_staff", {
                    p_staff_member_id: selected.id,
                    p_assignment_role: selected.staff_type,
                    p_compensation_method:
                      selected.default_compensation_method ?? "PER_EVENT",
                    p_rate: selected.default_rate ?? "0.000",
                    p_expected_compensation: selected.default_rate ?? "0.000",
                    p_notes: null,
                    p_idempotency_key: crypto.randomUUID(),
                  });
                }}
              >
                <Select name="staff" required aria-label="اختر الموظف">
                  <option value="">اختر الموظف</option>
                  {available.map((row) => (
                    <option key={row.id} value={row.id}>
                      {staffOptionLabel(row, canCost)}
                    </option>
                  ))}
                </Select>
                <Button type="submit">إسناد</Button>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {onOpenAttendance && active.length > 0 && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          بعد الإسناد: افتح تبويب الحضور واضغط دخول الآن / خروج الآن لحساب الأجر.
          <Button variant="secondary" className="mt-3" onClick={onOpenAttendance}>
            فتح بصمة الحضور
          </Button>
        </p>
      )}

      {assignments.length === 0 ? (
        <EmptyState
          title="لا يوجد فريق مسند"
          description="أسند مضيفاً واحداً على الأقل قبل يوم المناسبة."
        />
      ) : (
        <ul className="space-y-2">
          {active.map((assignment) => {
            const member = staff.find((row) => row.id === assignment.staff_member_id);
            const rateMilli =
              assignment.rate == null ? null : fromDbAmount(assignment.rate);
            const method =
              assignment.compensation_method ?? member?.default_compensation_method ?? null;
            return (
              <li key={assignment.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black">
                        {member?.name ?? assignment.staff_member_id}
                      </p>
                      <p className="text-sm text-slate-500">
                        {staffTypeLabel(assignment.assignment_role)}
                        {method ? ` · ${compensationLabel(method)}` : ""}
                        {canCost && rateMilli != null ? (
                          <>
                            {" · "}
                            <span dir="ltr">{formatOMR(rateMilli)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="success">
                        {assignmentStatusLabel(assignment.status)}
                      </Badge>
                      {canAssign && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            void run(
                              "release_staff_assignment",
                              { p_assignment_id: assignment.id },
                              false,
                            )
                          }
                        >
                          تحرير
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
          {released.map((assignment) => {
            const member = staff.find((row) => row.id === assignment.staff_member_id);
            return (
              <li key={assignment.id}>
                <Card className="opacity-70">
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold">
                        {member?.name ?? assignment.staff_member_id}
                      </p>
                      <p className="text-sm text-slate-500">
                        {staffTypeLabel(assignment.assignment_role)}
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {assignmentStatusLabel(assignment.status)}
                    </Badge>
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
