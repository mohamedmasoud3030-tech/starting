import { useMemo, useState } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { canAssignStaffFor } from "@/app/authRoles";
import { useCustomers } from "@/features/customers/customers.api";
import { usePackages } from "@/features/packages/packages.api";
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
  isWorkspaceTab,
  resolveActiveTab,
  visibleWorkspaceTabs,
  type WorkspaceTab,
} from "./eventWorkspace.model";

/**
 * Controller for the Event workspace: data orchestration, command execution,
 * and the active-tab state. Pure presentation lives in the workspace/
 * components; this hook holds the workflow.
 */
export function useEventWorkspace() {
  const { eventId } = useParams({ from: "/app/events/$eventId" });
  // Deep-linked tab (command center / Today dashboard navigation targets) —
  // validated against the canonical tab vocabulary below.
  const search = useSearch({ from: "/app/events/$eventId" });
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

  const [requestedTab, setTab] = useState<WorkspaceTab>(() =>
    isWorkspaceTab(search.tab) ? search.tab : "ملخص",
  );
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

  const isLoading = event.isLoading || data.isLoading;
  const isMissing = !event.data || !data.data;

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
  };
}
