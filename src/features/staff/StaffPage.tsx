import { useMemo, useState } from "react";
import { Plus, Printer, ScrollText } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { buildDocumentIdentity } from "@/components/documents/documentIdentity";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import {
  useHostStatement,
  usePayrollPeriodSheet,
} from "@/features/documents/documents.api";
import { HostStatement } from "@/features/documents/HostStatement";
import { PayrollPeriodSheet } from "@/features/documents/PayrollPeriodSheet";
import { PrintDocumentDialog } from "@/features/documents/PrintDocumentDialog";
import { formatOMR, type MilliOMR } from "@/lib/money";
import { todayInMuscat } from "@/lib/dates";
import { STAFF_MANAGE_ROLES } from "@/lib/domain";
import { Link } from "@tanstack/react-router";
import { HostFinanceSection } from "./HostFinanceSection";
import {
  useOrgPayrollArchive,
  useOrgStaffMembers,
  useStaffAdvances,
  useHostPayouts,
  type PayrollRow,
  type StaffMemberRow,
} from "./staff.api";
import { STAFF_TYPE_LABELS } from "./labels";
import { StaffMemberDialog } from "./StaffMemberDialog";

/**
 * Payroll period sheet (كشف صرف / رواتب فترة) — pick a Muscat-calendar period
 * and print the org-wide payable sheet. Sums come from the canonical
 * payroll_period_sheet projection (0081), which returns NOTHING unless the
 * caller holds payroll.read; totals reconcile to the printed rows.
 */
function PayrollPeriodCard({ orgId }: { orgId: string | null }) {
  const { currentOrganization } = useAuth();
  const settings = useOrganizationSettings(orgId);
  const today = todayInMuscat();
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState(false);
  const period = usePayrollPeriodSheet(
    orgId,
    open ? from : null,
    open ? to : null,
  );
  const invalidRange = from !== "" && to !== "" && to < from;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Printer className="h-5 w-5 text-brand-700" />
        <h2 className="font-black">كشف صرف / رواتب فترة</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        حدد الفترة ثم اطبع كشف الرواتب لكل المضيفين: الاستحقاق والسلف والصرف
        خلالها. يعرض الكشف المجاميع فقط لا معدلات الأجور، وهو مخصص لمن يملك
        صلاحية قراءة الأجور — ويُصفّى في الخادم وفق الصلاحية نفسها.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="من تاريخ" htmlFor="period-from">
          <Input
            id="period-from"
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="إلى تاريخ" htmlFor="period-to">
          <Input
            id="period-to"
            type="date"
            dir="ltr"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Button disabled={!from || !to || invalidRange} onClick={() => setOpen(true)}>
          طباعة كشف رواتب الفترة
        </Button>
      </div>
      {invalidRange && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          يجب أن يكون تاريخ النهاية بعد تاريخ البداية أو مثله.
        </p>
      )}

      <PrintDocumentDialog
        open={open}
        onOpenChange={setOpen}
        title="كشف صرف / رواتب فترة"
        description="الأرقام من سجلات الأجور الرسمية — الإجماليات مجموع المطبوع في الكشف نفسه."
      >
        {period.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner className="h-7 w-7" />
          </div>
        )}
        {!period.isLoading && (
          <PayrollPeriodSheet
            identity={buildDocumentIdentity(
              currentOrganization,
              settings.data ?? null,
            )}
            from={from}
            to={to}
            rows={period.data ?? []}
          />
        )}
      </PrintDocumentDialog>
    </Card>
  );
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
  const { currentOrganization } = useAuth();
  const settings = useOrganizationSettings(orgId);
  // The staff statement is fetched only while its dialog is open; the
  // projection itself is payroll.read-gated server-side (0080).
  const [statementOpen, setStatementOpen] = useState(false);
  const statement = useHostStatement(orgId, statementOpen ? staff.id : null);
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
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatementOpen(true)}
              aria-label={`طباعة كشف حساب ${staff.name}`}
            >
              <ScrollText className="h-4 w-4" />
              كشف حساب
            </Button>
            <Link
              to="/staff/$staffId"
              params={{ staffId: staff.id }}
              className="inline-flex min-h-11 items-center rounded-xl border border-brand-200 px-3 text-sm font-bold text-brand-700 hover:bg-brand-50"
            >
              ملف المضيف
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(staff)}
              aria-label={`تعديل بيانات ${staff.name}`}
            >
              تعديل
            </Button>
          </div>
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
            <HostFinanceSection orgId={orgId} staff={staff} rows={rows} />
          </div>
        )}

        <PrintDocumentDialog
          open={statementOpen}
          onOpenChange={setStatementOpen}
          title="كشف حساب مضيف"
          description="الأرقام من سجلات الأجور الرسمية نفسها — الاستحقاق والسلف والصرف والمتبقي."
        >
          {statement.isLoading && (
            <div className="flex justify-center py-10">
              <Spinner className="h-7 w-7" />
            </div>
          )}
          {!statement.isLoading && (
            <HostStatement
              identity={buildDocumentIdentity(
                currentOrganization,
                settings.data ?? null,
              )}
              rows={statement.data ?? []}
            />
          )}
        </PrintDocumentDialog>
      </CardBody>
    </Card>
  );
}

export function StaffPage() {
  const {
    currentOrganization,
    currentRole,
    capabilities,
    canReadPayroll,
  } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  // 0079: the roster is gated by staff.manage (role preset = loading fallback).
  const canManageStaff =
    capabilities !== null
      ? capabilities.has("staff.manage")
      : !!currentRole && STAFF_MANAGE_ROLES.includes(currentRole);
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

  if (!canReadPayroll) {
    return (
      <div className="space-y-4">
        <PageHeader title="المضيفون والأجور" description="سجل أجور المضيفين والسلف والصرف." />
        <EmptyState title="الأجور غير متاحة لدورك" description="تظهر أجور المضيفين لمن يملك صلاحية قراءة الأجور، وهي تُمنح لكل عضو من شاشة «المستخدمون والصلاحيات»." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="المضيفون والأجور"
        description="هنا الأجور والسلف والصرف. تسجيل الشغل يتم من داخل المناسبة بزر دخول الآن / خروج الآن."
        actions={
          canManageStaff ? (
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
      <PayrollPeriodCard orgId={orgId} />
      {staff.isLoading || archive.isLoading ? (
        <LoadingState label="جارٍ تحميل بيانات الفريق…" />
      ) : staff.error || archive.error ? (
        <ErrorState
          title="تعذّر تحميل بيانات الفريق"
          message="حدث خطأ أثناء تحميل المضيفين والأجور. أعد المحاولة."
          onRetry={() => {
            void staff.refetch();
            void archive.refetch();
          }}
        />
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
