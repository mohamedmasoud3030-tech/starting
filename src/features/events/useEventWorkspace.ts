import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { canAssignStaffFor } from "@/app/authRoles";
import { fromDbAmount, toOMRString } from "@/lib/money";
import { useCustomers } from "@/features/customers/customers.api";
import { usePackages } from "@/features/packages/packages.api";
import {
  buildAttendanceVoiceSummary,
  buildEventVoiceSummary,
  buildInvoiceVoiceSummary,
  buildPaymentsVoiceSummary,
  buildPayrollVoiceSummary,
  buildQuoteVoiceSummary,
} from "@/features/ownerVoice/screenSummary";
import { useEventAttendance, useEventPayroll } from "@/features/staff/staff.api";
import { useEventInstallments, useEventInvoice } from "@/features/payments/invoices.api";
import { useEventFinance } from "@/features/payments";
import { useProcurementDataSource } from "@/features/procurement";
import {
  arabicError,
  useEvent,
  useEventAudit,
  useEventCommand,
  useWorkspaceData,
} from "./events.api";
import {
  eventPermissions,
  resolveActiveTab,
  visibleWorkspaceTabs,
  voiceSummaryForTab,
  type VoiceSummaries,
  type WorkspaceTab,
} from "./eventWorkspace.model";

/**
 * Controller for the Event workspace: data orchestration, command execution,
 * active-tab state, and the derived voice summaries. Pure presentation lives
 * in the workspace/ components; this hook holds the workflow.
 */
