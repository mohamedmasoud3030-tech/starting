import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowRight,
  Briefcase,
  ScanFace,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatOMR, type MilliOMR } from "@/lib/money";
import { useAuth } from "@/app/authContext";
import { STAFF_MANAGE_ROLES } from "@/lib/domain";
import { todayInMuscat } from "@/lib/dates";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONE,
  STAFF_TYPE_LABELS,
} from "./labels";
import { HostFinanceSection } from "./HostFinanceSection";
import { FaceEnrollmentPanel } from "./face/FaceEnrollmentPanel";
import { StaffMemberDialog } from "./StaffMemberDialog";
import {
  useHostPayrollSummary,
  useOrgPayrollArchive,
  useStaffLedgerHistory,
  useStaffMemberForEdit,
  useStaffMemberRecord,
  useStaffOperationalProfile,
  type StaffMemberRow,
} from "./staff.api";

/**
 * الملف الشخصي — one central HR file per team member.
 *
 * Opening a specific person opens their whole file: identity and status,
 * employment/contract data with document expiries, leaves & absence register,
 * biometric (face) enrollment, and — for payroll readers only — the financial
 * rollup, ledger and worked events. Attendance stays event-driven; nothing on
 * this page implies a fixed duty schedule.
 *
 * Every figure comes from the server payroll model — the page renders, it does
 * not calculate. Wage data is never widened beyond the existing payroll.read
 * gate (this page shows it only inside the canReadPayroll region).
 */

/** Calendar days from today (Muscat) until the given date; negative = past. */
function daysUntil(dateValue: string): number {
  const today = todayInMuscat();
  const dayMs = 86_400_000;
  const a = Date.parse(`${today}T00:00:00`);
  const b = Date.parse(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / dayMs);
}

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

function ExpiryNote({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) {
    return (
      <p className="text-sm leading-7 text-slate-500">
        {label}: <span className="text-slate-400">غير مسجل</span>
      </p>
    );
  }
  const left = daysUntil(value);
  let note = "";
  let cls = "text-slate-700";
  if (Number.isFinite(left) && left < 0) {
    note = "— منتهية، جدّدها";
    cls = "font-black text-red-700";
  } else if (Number.isFinite(left) && left <= 60) {
    note = `— تنتهي خلال ${left} يوم`;
    cls = "font-black text-amber-700";
  }
  return (
    <p className="text-sm leading-7 text-slate-600">
      {label}: <b>{humanDate(value)}</b> <span className={cls}>{note}</span>
    </p>
  );
}

