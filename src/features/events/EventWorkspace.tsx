import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { AttendancePanel } from "@/features/staff/AttendancePanel";
import { HostPayrollPanel } from "@/features/staff/HostPayrollPanel";
import { WarehousePanel } from "@/features/warehouse/WarehousePanel";
import { EventConsumablesPanel } from "@/features/consumables/EventConsumablesPanel";
import { EventPaymentsPanel } from "@/features/payments/EventPaymentsPanel";
import { InvoicesPanel } from "@/features/payments/InvoicesPanel";
import { EventProcurementPanel } from "@/features/procurement/EventProcurementPanel";
import { EquipmentTab } from "./workspace/EquipmentTab";
import { EventWorkspaceHeader } from "./workspace/EventWorkspaceHeader";
import { HistoryTab } from "./workspace/HistoryTab";
import { OverviewTab } from "./workspace/OverviewTab";
import { PricingTab } from "./workspace/PricingTab";
import { ReadinessBanner } from "./workspace/ReadinessBanner";
import { TeamTab } from "./workspace/TeamTab";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
import { useEventWorkspace } from "./useEventWorkspace";

export function EventWorkspace() {
  const ws = useEventWorkspace();

  if (ws.isLoading) {
    return <LoadingState label="جارٍ تحميل المناسبة…" />;
  }
  if (ws.isMissing) {
    return <p>تعذر العثور على المناسبة.</p>;
  }

  const ev = ws.event.data!;
  const d = ws.data.data!;
  const customerName =
    ws.customers.data?.find((c) => c.id === ev.customer_id)?.name ?? null;

  return (
    <div className="space-y-5">
      <EventWorkspaceHeader event={ev} voiceSummary={ws.voiceSummary} />
      <ReadinessBanner readiness={d.readiness} />
      <WorkspaceTabs tab={ws.tab} tabs={ws.visibleTabs} onChange={ws.setTab} />
      {ws.error && <InlineError message={ws.error} />}

      {ws.tab === "ملخص" && (
        <OverviewTab
          event={ev}
          customerName={customerName}
          canCommercial={ws.canCommercial}
          run={ws.run}
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
        <TeamTab staff={d.staff} assignments={d.assignments} run={ws.run} />
      )}

      {ws.tab === "المعدات" && (
        <EquipmentTab
          capacities={d.capacities}
          reservations={d.reservations}
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
            ws.finance.data ? ws.finance.data.acceptedRevenueMilli : 0
          }
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

      {ws.tab === "السجل" && <HistoryTab history={d.history} />}
    </div>
  );
}
