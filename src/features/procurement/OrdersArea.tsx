import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { formatOMR } from "@/lib/money";
import type {
  ProcurementAccess,
  ProcurementDataSource,
  ProcurementEventOption,
  ProcurementOrderDetail,
  ProcurementOrderListItem,
  ProcurementOrderStatus,
  SupplierListItem,
} from "./contracts";
import { capabilityMessage, procurementErrorMessage } from "./errors";
import {
  LINE_KIND_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatProcurementDateTime,
} from "./presentation";
import { formatQuantity } from "./validation";
import { OrderCreateDialog } from "./OrderCreateDialog";
import { ReceivingDialog } from "./ReceivingDialog";

const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as ProcurementOrderStatus[];

function OrderStatusBadge({ status }: { status: ProcurementOrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

function OrderCard({
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
            {order.event && <p className="mt-1 text-sm text-slate-600">المناسبة: {order.event.title}</p>}
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">تاريخ الطلب</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(order.orderedAt)}</dd></div>
          <div><dt className="text-slate-500">موعد التوريد</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(order.deliveryDueAt)}</dd></div>
          <div><dt className="text-slate-500">توريدات متبقية</dt><dd className="mt-1 text-lg font-black">{order.outstandingDeliveryCount}</dd></div>
          {access.canViewCommercialAmounts && order.negotiatedTotalMilli != null && (
            <div><dt className="text-slate-500">المبلغ المتفق عليه</dt><dd className="mt-1 font-black">{formatOMR(order.negotiatedTotalMilli)}</dd></div>
          )}
        </dl>
        <Button variant="outline" className="w-full" onClick={onOpen} aria-label={`عرض الطلب ${order.orderNumber}`}>فتح الطلب</Button>
      </CardBody>
    </Card>
  );
}

function QuantityStat({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "green" | "amber" }) {
  const styles = tone === "green" ? "bg-emerald-50 text-emerald-800" : tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-800";
  return <div className={`rounded-xl p-2 text-center ${styles}`}><dt className="text-xs font-semibold opacity-75">{label}</dt><dd className="mt-1 text-lg font-black">{formatQuantity(value)}</dd></div>;
}

function OrderDetailDialog({
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
  const [detail, setDetail] = useState<ProcurementOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirmAction, setConfirmAction] = useState<"approve" | "cancel" | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!orderId) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setDetail(null);
    setConfirmAction(null);
    setReceiving(false);
    void dataSource.getOrder(orderId).then(
      (value) => { if (current) setDetail(value); },
      (cause) => { if (current) setLoadError(procurementErrorMessage(cause)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dataSource, orderId, reload]);

  async function runAction(action: "approve" | "cancel") {
    if (!orderId) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = action === "approve"
        ? await dataSource.approveOrder(orderId)
        : await dataSource.cancelOrder(orderId);
      setDetail(updated);
      setConfirmAction(null);
      setSuccess(action === "approve" ? "تم اعتماد الطلب بنجاح." : "تم إلغاء الطلب.");
      onChanged();
    } catch (cause) {
      setActionError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={orderId !== null}
        onOpenChange={(open) => !open && !busy && onClose()}
        title={detail ? `طلب ${detail.orderNumber}` : "تفاصيل طلب التوريد"}
        className="max-w-3xl"
      >
        {loading && <div className="flex min-h-48 items-center justify-center gap-3" aria-busy="true"><Spinner /><span className="font-bold text-slate-600">جارٍ تحميل الطلب…</span></div>}
        {!loading && loadError && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800"><p className="font-bold">{loadError}</p><Button variant="outline" className="mt-3" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button></div>}
        {!loading && detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-xl font-black">{detail.supplier.name}</h3>{detail.event ? <p className="mt-1 text-slate-600">المناسبة: {detail.event.title}</p> : <p className="mt-1 text-slate-500">طلب عام غير مرتبط بمناسبة</p>}</div>
              <OrderStatusBadge status={detail.status} />
            </div>
            <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-sm text-slate-500">تاريخ الطلب</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(detail.orderedAt)}</dd></div>
              <div><dt className="text-sm text-slate-500">موعد التوريد</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(detail.deliveryDueAt)}</dd></div>
              <div><dt className="text-sm text-slate-500">توريدات متبقية</dt><dd className="mt-1 font-black">{detail.outstandingDeliveryCount}</dd></div>
              {access.canViewCommercialAmounts && detail.negotiatedTotalMilli != null && <div><dt className="text-sm text-slate-500">المبلغ المتفق عليه</dt><dd className="mt-1 font-black">{formatOMR(detail.negotiatedTotalMilli)}</dd></div>}
            </dl>

            <section aria-labelledby="order-detail-lines" className="space-y-3">
              <h4 id="order-detail-lines" className="text-lg font-black">الأصناف / البنود</h4>
              {detail.lines.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">لا توجد بنود في هذا الطلب.</p> : detail.lines.map((line) => (
                <article key={line.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><h5 className="font-black">{line.description}</h5><p className="mt-1 text-sm text-slate-500">{LINE_KIND_LABELS[line.kind]} · {line.unit}</p></div>{line.remainingQuantityMilli === 0 && <Badge tone="success">مكتمل</Badge>}</div>
                  <dl className="mt-3 grid grid-cols-3 gap-2"><QuantityStat label="الكمية" value={line.orderedQuantityMilli} /><QuantityStat label="المستلم" value={line.receivedQuantityMilli} tone="green" /><QuantityStat label="المتبقي" value={line.remainingQuantityMilli} tone={line.remainingQuantityMilli > 0 ? "amber" : "green"} /></dl>
                  {access.canViewCommercialAmounts && (line.unitCostMilli != null || line.lineTotalMilli != null) && <dl className="mt-3 flex flex-wrap gap-5 border-t border-slate-100 pt-3 text-sm">{line.unitCostMilli != null && <div><dt className="text-slate-500">سعر الوحدة</dt><dd className="font-black">{formatOMR(line.unitCostMilli)}</dd></div>}{line.lineTotalMilli != null && <div><dt className="text-slate-500">الإجمالي</dt><dd className="font-black">{formatOMR(line.lineTotalMilli)}</dd></div>}</dl>}
                  {!line.receive.allowed && line.remainingQuantityMilli > 0 && <p className="mt-2 text-xs font-semibold text-slate-500">{capabilityMessage(line.receive.reason)}</p>}
                </article>
              ))}
            </section>

            {detail.receipts.length > 0 && <section aria-labelledby="order-receipts"><h4 id="order-receipts" className="font-black">سجل الاستلام</h4><ul className="mt-2 space-y-2">{detail.receipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3"><span className="font-bold">{receipt.receiptNumber ? `استلام ${receipt.receiptNumber}` : "استلام مسجل"}</span><span className="text-sm text-emerald-800">{formatProcurementDateTime(receipt.receivedAt)}</span></li>)}</ul></section>}
            {detail.notes && <div><h4 className="font-black">ملاحظات الطلب</h4><p className="mt-1 whitespace-pre-wrap text-slate-600">{detail.notes}</p></div>}
            {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">{success}</p>}
            {actionError && !confirmAction && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{actionError}</p>}

            {confirmAction ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-lg font-black">{confirmAction === "approve" ? "هل تريد اعتماد هذا الطلب؟" : "هل تريد إلغاء هذا الطلب؟"}</p>
                <p className="mt-1 text-slate-700">{confirmAction === "approve" ? "بعد الاعتماد قد لا تكون المسودة قابلة للتعديل." : "لن تُحذف بيانات الطلب أو سجل الاستلام السابق."}</p>
                {actionError && <p role="alert" className="mt-3 rounded-xl bg-red-100 p-3 font-bold text-red-800">{actionError}</p>}
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row"><Button variant="outline" disabled={busy} onClick={() => { setConfirmAction(null); setActionError(""); }}>العودة</Button><Button variant={confirmAction === "cancel" ? "danger" : "primary"} disabled={busy} onClick={() => void runAction(confirmAction)}>{busy ? "جارٍ التنفيذ…" : confirmAction === "approve" ? "نعم، اعتماد الطلب" : "نعم، إلغاء الطلب"}</Button></div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <div><Button disabled={!detail.capabilities.approve.allowed} onClick={() => { setSuccess(""); setConfirmAction("approve"); }}>اعتماد الطلب</Button>{!detail.capabilities.approve.allowed && <p className="mt-1 max-w-56 text-xs font-semibold text-slate-500">{capabilityMessage(detail.capabilities.approve.reason)}</p>}</div>
                <div><Button variant="secondary" disabled={!detail.capabilities.receive.allowed} onClick={() => { setSuccess(""); setReceiving(true); }}><PackageCheck aria-hidden="true" />تسجيل استلام</Button>{!detail.capabilities.receive.allowed && <p className="mt-1 max-w-56 text-xs font-semibold text-slate-500">{capabilityMessage(detail.capabilities.receive.reason)}</p>}</div>
                <div><Button variant="danger" disabled={!detail.capabilities.cancel.allowed} onClick={() => { setSuccess(""); setConfirmAction("cancel"); }}>إلغاء الطلب</Button>{!detail.capabilities.cancel.allowed && <p className="mt-1 max-w-56 text-xs font-semibold text-slate-500">{capabilityMessage(detail.capabilities.cancel.reason)}</p>}</div>
              </div>
            )}
          </div>
        )}
      </Dialog>
      {receiving && detail && (
        <ReceivingDialog
          open
          order={detail}
          dataSource={dataSource}
          onOpenChange={(open) => {
            if (!open) {
              setReceiving(false);
              setReload((value) => value + 1);
            }
          }}
          onReceived={onChanged}
        />
      )}
    </>
  );
}

export function OrdersArea({
  dataSource,
  access,
  events = [],
}: {
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  events?: ProcurementEventOption[];
}) {
  const [orders, setOrders] = useState<ProcurementOrderListItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProcurementOrderStatus | "ALL">("ALL");
  const [creating, setCreating] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void Promise.all([dataSource.listOrders(), dataSource.listSuppliers()]).then(
      ([orderItems, supplierItems]) => { if (current) { setOrders(orderItems); setSuppliers(supplierItems); } },
      (cause) => { if (current) setError(procurementErrorMessage(cause)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dataSource, reload]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ar");
    return orders.filter((order) => {
      const haystack = `${order.orderNumber} ${order.supplier.name} ${order.event?.title ?? ""}`.toLocaleLowerCase("ar");
      return (!needle || haystack.includes(needle)) && (status === "ALL" || order.status === status);
    });
  }, [orders, search, status]);

  const filtered = Boolean(search.trim() || status !== "ALL");

  return (
    <section aria-labelledby="orders-heading" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="orders-heading" className="text-2xl font-black">طلبات التوريد</h2><p className="mt-1 text-slate-600">من المسودة حتى الاستلام الكامل، مع توضيح المتبقي في كل بند.</p></div>{access.canCreateOrder && <Button size="lg" onClick={() => setCreating(true)}><Plus aria-hidden="true" />طلب جديد</Button>}</div>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_14rem]">
        <Field label="بحث" htmlFor="order-search"><div className="relative"><Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" aria-hidden="true" /><Input id="order-search" type="search" className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الطلب أو المورد أو المناسبة" /></div></Field>
        <Field label="الحالة" htmlFor="order-status-filter"><Select id="order-status-filter" value={status} onChange={(event) => setStatus(event.target.value as ProcurementOrderStatus | "ALL")}><option value="ALL">كل الحالات</option>{ORDER_STATUSES.map((value) => <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>)}</Select></Field>
      </div>
      {loading && <div className="flex min-h-52 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white" aria-busy="true"><Spinner /><span className="font-bold text-slate-600">جارٍ تحميل طلبات التوريد…</span></div>}
      {!loading && error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p className="font-black">تعذر تحميل الطلبات</p><p className="mt-1 font-semibold">{error}</p><Button variant="outline" className="mt-4" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button></div>}
      {!loading && !error && visible.length === 0 && <EmptyState title={filtered ? "لا توجد طلبات مطابقة" : "لا توجد طلبات توريد بعد"} description={filtered ? "جرّب تغيير البحث أو حالة الطلب." : "أنشئ مسودة طلب جديدة وحدد المورد وموعد التوريد."} action={filtered ? <Button variant="outline" onClick={() => { setSearch(""); setStatus("ALL"); }}>مسح عوامل التصفية</Button> : access.canCreateOrder ? <Button onClick={() => setCreating(true)}>إنشاء أول طلب</Button> : undefined} />}
      {!loading && !error && visible.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">{visible.map((order) => <OrderCard key={order.id} order={order} access={access} onOpen={() => setSelectedOrderId(order.id)} />)}</div>}
      <OrderCreateDialog key={creating ? "create-open" : "create-closed"} open={creating} dataSource={dataSource} access={access} suppliers={suppliers} events={events} onOpenChange={setCreating} onCreated={(order) => { setSelectedOrderId(order.id); setReload((value) => value + 1); }} />
      <OrderDetailDialog orderId={selectedOrderId} dataSource={dataSource} access={access} onClose={() => setSelectedOrderId(null)} onChanged={() => setReload((value) => value + 1)} />
    </section>
  );
}
