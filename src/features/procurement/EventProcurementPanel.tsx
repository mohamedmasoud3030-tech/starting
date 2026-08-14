import { useEffect, useState } from "react";
import { PackageOpen, Truck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { formatOMR } from "@/lib/money";
import type {
  EventProcurementSummary,
  ProcurementAccess,
  ProcurementDataSource,
} from "./contracts";
import { procurementErrorMessage } from "./errors";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatProcurementDateTime,
} from "./presentation";

/**
 * Standalone Event integration seam. EventWorkspace intentionally remains
 * untouched; S5A wiring only needs to pass its adapter, server-derived access,
 * and the current Event id to this component.
 */
export function EventProcurementPanel({
  eventId,
  dataSource,
  access,
  onOrderOpen,
}: {
  eventId: string;
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  onOrderOpen?: (orderId: string) => void;
}) {
  const [summary, setSummary] = useState<EventProcurementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void dataSource.getEventProcurement(eventId).then(
      (value) => { if (current) setSummary(value); },
      (cause) => { if (current) setError(procurementErrorMessage(cause)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dataSource, eventId, reload]);

  if (loading) {
    return <div className="flex min-h-40 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white" aria-busy="true"><Spinner /><span className="font-bold text-slate-600">جارٍ تحميل توريدات المناسبة…</span></div>;
  }
  if (error) {
    return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800"><p className="font-black">تعذر تحميل توريدات المناسبة</p><p className="mt-1 font-semibold">{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button></div>;
  }
  if (!summary || summary.orders.length === 0) {
    return <EmptyState title="لا توجد طلبات توريد لهذه المناسبة" description="ستظهر هنا الطلبات المرتبطة بالمناسبة بعد إنشائها." />;
  }

  return (
    <section aria-labelledby="event-procurement-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="event-procurement-heading" className="text-xl font-black">التوريدات والموردون</h2><p className="mt-1 text-slate-600">ما سيصل للمناسبة، وما تم استلامه، والمتبقي.</p></div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={summary.outstandingDeliveryCount > 0 ? "warning" : "success"}><Truck className="h-4 w-4" aria-hidden="true" />{summary.outstandingDeliveryCount > 0 ? `${summary.outstandingDeliveryCount} توريدات متبقية` : "اكتملت التوريدات"}</Badge>
          {access.canViewCommercialAmounts && summary.negotiatedTotalMilli != null && <Badge tone="brand">المبلغ المتفق عليه: {formatOMR(summary.negotiatedTotalMilli)}</Badge>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {summary.orders.map((order) => (
          <Card key={order.id} className={order.outstandingDeliveryCount > 0 ? "border-amber-300" : "border-emerald-200"}>
            <CardBody>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3"><span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true"><PackageOpen /></span><div className="min-w-0"><p className="font-black">{order.supplier.name}</p><p className="text-sm font-bold text-brand-700">{order.orderNumber}</p></div></div>
                <Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">موعد التوريد</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(order.deliveryDueAt)}</dd></div>
                <div><dt className="text-slate-500">المتبقي</dt><dd className="mt-1 font-black">{order.outstandingDeliveryCount > 0 ? `${order.outstandingDeliveryCount} توريدات` : "لا شيء"}</dd></div>
                {access.canViewCommercialAmounts && order.negotiatedTotalMilli != null && <div className="col-span-2"><dt className="text-slate-500">المبلغ المتفق عليه</dt><dd className="mt-1 font-black">{formatOMR(order.negotiatedTotalMilli)}</dd></div>}
              </dl>
              {onOrderOpen && <Button variant="outline" className="mt-4 w-full" onClick={() => onOrderOpen(order.id)} aria-label={`فتح الطلب ${order.orderNumber}`}>فتح الطلب</Button>}
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}
