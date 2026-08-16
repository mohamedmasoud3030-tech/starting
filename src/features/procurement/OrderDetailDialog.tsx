import { PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState, InlineError } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { QuantityStat } from "@/components/ui/QuantityStat";
import { Textarea } from "@/components/ui/Textarea";
import { formatOMR } from "@/lib/money";
import { formatQuantity } from "./validation";
import type { Capability, ProcurementAccess, ProcurementDataSource } from "./contracts";
import { capabilityMessage } from "./errors";
import {
  ACTION_CONFIRM_LABELS,
  ACTION_EXPLANATION,
  ACTION_LABELS,
  ACTION_QUESTION,
  LINE_KIND_LABELS,
  formatProcurementDateTime,
  type LifecycleAction,
} from "./presentation";
import { ReceivingDialog } from "./ReceivingDialog";
import { useOrderDetail } from "./useOrderDetail";
import { OrderStatusBadge } from "./OrderCard";

function ActionControl({
  action,
  capability,
  onSelect,
}: {
  action: LifecycleAction;
  capability: Capability;
  onSelect: (action: LifecycleAction) => void;
}) {
  return (
    <div>
      <Button
        variant={action === "cancel" ? "danger" : action === "approve" ? "primary" : "secondary"}
        disabled={!capability.allowed}
        onClick={() => onSelect(action)}
      >
        {ACTION_LABELS[action]}
      </Button>
      {!capability.allowed && (
        <p className="mt-1 max-w-56 text-xs font-semibold text-slate-500">
          {capabilityMessage(capability.reason)}
        </p>
      )}
    </div>
  );
}

function QuantityStatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "green" | "amber";
}) {
  const toneMap = { slate: "neutral", green: "success", amber: "warning" } as const;
  return <QuantityStat label={label} value={formatQuantity(value)} tone={toneMap[tone]} />;
}

