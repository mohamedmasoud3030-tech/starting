import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatOMR } from "@/lib/money";
import type {
  ProcurementAccess,
  ProcurementOrderListItem,
} from "./contracts";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, formatProcurementDateTime } from "./presentation";

export function OrderStatusBadge({ status }: { status: ProcurementOrderListItem["status"] }) {
  return <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

/** Compact order card in the orders feed grid. */
export function OrderCard({
  order,
  access,
  onOpen,
}: {
  order: ProcurementOrderListItem;
  access: ProcurementAccess;
  onOpen: () => void;
}) {
  return (
    <Card className={order.status === "PARTIALLY_RECEIVED" ? "border-amber-300" : undefined}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-brand-700">{order.orderNumber}</p>
            <h3 className="mt-0.5 text-lg font-black">{order.supplier.name}</h3>
            {order.event && (
              <p className="mt-1 text-sm text-slate-600">المناسبة: {order.event.title}</p>
            )}
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-500">تاريخ الطلب</dt>
            <dd className="mt-1 font-bold">{formatProcurementDateTime(order.orderedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">موعد التوريد</dt>
            <dd className="mt-1 font-bold">{formatProcurementDateTime(order.deliveryDueAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">توريدات متبقية</dt>
            <dd className="mt-1 text-lg font-black">{order.outstandingDeliveryCount}</dd>
          </div>
          {access.canViewCommercialAmounts && order.negotiatedTotalMilli != null && (
            <div>
              <dt className="text-slate-500">المبلغ المتفق عليه</dt>
              <dd className="mt-1 font-black">{formatOMR(order.negotiatedTotalMilli)}</dd>
            </div>
          )}
        </dl>
        <Button
          variant="outline"
          className="w-full"
          onClick={onOpen}
          aria-label={`عرض الطلب ${order.orderNumber}`}
        >
          فتح الطلب
        </Button>
      </CardBody>
    </Card>
  );
}
