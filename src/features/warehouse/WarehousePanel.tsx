/**
 * Warehouse control panel inside the Event workspace.
 *
 * Designed for a phone or tablet on a warehouse floor, Arabic-first RTL:
 *  - every quantity is a large tap target with +/- steppers, so the common
 *    case needs no typing at all;
 *  - "صرف الكل" / "إرجاع الكل" cover the dominant full-load actions in one tap;
 *  - blocked controls always state WHY, in Arabic;
 *  - no raw UUIDs and no PostgreSQL error text ever reach the screen;
 *  - the irreversible final reconciliation requires an explicit confirmation.
 */

import type { AppRole } from "@/lib/dbTypes";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { QuantityStat } from "@/components/ui/QuantityStat";
import {
  WAREHOUSE_STATUS_LABELS,
  WAREHOUSE_STATUS_TONES,
  canOperateWarehouse,
  canReconcileWarehouse,
  warehouseErrorMessage,
} from "./warehouse.model";
import { useWarehousePanel } from "./useWarehousePanel";
import { WarehouseLineCard } from "./WarehouseLineCard";
import { WarehouseReconcileSection } from "./WarehouseReconcileSection";
import { DeliverySignature } from "./DeliverySignature";

interface WarehousePanelProps {
  orgId: string | null;
  eventId: string;
  eventStatus: string;
  role: AppRole | null;
  /** Server capability report (0079) — null while loading. */
  capabilities: Set<string> | null;
  canReadCost: boolean;
}

export function WarehousePanel({
  orgId,
  eventId,
  eventStatus,
  role,
  capabilities,
  canReadCost,
}: WarehousePanelProps) {
  const panel = useWarehousePanel({ orgId, eventId, canReadCost });
  const { warehouse } = panel;

  if (warehouse.isLoading) {
    return <LoadingState label="جارٍ تحميل حالة المخزن…" />;
  }
  if (warehouse.isError) {
    return <InlineError message={warehouseErrorMessage(warehouse.error)} />;
  }
  if (!warehouse.data) return <p>تعذر تحميل حالة المخزن.</p>;

  const { lines, defects, summary } = warehouse.data;
  // 0079: movements are warehouse.dispatch, reconciliation is warehouse.reconcile.
  const canOperate = canOperateWarehouse(role, capabilities);
  const canReconcile = canReconcileWarehouse(role, capabilities);
  // Evidence capture is still ROLE-based server-side: the attachments storage
  // policy (0074) allows OWNER/MANAGER/WAREHOUSE only, and 0079 left it that
  // way — so the UI mirrors the role set, not a capability.
  const canCaptureEvidence =
    role === "OWNER" || role === "MANAGER" || role === "WAREHOUSE";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">حالة التسوية</p>
            <Badge tone={WAREHOUSE_STATUS_TONES[summary.status]} className="mt-1 text-base">
              {WAREHOUSE_STATUS_LABELS[summary.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuantityStat label="المحجوز" value={summary.reserved} tone="neutral" />
            <QuantityStat label="تم صرفه" value={summary.dispatched} tone="brand" />
            <QuantityStat label="تم إرجاعه" value={summary.returned_good} tone="success" />
            <QuantityStat label="تالف" value={summary.damaged} tone="danger" />
            <QuantityStat label="مفقود" value={summary.lost} tone="danger" />
            <QuantityStat
              label="متبقي بالخارج"
              value={summary.outstanding}
              tone={summary.outstanding > 0 ? "warning" : "success"}
            />
          </div>
        </div>
      </Card>

      {panel.error && <InlineError message={panel.error} />}

      {defects.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <p className="font-black text-red-800">
            بيانات غير مكتملة في {defects.length} سطر من أسطر المعدات. لا تُعرض
            كميات غير موثوقة — راجع المسؤول قبل التسوية.
          </p>
        </Card>
      )}

      {lines.length === 0 ? (
        <Card>
          <p className="font-bold text-slate-600">
            لا توجد معدات محجوزة لهذه المناسبة. احجز المعدات أولاً من تبويب المعدات.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <WarehouseLineCard
              key={line.reservationId}
              orgId={orgId}
              line={line}
              eventStatus={eventStatus}
              canOperate={canOperate}
              canReadCost={canReadCost}
              canCaptureEvidence={canCaptureEvidence}
              busy={panel.busy}
              onDispatch={(l, q, r) => void panel.runDispatch(l, q, r)}
              onReturn={(l, q, n) => void panel.runReturn(l, q, n)}
            />
          ))}
        </div>
      )}

      <WarehouseReconcileSection
        canReconcile={canReconcile}
        summary={summary}
        busy={panel.busy}
        confirming={panel.confirmingReconcile}
        onStartConfirm={() => panel.setConfirmingReconcile(true)}
        onCancel={() => panel.setConfirmingReconcile(false)}
        notes={panel.reconcileNotes}
        onNotesChange={panel.setReconcileNotes}
        onConfirm={() => void panel.runReconcile()}
      />

      {orgId && lines.length > 0 && (
        <DeliverySignature orgId={orgId} eventId={eventId} canEdit={canCaptureEvidence} />
      )}
    </div>
  );
}
