import { useState } from "react";
import {
  Briefcase,
  ClipboardCheck,
  ClipboardX,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useAuth } from "@/app/authContext";
import { buildDocumentIdentity } from "@/components/documents/documentIdentity";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import {
  useEventProcurementOpsLines,
  useEventTeamSheet,
  useEventWorkOrderHeader,
  useWarehouseSheetLines,
} from "@/features/documents/documents.api";
import { PrintDocumentDialog } from "@/features/documents/PrintDocumentDialog";
import { WarehouseSheet } from "@/features/documents/WarehouseSheet";
import { TeamSheet } from "@/features/documents/TeamSheet";
import { WorkOrderDocument } from "@/features/documents/WorkOrderDocument";
import { EditEventDialog } from "./workspace/EditEventDialog";
import { EventCommandCenter } from "./workspace/EventCommandCenter";
import { useEventCommandCenter } from "./commandCenter.api";
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
import { useEventWorkspace } from "./useEventWorkspace";

export function EventWorkspace() {
  const ws = useEventWorkspace();
  const { currentOrganization } = useAuth();
  const settings = useOrganizationSettings(ws.orgId);
  const commandCenter = useEventCommandCenter(ws.orgId, ws.eventId);
  // Hook-first: edit dialog state lives above the early returns (rules of
  // hooks) even though the dialog only renders for editable events.
  const [editOpen, setEditOpen] = useState(false);
  // One print entry point per document mode; every projection is fetched
  // lazily (only while its document is open) and org-keyed like the rest of
  // the document family.
  const [docMode, setDocMode] = useState<WorkspaceDocMode | null>(null);
  const sheetLines = useWarehouseSheetLines(
    ws.orgId,
    docMode === "PREP" || docMode === "RETURN" || docMode === "WORK_ORDER"
      ? ws.eventId
      : null,
  );
  const teamSheet = useEventTeamSheet(
    ws.orgId,
    docMode === "TEAM" || docMode === "WORK_ORDER" ? ws.eventId : null,
  );
  const workOrder = useEventWorkOrderHeader(
    ws.orgId,
    docMode === "WORK_ORDER" ? ws.eventId : null,
  );
  const procurementOps = useEventProcurementOpsLines(
    ws.orgId,
    docMode === "WORK_ORDER" ? ws.eventId : null,
  );

  if (ws.isLoading) {
    return <LoadingState label="جارٍ تحميل المناسبة…" />;
  }
  if (ws.isMissing) {
    return <p>تعذر العثور على المناسبة.</p>;
  }

  const ev = ws.event.data!;
  const d = ws.data.data!;
  const center = commandCenter.data ?? null;
  const customerName =
    ws.customers.data?.rows.find((c) => c.id === ev.customer_id)?.name ?? null;
  const canEdit =
    ws.canAttendance && ["DRAFT", "QUOTED"].includes(ev.status);

  const linkedQuote = pickLinkedQuote(d.quotes, ev.accepted_quotation_id);

  return (
    <div className="space-y-5">
      <EventWorkspaceHeader
        event={ev}
        voiceSummary={ws.voiceSummary}
        canEdit={canEdit}
        onEdit={() => setEditOpen(true)}
      />

      {/*
        Command center above the detailed tabs (Scope C): one server
        projection answers "what does this event still need?" — the tabs
        below keep every expert detail exactly where it was.
      */}
      {ws.tab === "ملخص" && center && (
        <EventCommandCenter
          center={center}
          canReadMoney={ws.canCost}
          eventStatus={ev.status}
          onOpenTab={ws.setTab}
        />
      )}

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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDocMode("WORK_ORDER")}>
              <Briefcase className="h-4 w-4" />
              طباعة أمر تشغيل المناسبة
            </Button>
          </div>
          <OverviewTab
            event={ev}
            customerName={customerName}
            canManage={ws.canManage}
            canCost={ws.canCost}
            canFinance={ws.canFinance}
            run={ws.run}
            readiness={d.readiness}
            history={d.history}
            acceptedQuote={linkedQuote}
            financiallyClosed={false}
            onOpenTab={ws.setTab}
          />
        </div>
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDocMode("TEAM")}>
              <Users className="h-4 w-4" />
              طباعة كشف فريق المناسبة
            </Button>
          </div>
          <TeamTab
            staff={d.staff}
            assignments={d.assignments}
            run={ws.run}
            canAssign={ws.canAssignStaff}
            canCost={ws.canCost}
            onOpenAttendance={
              ws.canAttendance ? () => ws.setTab("الحضور") : undefined
            }
          />
        </div>
      )}

      {ws.tab === "المعدات" && (
        <EquipmentTab
          orgId={ws.orgId}
          capacities={d.capacities}
          reservations={d.reservations}
          canProvision={ws.canDispatch}
          run={ws.run}
        />
      )}

      {ws.tab === "المخزن" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDocMode("PREP")}>
              <ClipboardCheck className="h-4 w-4" />
              أمر تجهيز المخزن
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDocMode("RETURN")}>
              <ClipboardX className="h-4 w-4" />
              كشف استرجاع المخزن
            </Button>
          </div>
          <WarehousePanel
            orgId={ws.orgId}
            eventId={ws.eventId}
            eventStatus={ev.status}
            role={ws.currentRole}
            capabilities={ws.capabilities}
            canReadCost={ws.canCost}
          />
        </div>
      )}

      {ws.tab === "المواد" && (
        <EventConsumablesPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          eventStatus={ev.status}
          role={ws.currentRole}
          capabilities={ws.capabilities}
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
          canRecord={ws.canRecordPayment}
          canVoid={ws.canVoidPayment}
        />
      )}

      {ws.tab === "الفواتير" && (
        <InvoicesPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          eventNumber={ev.event_number}
          customerName={customerName}
          canReadCost={ws.canCost}
          canMutate={ws.canInvoices}
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
          canReadPayroll={ws.canPayroll}
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
          }))}
        />
      )}

      {ws.tab === "الأجور" && (
        <HostPayrollPanel
          orgId={ws.orgId}
          eventId={ws.eventId}
          canMutate={ws.canPayrollPay}
        />
      )}

      {ws.tab === "السجل" && (
        <HistoryTab
          history={d.history}
          audit={ws.canViewAudit ? (ws.audit.data ?? []) : []}
        />
      )}

      {docMode && (
        <PrintDocumentDialog
          open
          onOpenChange={(open) => {
            if (!open) setDocMode(null);
          }}
          title={DOC_DIALOG_META[docMode].title}
          description={DOC_DIALOG_META[docMode].description}
        >
          {(docMode === "PREP" || docMode === "RETURN") && (
            <>
              {sheetLines.isLoading && (
                <div className="flex justify-center py-10">
                  <Spinner className="h-7 w-7" />
                </div>
              )}
              {!sheetLines.isLoading && (
                <WarehouseSheet
                  identity={buildDocumentIdentity(
                    currentOrganization,
                    settings.data ?? null,
                  )}
                  mode={docMode}
                  eventNumber={ev.event_number}
                  eventTitle={ev.title}
                  printedAt={new Date().toISOString()}
                  rows={sheetLines.data ?? []}
                />
              )}
              {!sheetLines.isLoading && (sheetLines.data ?? []).length === 0 && (
                <EmptyState
                  title="لا توجد بنود"
                  description="لا توجد بنود تشغيلية لهذه المناسبة بعد."
                />
              )}
            </>
          )}

          {docMode === "TEAM" && (
            <>
              {teamSheet.isLoading && (
                <div className="flex justify-center py-10">
                  <Spinner className="h-7 w-7" />
                </div>
              )}
              {!teamSheet.isLoading && (
                <TeamSheet
                  identity={buildDocumentIdentity(
                    currentOrganization,
                    settings.data ?? null,
                  )}
                  eventNumber={ev.event_number}
                  eventTitle={ev.title}
                  printedAt={new Date().toISOString()}
                  rows={teamSheet.data ?? []}
                />
              )}
              {!teamSheet.isLoading && (teamSheet.data ?? []).length === 0 && (
                <EmptyState
                  title="لا يوجد فريق"
                  description="لم يُسند فريق لهذه المناسبة بعد."
                />
              )}
            </>
          )}

          {docMode === "WORK_ORDER" && (
            <>
              {(workOrder.isLoading || teamSheet.isLoading || sheetLines.isLoading || procurementOps.isLoading) && (
                <div className="flex justify-center py-10">
                  <Spinner className="h-7 w-7" />
                </div>
              )}
              {!workOrder.isLoading && workOrder.data && (
                <WorkOrderDocument
                  identity={buildDocumentIdentity(
                    currentOrganization,
                    settings.data ?? null,
                  )}
                  header={workOrder.data}
                  teamRows={teamSheet.data ?? []}
                  warehouseRows={sheetLines.data ?? []}
                  procurementRows={procurementOps.data ?? []}
                  printedAt={new Date().toISOString()}
                />
              )}
              {!workOrder.isLoading && !workOrder.data && (
                <EmptyState
                  title="تعذر تجهيز أمر التشغيل"
                  description="لم يُعثر على بيانات هذه المناسبة للطباعة."
                />
              )}
            </>
          )}
        </PrintDocumentDialog>
      )}
    </div>
  );
}

/**
 * The event-workspace document modes: one dialog, one print pattern, and one
 * server-authoritative projection per document (0080/0081).
 */
type WorkspaceDocMode = "PREP" | "RETURN" | "TEAM" | "WORK_ORDER";

const DOC_DIALOG_META: Record<WorkspaceDocMode, { title: string; description: string }> = {
  PREP: {
    title: "أمر تجهيز المخزن",
    description:
      "كميات رسمية من بيانات المناسبة — بلا أي بيانات مالية، للتعبئة والتوقيع على الورق.",
  },
  RETURN: {
    title: "كشف استرجاع المخزن",
    description:
      "كميات الإرسال والاسترجاع الرسمية — أعمدة التلف والفقد للتدوين على الورق.",
  },
  TEAM: {
    title: "كشف فريق المناسبة",
    description:
      "كشف تشغيلي للفريق المسند — بلا أي بيانات أجور أو معدلات.",
  },
  WORK_ORDER: {
    title: "أمر تشغيل المناسبة",
    description:
      "ملخص تشغيلي للتنفيذ المكتبي والميداني — لا يتضمن تكاليف أو هوامش أو أجور.",
  },
};
