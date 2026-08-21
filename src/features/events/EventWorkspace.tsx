import { useState } from "react";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { EditEventDialog } from "./workspace/EditEventDialog";
import { AttendancePanel } from "@/features/staff/AttendancePanel";
import { HostPayrollPanel } from "@/features/staff/HostPayrollPanel";
import { WarehousePanel } from "@/features/warehouse/WarehousePanel";
import { EventConsumablesPanel } from "@/features/consumables/EventConsumablesPanel";
import { EventPaymentsPanel } from "@/features/payments/EventPaymentsPanel";
import { InvoicesPanel } from "@/features/payments/InvoicesPanel";
import { EventFinancePanel } from "@/features/finance/EventFinancePanel";
import { EventProcurementPanel } from "@/features/procurement/EventProcurementPanel";
import { EquipmentTab } from "./workspace/EquipmentTab";
import { EventWorkspaceHeader } from "./workspace/EventWorkspaceHeader";
import { HistoryTab } from "./workspace/HistoryTab";
import { OverviewTab } from "./workspace/OverviewTab";
import { PricingTab } from "./workspace/PricingTab";
import { TeamTab } from "./workspace/TeamTab";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
import { pickLinkedQuote } from "./eventWorkspace.model";
import { buildReadinessReport } from "./readinessReport";
import { useEventWorkspace } from "./useEventWorkspace";

export function EventWorkspace() {
  const ws = useEventWorkspace();
  // Hook-first: edit dialog state lives above the early returns (rules of
  // hooks) even though the dialog only renders for editable events.
  const [editOpen, setEditOpen] = useState(false);

  if (ws.isLoading) {
    return <LoadingState label="جارٍ تحميل المناسبة…" />;
  }
  if (ws.isMissing) {
    return <p>تعذر العثور على المناسبة.</p>;
  }

  const ev = ws.event.data!;
  const d = ws.data.data!;
  const customerName =
    ws.customers.data?.rows.find((c) => c.id === ev.customer_id)?.name ?? null;
  const canEdit =
    ws.canAttendance && ["DRAFT", "QUOTED"].includes(ev.status);

  // Pure derivation over already-loaded workspace data (cheap, no hook).
  const readinessReport = buildReadinessReport({
    lines: d.lines,
    assignments: d.assignments,
    capacities: d.capacities,
    reservations: d.reservations,
    hasPayableAcceptedQuotation:
      (ws.finance.data?.acceptedRevenueMilli ?? 0) > 0,
    amountPaidMilli: ws.finance.data?.amountPaidMilli ?? 0,
  });

  const linkedQuote = pickLinkedQuote(d.quotes, ev.accepted_quotation_id);

  return (
    <div className="space-y-5">
      <EventWorkspaceHeader
        event={ev}
        voiceSummary={ws.voiceSummary}
        canEdit={canEdit}
        onEdit={() => setEditOpen(true)}
      />
      <WorkspaceTabs tab={ws.tab} tabs={ws.visibleTabs} onChange={ws.setTab} />
      {ws.error && <InlineError message={ws.error} />}

      {editOpen && (
        <EditEventDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          orgId={ws.orgId}
          event={ev}
        />
      )}

      {ws.tab === "ملخص" && (
        <OverviewTab
          event={ev}
          customerName={customerName}
          canCommercial={ws.canCommercial}
          canFinance={ws.canFinance}
          run={ws.run}
          report={readinessReport}
          history={d.history}
          acceptedQuote={linkedQuote}
          financiallyClosed={false}
          onOpenTab={ws.setTab}
        />
      )}

      {ws.tab === "التسعير" && (
        <PricingTab
          event={ev}
          lines={d.lines}
          quotes={d.quotes}
          canCost={ws.canCost}
          canCommercial={ws.canCommercial}
          deps={{ packages: ws.packages.data ?? [], run: ws.run }}
        />
      )}

      {ws.tab === "الفريق" && (
        <TeamTab
          staff={d.staff}
          assignments={d.assignments}
          run={ws.run}
          canAssign={ws.canAttendance}
          canCost={ws.canCost}
          onOpenAttendance={
            ws.canAttendance ? () => ws.setTab("الحضور") : undefined
          }
        />
      )}

      {ws.tab === "المعدات" && (
        <EquipmentTab
          orgId={ws.orgId}
          capacities={d.capacities}
          reservations={d.reservations}
          canProvision={ws.canCommercial}
          run={ws.run}
        />
      )}

      {ws.tab === "المخزن" && (
        <WarehousePanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          eventStatus={ev.status}
          role={ws.currentRole}
          canReadCost={ws.canCost}
        />
      )}

      {ws.tab === "المواد" && (
        <EventConsumablesPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          eventStatus={ev.status}
          role={ws.currentRole}
        />
      )}

      {ws.tab === "المشتريات" && ws.procurementDataSource && (
        <EventProcurementPanel
          eventId={ws.eventId}
          dataSource={ws.procurementDataSource}
          access={ws.procurementAccess}
        />
      )}

      {ws.tab === "المدفوعات" && (
        <EventPaymentsPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          canReadCost={ws.canCost}
          canMutate={ws.canFinance}
        />
      )}

      {ws.tab === "الفواتير" && (
        <InvoicesPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          eventNumber={ev.event_number}
          canReadCost={ws.canCost}
          canMutate={ws.canFinance}
          acceptedRevenueMilli={
            // null while the finance read model is unresolved: unknown must
            // render as loading, never as a fabricated 0 that claims
            // "no accepted quotation".
            ws.finance.data !== undefined
              ? (ws.finance.data?.acceptedRevenueMilli ?? 0)
              : null
          }
        />
      )}

      {ws.tab === "المالية" && (
        <EventFinancePanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          canMutate={ws.canFinance}
        />
      )}

      {ws.tab === "الحضور" && (
        <AttendancePanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          canMutate={ws.canAttendance}
          assignments={d.assignments.map((a) => ({
            id: a.id,
            staffMemberId: a.staff_member_id,
            assignmentRole: a.assignment_role,
            scheduledStart: a.scheduled_start,
            scheduledEnd: a.scheduled_end,
            status: a.status,
          }))}
          staffList={d.staff.map((s) => ({
            id: s.id,
            name: s.name,
            staffType: s.staff_type,
            defaultCompensationMethod: s.default_compensation_method,
            defaultRate: s.default_rate,
          }))}
        />
      )}

      {ws.tab === "الأجور" && (
        <HostPayrollPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          canMutate={ws.canFinance}
        />
      )}

      {ws.tab === "السجل" && (
        <HistoryTab
          history={d.history}
          audit={ws.canCommercial ? (ws.audit.data ?? []) : []}
        />
      )}
    </div>
  );
}
