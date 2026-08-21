import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { staffingPlan } from "@/lib/staffing";
import type { CompensationMethod } from "@/lib/dbTypes";
import {
  ASSIGNMENT_STATUS_LABELS,
  COMPENSATION_LABELS,
  STAFF_TYPE_LABELS,
} from "@/features/staff/labels";
import type { Assignment, StaffMember } from "../events.api";
import { HostStaffingBanner } from "./HostStaffingBanner";

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

export function TeamTab({
  staff,
  assignments,
  run,
  canAssign,
  canCost,
  guestCount,
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
  guestCount?: number | null;
  onOpenAttendance?: () => void;
}) {
  const [query, setQuery] = useState("");
  const active = assignments.filter((row) => row.status === "ACTIVE");
  const released = assignments.filter((row) => row.status !== "ACTIVE");
  const assignedIds = new Set(active.map((row) => row.staff_member_id));
  const available = staff.filter((row) => row.is_active && !assignedIds.has(row.id));
  const term = query.trim().toLocaleLowerCase("ar");
  const visibleAvailable = useMemo(
    () =>
      available.filter((row) => {
        if (!term) return true;
        const hay = `${row.name} ${staffTypeLabel(row.staff_type)}`.toLocaleLowerCase("ar");
        return hay.includes(term);
      }),
    [available, term],
  );

  const plan = staffingPlan({ guestCount: guestCount ?? null, assigned: active.length });

  function assign(member: StaffMember) {
    void run("assign_event_staff", {
      p_staff_member_id: member.id,
      p_assignment_role: member.staff_type,
      p_compensation_method: member.default_compensation_method ?? "PER_EVENT",
      p_rate: member.default_rate ?? "0.000",
      p_expected_compensation: member.default_rate ?? "0.000",
      p_notes: null,
      p_idempotency_key: crypto.randomUUID(),
    });
  }

  return (
    <div className="space-y-4">
      <HostStaffingBanner plan={plan} />

      <p className="text-sm font-bold text-slate-700">
        المقترح: {plan.recommended ?? "غير متاح"} · المعيّن: {active.length}
      </p>

      {canAssign && (
        <Card>
          <CardBody>
            <h2 className="mb-1 font-black">إسناد مضيفين</h2>
            <p className="mb-3 text-sm text-slate-500">
              ابحث وأسند مباشرة — دون فتح ملف كل مضيف. تسجيل الدخول والخروج من تبويب الحضور.
            </p>
            {staff.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                أضف المضيفين أولاً من صفحة الفريق.
              </p>
            ) : available.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                كل المضيفين النشطين مسندون لهذه المناسبة.
              </p>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="sr-only">اختر الموظف</span>
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث بالاسم…"
                    aria-label="اختر الموظف"
                  />
                </label>
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {visibleAvailable.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-bold">{row.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {staffTypeLabel(row.staff_type)}
                          {canCost && row.default_rate != null
                            ? ` · ${formatOMR(fromDbAmount(row.default_rate))}${
                                row.default_compensation_method
                                  ? ` (${compensationLabel(row.default_compensation_method)})`
                                  : ""
                              }`
                            : ""}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => assign(row)}>
                        إسناد
                      </Button>
                    </li>
                  ))}
                  {visibleAvailable.length === 0 && (
                    <li className="px-3 py-4 text-sm text-slate-500">لا توجد نتائج مطابقة.</li>
                  )}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {onOpenAttendance && active.length > 0 && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          بعد الإسناد: افتح الحضور وصوّر دخول كل مضيف من هاتف العمل.
          <Button variant="secondary" className="mt-3" onClick={onOpenAttendance}>
            فتح إثبات الحضور
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
