/**
 * Event consumables panel inside the Event workspace (S4B).
 *
 * The operator sees, per item: تم صرفه / مرتجع صالح / تم استهلاكه / هالك /
 * المتبقي مع المناسبة, plus the Event-level "حالة التسوية" badge. Actions:
 *  - صرف للمناسبة (issue from tracked stock, blocked on shortage);
 *  - مرتجع صالح (usable return to warehouse);
 *  - تم استهلاكه (actual consumption);
 *  - هالك (event waste, reason required);
 *  - التسوية النهائية (OWNER/MANAGER, explicit confirmation, irreversible).
 *
 * All Arabic/RTL, large touch targets, exact decimal quantities, explicit
 * blocked reasons, and no raw UUID / SQL error ever reaches the screen.
 */

import type { AppRole } from "@/lib/dbTypes";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { QuantityStat } from "@/components/ui/QuantityStat";
import {
  CONSUMABLE_STATUS_LABELS,
  CONSUMABLE_STATUS_TONES,
  canManageConsumables,
  canOperateConsumables,
  consumableErrorMessage,
  formatQuantity,
  issueBlock,
  issueBlockMessage,
} from "./consumables.model";
import { CustodyLineCard } from "./CustodyLineCard";
import { EventConsumablesReconcileSection } from "./EventConsumablesReconcileSection";
import { IssueStockForm } from "./IssueStockForm";
import { useEventConsumablesPanel } from "./useEventConsumablesPanel";

interface EventConsumablesPanelProps {
  orgId: string | null;
  eventId: string;
  eventStatus: string;
  role: AppRole | null;
  /** Server capability report (null while loading) — 0079. */
  capabilities: Set<string> | null;
}

export function EventConsumablesPanel({
  orgId,
  eventId,
  eventStatus,
  role,
  capabilities,
}: EventConsumablesPanelProps) {
  const panel = useEventConsumablesPanel({ orgId, eventId });
  const { eventConsumables } = panel;
  const canOperate = canOperateConsumables(role, capabilities);
  const canManage = canManageConsumables(role, capabilities);

  if (eventConsumables.isLoading) {
    return <LoadingState label="جارٍ تحميل مواد المناسبة…" />;
  }
  if (eventConsumables.isError) {
    return <InlineError message={consumableErrorMessage(eventConsumables.error)} />;
  }
  if (!eventConsumables.data || eventConsumables.data.summary === null) {
    return <p>تعذر تحميل حالة مواد المناسبة.</p>;
  }

  const { lines, defects, summary } = eventConsumables.data;
  const iBlock = issueBlock({
    canOperate,
    eventStatus,
    isReconciled: summary.isReconciled,
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">حالة التسوية</p>
            <Badge
              tone={CONSUMABLE_STATUS_TONES[summary.status]}
              className="mt-1 text-base"
            >
              {CONSUMABLE_STATUS_LABELS[summary.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuantityStat label="تم صرفه" value={formatQuantity(summary.issuedMilli)} tone="brand" />
            <QuantityStat label="مرتجع صالح" value={formatQuantity(summary.returnedMilli)} tone="success" />
            <QuantityStat label="تم استهلاكه" value={formatQuantity(summary.consumedMilli)} tone="neutral" />
            <QuantityStat label="هالك" value={formatQuantity(summary.wastedMilli)} tone="danger" />
            <QuantityStat
              label="المتبقي مع المناسبة"
              value={formatQuantity(summary.outstandingMilli)}
              tone={summary.outstandingMilli > 0 ? "warning" : "success"}
            />
          </div>
        </div>
      </Card>

      {panel.error && <InlineError message={panel.error} />}

      {defects.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <p className="font-black text-red-800">
            بيانات غير مكتملة في {defects.length} سطر من مواد المناسبة. لا تُعرض
            كميات غير موثوقة — راجع المسؤول قبل التسوية.
          </p>
        </Card>
      )}

      {!summary.isReconciled && (
        <IssueStockForm
          blockMessage={iBlock.blocked ? issueBlockMessage(iBlock) : null}
          stockLines={panel.stockLines}
          selectedStock={panel.selectedStock}
          stockItemId={panel.issueStockItemId}
          onStockItemIdChange={panel.setIssueStockItemId}
          quantityText={panel.issueQuantityText}
          onQuantityTextChange={panel.setIssueQuantityText}
          localError={panel.issueLocalError}
          busy={panel.busy}
          onSubmit={() => void panel.runIssue()}
        />
      )}

      {lines.length === 0 ? (
        <Card>
          <p className="font-bold text-slate-600">
            لم تُصرف مواد استهلاكية لهذه المناسبة بعد.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <CustodyLineCard
              key={line.stockItemId}
              line={line}
              canOperate={canOperate}
              busy={panel.busy}
              onMove={(kind, l, q, n) => void panel.runCustody(kind, l, q, n)}
            />
          ))}
        </div>
      )}

      <EventConsumablesReconcileSection
        canManage={canManage}
        summary={summary}
        busy={panel.busy}
        confirming={panel.confirmingReconcile}
        onStartConfirm={() => panel.setConfirmingReconcile(true)}
        onCancel={() => panel.setConfirmingReconcile(false)}
        notes={panel.reconcileNotes}
        onNotesChange={panel.setReconcileNotes}
        onConfirm={() => void panel.runReconcile()}
      />
    </div>
  );
}