export function StaffProfilePage() {
  const { staffId } = useParams({ from: "/app/staff/$staffId" });
  const { currentOrganization, capabilities, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const canReadPayroll =
    capabilities !== null ? capabilities.has("payroll.read") : true;
  const canManage =
    capabilities !== null
      ? capabilities.has("staff.manage")
      : !!currentRole && STAFF_MANAGE_ROLES.includes(currentRole);

  const staffQuery = useStaffOperationalProfile(orgId, staffId);
  const fullQuery = useStaffMemberRecord(orgId, staffId, canReadPayroll);
  const [editOpen, setEditOpen] = useState(false);
  const editRow = useStaffMemberForEdit(orgId, staffId, canManage);
  const summaryQuery = useHostPayrollSummary(canReadPayroll ? orgId : null, staffId);
  const ledgerQuery = useStaffLedgerHistory(canReadPayroll ? orgId : null, staffId);
  // The worked-events list reuses the SAME org payroll projection the staff
  // list reads, filtered to this member — no per-member variant of the SQL.
  const rowsQuery = useOrgPayrollArchive(canReadPayroll ? orgId : null);
  const staffRows = (rowsQuery.data ?? []).filter((r) => r.staffMemberId === staffId);
  const staffForFinance: StaffMemberRow | null = fullQuery.data
    ? fullQuery.data
    : staffQuery.data
      ? {
          id: staffQuery.data.id,
          name: staffQuery.data.name,
          staffType: staffQuery.data.staff_type,
          isActive: staffQuery.data.is_active,
          defaultCompensationMethod: null,
          defaultRateMilli: 0 as MilliOMR,
          phone: staffQuery.data.phone,
          whatsapp: staffQuery.data.whatsapp,
          idNumber: null,
          notes: staffQuery.data.notes,
        }
      : null;

  if (staffQuery.isError) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState message="تعذر تحميل الملف الشخصي." />
      </div>
    );
  }
  if (!staffQuery.data) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="p-6 text-slate-500">جارٍ التحميل...</Card>
      </div>
    );
  }
  const member = staffQuery.data;
  const full = fullQuery.data;
  const hr = full?.hireDate || full?.birthDate || full?.nationality
    || full?.jobTitle || full?.department || full?.emergencyPhone || full?.iban;

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`الملف الشخصي — ${member.name}`}
        description="كل ما يخص العضو في هذا الملف: هويته وبيانات عمله وتواريخ مستنداته، وحضوره ومستحقاته في مناسباتك — حسب صلاحياتك."
        actions={
          canManage && editRow.data ? (
            <>
              <Button onClick={() => setEditOpen(true)}>تعديل بيانات العضو</Button>
              <StaffMemberDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                orgId={orgId}
                member={editRow.data}
              />
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardBody className="space-y-2 text-sm leading-7 text-slate-700">
            <h2 className="text-lg font-black text-slate-900">الهوية والحالة</h2>
            <p className="flex items-center gap-2 text-base font-black text-slate-900">
              <UserRound className="h-5 w-5 text-brand-700" /> {member.name}
            </p>
            <p>الجوال: <span dir="ltr">{member.phone ?? "—"}</span></p>
            <p>الواتساب: <span dir="ltr">{member.whatsapp ?? "—"}</span></p>
            <p className="flex flex-wrap items-center gap-2">
              الدور:
              <Badge tone="neutral">
                {STAFF_TYPE_LABELS[member.staff_type] ?? member.staff_type}
              </Badge>
              {full?.contractStatus && (
                <Badge tone={CONTRACT_STATUS_TONE[full.contractStatus]}>
                  {CONTRACT_STATUS_LABELS[full.contractStatus] ?? full.contractStatus}
                </Badge>
              )}
            </p>
            <p>
              الحالة: {member.is_active ? "نشط" : "موقوف"}
              {member.notes ? ` — ${member.notes}` : ""}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-black text-slate-900">
              <ScanFace className="h-5 w-5 text-brand-700" />
              التسجيل البيومتري (الحضور بمطابقة الوجه)
            </h2>
            <p className="mb-3 text-sm leading-6 text-slate-500">
              يُستعمل لمطابقة الحضور في المناسبات فقط — لا يرتبط التسجيل بأي
              دوام بمواعيد ثابتة.
            </p>
            <FaceEnrollmentPanel
              orgId={orgId}
              staffMemberId={staffId}
              staffName={member.name}
            />
          </CardBody>
        </Card>
      </div>

      {canReadPayroll ? (
        <>
          {full && (
            <Card>
              <CardBody className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
                  <Briefcase className="h-5 w-5 text-brand-700" />
                  بيانات العمل والتعاقد
                </h2>
                {hr ? (
                  <>
                    <div className="grid gap-x-8 gap-y-1 text-sm leading-8 text-slate-700 sm:grid-cols-2">
                      <p>
                        المسمى الوظيفي:{" "}
                        <b>{full.jobTitle ?? "غير مسجل"}</b>
                      </p>
                      <p>
                        القسم: <b>{full.department ?? "غير مسجل"}</b>
                      </p>
                      <p>
                        تاريخ الالتحاق:{" "}
                        <b>{full.hireDate ? humanDate(full.hireDate) : "غير مسجل"}</b>
                      </p>
                      <p>
                        حالة العقد:{" "}
                        <b>
                          {full.contractStatus
                            ? (CONTRACT_STATUS_LABELS[full.contractStatus] ??
                              full.contractStatus)
                            : "غير مسجل"}
                        </b>
                      </p>
                      <p>
                        الجنسية: <b>{full.nationality ?? "غير مسجلة"}</b>
                      </p>
                      <p>
                        تاريخ الميلاد:{" "}
                        <b>{full.birthDate ? humanDate(full.birthDate) : "غير مسجل"}</b>
                      </p>
                      <p>
                        هاتف الطوارئ:{" "}
                        <b dir="ltr">{full.emergencyPhone ?? "غير مسجل"}</b>
                      </p>
                      <p>
                        الآيبان:{" "}
                        <b dir="ltr" className="break-all">
                          {full.iban ?? "غير مسجل"}
                        </b>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-8">
                      <p className="mb-1 font-black text-slate-800">
                        تواريخ المستندات (جدّد قبل الانتهاء)
                      </p>
                      <ExpiryNote
                        label="البطاقة المدنية"
                        value={full.civilIdExpiresOn}
                      />
                      <ExpiryNote
                        label="بطاقة التأمين الصحي"
                        value={full.healthCardExpiresOn}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">
                    لم تُسجَّل بيانات عمل إضافية بعد — استخدم «تعديل بيانات
                    العضو» لإضافتها.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <h2 className="mb-2 text-lg font-black text-slate-900">الملخص المالي</h2>
              {!summaryQuery.data ? (
                <p className="text-sm text-slate-500">
                  {summaryQuery.isError ? "تعذر تحميل الملخص المالي." : "جارٍ الحساب من كشوف الرواتب..."}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <SummaryStat label="إجمالي المستحق" value={summaryQuery.data.earnedMilli} strong />
                  <SummaryStat label="السلف" value={summaryQuery.data.advancesMilli} />
                  <SummaryStat label="المصروف" value={summaryQuery.data.payoutsMilli} />
                  <SummaryStat label="إجمالي المدفوع" value={summaryQuery.data.paidMilli} />
                  <SummaryStat label="المتبقي للدفع" value={summaryQuery.data.dueMilli} strong />
                  <SummaryStat label="عدد المناسبات المسجلة" value={null} count={summaryQuery.data.attendanceCount} />
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-2 text-lg font-black text-slate-900">سجل العمليات المالية</h2>
              {staffForFinance && (
                <HostFinanceSection orgId={orgId} staff={staffForFinance} rows={staffRows} />
              )}
              {ledgerQuery.isError ? (
                <p className="text-sm text-red-700">تعذر تحميل سجل العمليات.</p>
              ) : !ledgerQuery.data ? (
                <p className="text-sm text-slate-500">جارٍ التحميل...</p>
              ) : ledgerQuery.data.length === 0 ? (
                <p className="text-sm text-slate-500">لا عمليات مسجلة بعد.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                  {ledgerQuery.data.map((row, index) => (
                    <li
                      key={`${row.kind}:${row.occurredAt}:${row.label}:${index}`}
                      className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${
                        row.status === "VOIDED" ? "opacity-50 line-through" : ""
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            row.kind === "ATTENDANCE"
                              ? "brand"
                              : row.kind === "ADVANCE"
                                ? "warning"
                                : "success"
                          }
                        >
                          {row.kind === "ATTENDANCE"
                            ? "مستحق حضور"
                            : row.kind === "ADVANCE"
                              ? "سلفة"
                              : "صرف"}
                        </Badge>
                        <span>{row.occurredAt}</span>
                        <span className="text-slate-600">
                          {row.eventNumber ? `المناسبة ${row.eventNumber}` : row.label || "—"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {row.status === "VOIDED" && row.voidReason && (
                          <span className="text-xs text-red-700">إلغاء: {row.voidReason}</span>
                        )}
                        <span className="font-bold" dir="ltr">
                          {row.effectMilli > 0 ? "+" : ""}
                          {formatOMR(row.effectMilli)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-2 text-lg font-black text-slate-900">
                المناسبات المسجلة (مستحقات الحضور)
              </h2>
              {staffRows.length === 0 ? (
                <p className="text-sm text-slate-500">لا مناسبات مسجلة لهذا العضو بعد.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2 text-right">المناسبة</th>
                        <th className="p-2 text-right">عدد الجلسات</th>
                        <th className="p-2 text-right">المستحق</th>
                        <th className="p-2 text-right">السلف</th>
                        <th className="p-2 text-right">المصروف</th>
                        <th className="p-2 text-right">المتبقي للدفع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map((r) => (
                        <tr key={`${r.eventId}:${r.staffMemberId}`} className="border-t border-slate-100">
                          <td className="p-2">
                            <Link
                              to="/events/$eventId"
                              params={{ eventId: r.eventId }}
                              className="font-bold text-brand-700 hover:underline"
                            >
                              {r.eventTitle ?? r.eventNumber ?? "—"}
                            </Link>
                          </td>
                          <td className="p-2">{r.attendanceCount}</td>
                          <td className="p-2" dir="ltr">{formatOMR(r.earnedMilli)}</td>
                          <td className="p-2" dir="ltr">{formatOMR(r.advancesMilli)}</td>
                          <td className="p-2" dir="ltr">{formatOMR(r.payoutsMilli)}</td>
                          <td className={`p-2 font-bold ${r.lateMilli > 0 ? "text-amber-800" : "text-emerald-800"}`} dir="ltr">
                            {formatOMR(r.lateMilli)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      ) : (
        <Card className="bg-slate-50 p-5 text-sm leading-7 text-slate-600">
          البيانات المالية وملف العضو الكامل (التعاقد، المستندات) تظهر
          لحسابات الرواتب فقط. هذا الملف يعرض الهوية وحالة التسجيل فقط لحسابك.
        </Card>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  strong,
  count,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  count?: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      {count !== undefined ? (
        <p className={`mt-1 font-black ${strong ? "text-lg" : ""}`}>{count}</p>
      ) : (
        <p className={`mt-1 font-black ${strong ? "text-lg" : ""}`} dir="ltr">
          {formatOMR(value ?? 0)}
        </p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/staff"
      className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:text-brand-900"
    >
      <ArrowRight className="h-4 w-4" />
      رجوع إلى الفريق
    </Link>
  );
}