/** Order detail dialog: header, lines, receipts, lifecycle actions. */
export function OrderDetailDialog({
  orderId,
  dataSource,
  access,
  onClose,
  onChanged,
}: {
  orderId: string | null;
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detailState = useOrderDetail(dataSource, orderId, onChanged);
  const { detail, loading, loadError } = detailState;

  return (
    <>
      <Dialog
        open={orderId !== null}
        onOpenChange={(open) => !open && !detailState.busy && onClose()}
        title={detail ? `طلب ${detail.orderNumber}` : "تفاصيل طلب التوريد"}
        className="max-w-3xl"
      >
        {loading && (
          <LoadingState label="جارٍ تحميل الطلب…" />
        )}
        {!loading && loadError && (
          <ErrorState
            message={loadError}
            onRetry={detailState.reloadDetail}
          />
        )}
        {!loading && detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black">{detail.supplier.name}</h3>
                {detail.event ? (
                  <p className="mt-1 text-slate-600">المناسبة: {detail.event.title}</p>
                ) : (
                  <p className="mt-1 text-slate-500">طلب عام غير مرتبط بمناسبة</p>
                )}
              </div>
              <OrderStatusBadge status={detail.status} />
            </div>
            <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm text-slate-500">تاريخ الطلب</dt>
                <dd className="mt-1 font-bold">{formatProcurementDateTime(detail.orderedAt)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">موعد التوريد</dt>
                <dd className="mt-1 font-bold">{formatProcurementDateTime(detail.deliveryDueAt)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">توريدات متبقية</dt>
                <dd className="mt-1 font-black">{detail.outstandingDeliveryCount}</dd>
              </div>
              {access.canViewCommercialAmounts && detail.negotiatedTotalMilli != null && (
                <div>
                  <dt className="text-sm text-slate-500">المبلغ المتفق عليه</dt>
                  <dd className="mt-1 font-black">{formatOMR(detail.negotiatedTotalMilli)}</dd>
                </div>
              )}
            </dl>

            <section aria-labelledby="order-detail-lines" className="space-y-3">
              <h4 id="order-detail-lines" className="text-lg font-black">الأصناف / البنود</h4>
              {detail.lines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
                  لا توجد بنود في هذا الطلب.
                </p>
              ) : (
                detail.lines.map((line) => (
                  <article key={line.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h5 className="font-black">{line.description}</h5>
                        <p className="mt-1 text-sm text-slate-500">
                          {LINE_KIND_LABELS[line.kind]} · {line.unit}
                        </p>
                      </div>
                      {line.remainingQuantityMilli === 0 && (
                        <Badge tone="success">مكتمل</Badge>
                      )}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2">
                      <QuantityStatBox label="الكمية" value={line.orderedQuantityMilli} tone="slate" />
                      <QuantityStatBox label="المستلم" value={line.receivedQuantityMilli} tone="green" />
                      <QuantityStatBox
                        label="المتبقي"
                        value={line.remainingQuantityMilli}
                        tone={line.remainingQuantityMilli > 0 ? "amber" : "green"}
                      />
                    </dl>
                    {access.canViewCommercialAmounts &&
                      (line.unitCostMilli != null || line.lineTotalMilli != null) && (
                        <dl className="mt-3 flex flex-wrap gap-5 border-t border-slate-100 pt-3 text-sm">
                          {line.unitCostMilli != null && (
                            <div>
                              <dt className="text-slate-500">سعر الوحدة</dt>
                              <dd className="font-black">{formatOMR(line.unitCostMilli)}</dd>
                            </div>
                          )}
                          {line.lineTotalMilli != null && (
                            <div>
                              <dt className="text-slate-500">الإجمالي</dt>
                              <dd className="font-black">{formatOMR(line.lineTotalMilli)}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    {!line.receive.allowed && line.remainingQuantityMilli > 0 && (
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        {capabilityMessage(line.receive.reason)}
                      </p>
                    )}
                  </article>
                ))
              )}
            </section>

            {detail.receipts.length > 0 && (
              <section aria-labelledby="order-receipts">
                <h4 id="order-receipts" className="font-black">سجل الاستلام</h4>
                <ul className="mt-2 space-y-2">
                  {detail.receipts.map((receipt) => (
                    <li
                      key={receipt.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3"
                    >
                      <span className="font-bold">
                        {receipt.receiptNumber ? `استلام ${receipt.receiptNumber}` : "استلام مسجل"}
                      </span>
                      <span className="text-sm text-emerald-800">
                        {formatProcurementDateTime(receipt.receivedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail.notes && (
              <div>
                <h4 className="font-black">ملاحظات الطلب</h4>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{detail.notes}</p>
              </div>
            )}

            {detailState.success && (
              <p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">
                {detailState.success}
              </p>
            )}
            {detailState.actionError && !detailState.confirmAction && (
              <InlineError message={detailState.actionError} />
            )}

            {detailState.confirmAction ? (
              <ConfirmPanel
                title={ACTION_QUESTION[detailState.confirmAction]}
                description={ACTION_EXPLANATION[detailState.confirmAction]}
                confirmLabel={ACTION_CONFIRM_LABELS[detailState.confirmAction]}
                cancelLabel="العودة"
                confirmTone={detailState.confirmAction === "cancel" ? "danger" : "primary"}
                busy={detailState.busy}
                onConfirm={() => void detailState.runAction(detailState.confirmAction!)}
                onCancel={detailState.closeConfirm}
              >
                {detailState.confirmAction === "cancel" && (
                  <Field className="mt-3" label="سبب الإلغاء" htmlFor="procurement-cancel-reason" required>
                    <Textarea
                      id="procurement-cancel-reason"
                      rows={2}
                      value={detailState.cancelReason}
                      onChange={(event) => detailState.updateCancelReason(event.target.value)}
                      placeholder="مثال: المورد غير قادر على الالتزام بموعد التسليم"
                    />
                  </Field>
                )}
                {detailState.actionError && (
                  <InlineError message={detailState.actionError} className="mt-1" />
                )}
              </ConfirmPanel>
            ) : (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <ActionControl action="approve" capability={detail.capabilities.approve} onSelect={detailState.selectAction} />
                <ActionControl action="send" capability={detail.capabilities.send} onSelect={detailState.selectAction} />
                <ActionControl action="confirm" capability={detail.capabilities.confirm} onSelect={detailState.selectAction} />
                <div>
                  <Button
                    variant="secondary"
                    disabled={!detail.capabilities.receive.allowed}
                    onClick={detailState.openReceiving}
                  >
                    <PackageCheck aria-hidden="true" />
                    تسجيل استلام
                  </Button>
                  {!detail.capabilities.receive.allowed && (
                    <p className="mt-1 max-w-56 text-xs font-semibold text-slate-500">
                      {capabilityMessage(detail.capabilities.receive.reason)}
                    </p>
                  )}
                </div>
                <ActionControl action="cancel" capability={detail.capabilities.cancel} onSelect={detailState.selectAction} />
              </div>
            )}
          </div>
        )}
      </Dialog>

      {detailState.receiving && detail && (
        <ReceivingDialog
          open
          order={detail}
          dataSource={dataSource}
          onOpenChange={(open) => {
            if (!open) detailState.closeReceiving();
          }}
          onReceived={onChanged}
        />
      )}
    </>
  );
}