export function useEventWorkspace() {
  const { eventId } = useParams({ from: "/app/events/$eventId" });
  const { currentOrganization, currentRole, capabilities } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const perms = eventPermissions(currentRole, capabilities);
  const {
    canCost,
    canCommercial,
    canManage,
    canFinance,
    canInvoices,
    canPayroll,
    canPayrollPay,
    canDispatch,
    canAttendance,
    canProcure,
    canRecordPayment,
    canVoidPayment,
  } = perms;

  const procurementDataSource = useProcurementDataSource();
  const procurementAccess = useMemo(
    () => ({
      canViewCommercialAmounts: canCost,
      // Supplier/order commands are gated server-side by procurement.manage.
      canCreateSupplier: canProcure,
      canCreateOrder: canProcure,
    }),
    [canCost, canProcure],
  );

  const event = useEvent(orgId, eventId);
  const data = useWorkspaceData(orgId, eventId, canCost);
  const finance = useEventFinance(orgId, eventId);
  const attendance = useEventAttendance(orgId, eventId);
  // The audit trail's SELECT RLS is still ROLE-based (audit_events_select_admins:
  // OWNER/MANAGER) — 0079 deliberately left it that way — so the UI gates on the
  // membership role, not on a capability the server does not check here.
  const canViewAudit =
    currentRole === "OWNER" || currentRole === "MANAGER";
  const audit = useEventAudit(orgId, eventId, canViewAudit);
  // Staff assign/release: server gate is role-based (O/M/SUPERVISOR), not a capability.
  const canAssignStaff = canAssignStaffFor(currentRole);
  const payroll = useEventPayroll(orgId, eventId);
  const invoice = useEventInvoice(orgId, eventId);
  const invoiceRows = useEventInstallments(orgId, eventId);
  const packages = usePackages(orgId);
  const customers = useCustomers(orgId);
  const command = useEventCommand(orgId, eventId);

  const [requestedTab, setTab] = useState<WorkspaceTab>("ملخص");
  /**
   * Tabs are filtered by role, so the active tab is resolved against what the
   * role can actually reach. This keeps the workspace consistent if the role
   * changes underneath it (e.g. switching to an organization where the user holds
   * a different role) instead of stranding the user on a refusal screen.
   */
  const visibleTabs = visibleWorkspaceTabs(perms);
  const tab = resolveActiveTab(requestedTab, perms);
  const [error, setError] = useState("");

  async function run(
    name: string,
    args: Record<string, unknown>,
    includeEvent = true,
  ) {
    setError("");
    try {
      await command.mutateAsync({ name, args, includeEvent });
    } catch (x) {
      setError(arabicError(x));
    }
  }

  // Attendance / payroll / invoice voice summaries (data-only, safe always).
  const attList = attendance.data ?? [];
  const attEarnedMilli = attList
    .filter((a) => a.recordStatus === "RECORDED")
    .reduce((n, a) => n + a.earnedMilli, 0);
  const attPresent = attList.filter(
    (a) => a.recordStatus === "RECORDED" && a.status !== "ABSENT",
  ).length;
  const attTotal = attList.filter((a) => a.recordStatus === "RECORDED").length;
  const attendanceVoiceSummary = useMemo(
    () =>
      buildAttendanceVoiceSummary({
        earnedOmr: toOMRString(attEarnedMilli),
        presentCount: attPresent,
        totalCount: attTotal,
      }),
    [attEarnedMilli, attPresent, attTotal],
  );

  const payRows = payroll.data ?? [];
  const payDue = payRows.reduce((n, r) => n + r.dueMilli, 0);
  const payPaid = payRows.reduce((n, r) => n + r.paidMilli, 0);
  const payLate = payRows.reduce((n, r) => n + r.lateMilli, 0);
  const payAdv = payRows.reduce((n, r) => n + r.advancesMilli, 0);
  const payrollVoiceSummary = useMemo(
    () =>
      buildPayrollVoiceSummary({
        dueOmr: toOMRString(payDue),
        paidOmr: toOMRString(payPaid),
        lateOmr: toOMRString(payLate),
        advancesOmr: toOMRString(payAdv),
        hostCount: payRows.length,
      }),
    [payDue, payPaid, payLate, payAdv, payRows.length],
  );

  const inv = invoice.data;
  const invoiceVoiceSummary = useMemo(() => {
    const installmentRows = invoiceRows.data ?? [];
    return buildInvoiceVoiceSummary({
      totalOmr: inv ? toOMRString(inv.totalMilli) : null,
      paidOmr: inv ? toOMRString(inv.paidMilli) : null,
      remainingOmr: inv ? toOMRString(inv.remainingMilli) : null,
      installmentCount: installmentRows.length,
      paidInstallments: installmentRows.filter(
        (r) => r.effectiveStatus === "PAID",
      ).length,
    });
  }, [inv, invoiceRows.data]);

  const isLoading = event.isLoading || data.isLoading;
  const isMissing = !event.data || !data.data;

  // Overview / pricing / payments summaries need the loaded event + data.
  const overviewVoiceSummary = useMemo(() => {
    if (!event.data || !data.data) return "";
    const customerName =
      customers.data?.rows.find((c) => c.id === event.data.customer_id)?.name ?? null;
    return buildEventVoiceSummary({
      event: { ...event.data, customer_name: customerName },
      readiness: data.data.readiness,
    });
  }, [event.data, data.data, customers.data]);

  const pricingVoiceSummary = useMemo(() => {
    if (!data.data) return "";
    const totalSellMilli = data.data.lines.reduce(
      (n, l) => n + fromDbAmount(l.total_selling),
      0,
    );
    const totalCostMilli = data.data.lines.reduce(
      (n, l) => n + fromDbAmount(l.total_expected_cost),
      0,
    );
    const latestQuote = data.data.quotes[0] ?? null;
    return buildQuoteVoiceSummary({
      totalSellingOmr: toOMRString(totalSellMilli),
      expectedCostOmr: canCost ? toOMRString(totalCostMilli) : null,
      expectedProfitOmr: canCost
        ? toOMRString(totalSellMilli - totalCostMilli)
        : null,
      canReadCost: canCost,
      quotationNumber: latestQuote?.quotation_number ?? null,
      quotationStatus: latestQuote?.status ?? null,
    });
  }, [data.data, canCost]);

  const paymentsVoiceSummary = useMemo(() => {
    if (!finance.data) return "";
    return buildPaymentsVoiceSummary({
      acceptedRevenueOmr: toOMRString(finance.data.acceptedRevenueMilli),
      paidOmr: toOMRString(finance.data.amountPaidMilli),
      outstandingOmr: toOMRString(finance.data.outstandingMilli),
      committedCostOmr:
        canCost && finance.data
          ? toOMRString(finance.data.committedCostMilli)
          : null,
      grossMarginOmr:
        canCost && finance.data
          ? toOMRString(finance.data.grossMarginMilli)
          : null,
      canReadCost: canCost,
    });
  }, [finance.data, canCost]);

  const summaries: VoiceSummaries = {
    overview: overviewVoiceSummary,
    pricing: pricingVoiceSummary,
    payments: paymentsVoiceSummary,
    invoices: invoiceVoiceSummary,
    attendance: attendanceVoiceSummary,
    payroll: payrollVoiceSummary,
  };
  const voiceSummary = voiceSummaryForTab(tab, summaries);

  return {
    // context
    orgId,
    eventId,
    currentRole,
    capabilities,
    canViewAudit,
    canAssignStaff,
    perms,
    canCost,
    canCommercial,
    canManage,
    canFinance,
    canInvoices,
    canPayroll,
    canPayrollPay,
    canDispatch,
    canAttendance,
    canProcure,
    canRecordPayment,
    canVoidPayment,
    // data + workflow
    event,
    data,
    finance,
    attendance,
    payroll,
    audit,
    invoice,
    invoiceRows,
    packages,
    customers,
    procurementDataSource,
    procurementAccess,
    command,
    run,
    tab,
    visibleTabs,
    setTab,
    error,
    // guards
    isLoading,
    isMissing,
    // derived
    voiceSummary,
  };
}
