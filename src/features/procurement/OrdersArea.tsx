import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Select } from "@/components/ui/Select";
import type {
  ProcurementDataSource,
  ProcurementAccess,
  ProcurementEventOption,
} from "./contracts";
import { ORDER_STATUS_LABELS } from "./presentation";
import { OrderCard } from "./OrderCard";
import { OrderCreateDialog } from "./OrderCreateDialog";
import { OrderDetailDialog } from "./OrderDetailDialog";
import { useOrdersFeed } from "./useOrdersFeed";
import { useState } from "react";

const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as Array<
  keyof typeof ORDER_STATUS_LABELS
>;

export function OrdersArea({
  dataSource,
  access,
  events = [],
}: {
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  events?: ProcurementEventOption[];
}) {
  const feed = useOrdersFeed(dataSource);
  const [creating, setCreating] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  return (
    <section aria-labelledby="orders-heading" className="space-y-5">
      <SectionHeader
        title="طلبات التوريد"
        description="من المسودة إلى الإرسال والتأكيد والاستلام الكامل، مع توضيح المتبقي في كل بند."
        actions={
          access.canCreateOrder && (
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              طلب جديد
            </Button>
          )
        }
      />
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_14rem]">
        <Field label="بحث" htmlFor="order-search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="order-search"
              type="search"
              className="pr-10"
              value={feed.search}
              onChange={(event) => feed.setSearch(event.target.value)}
              placeholder="رقم الطلب أو المورد أو المناسبة"
            />
          </div>
        </Field>
        <Field label="الحالة" htmlFor="order-status-filter">
          <Select
            id="order-status-filter"
            value={feed.status}
            onChange={(event) => feed.setStatus(event.target.value as typeof feed.status)}
          >
            <option value="ALL">كل الحالات</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {feed.loading && <LoadingState label="جارٍ تحميل طلبات التوريد…" />}
      {!feed.loading && feed.error && (
        <ErrorState
          title="تعذر تحميل الطلبات"
          message={feed.error}
          onRetry={feed.reload}
        />
      )}
      {!feed.loading && !feed.error && feed.visible.length === 0 && (
        <EmptyState
          title={feed.filtered ? "لا توجد طلبات مطابقة" : "لا توجد طلبات توريد بعد"}
          description={
            feed.filtered
              ? "جرّب تغيير البحث أو حالة الطلب."
              : "أنشئ مسودة طلب جديدة وحدد المورد وبنود التوريد."
          }
          action={
            feed.filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  feed.setSearch("");
                  feed.setStatus("ALL");
                }}
              >
                مسح عوامل التصفية
              </Button>
            ) : access.canCreateOrder ? (
              <Button onClick={() => setCreating(true)}>إنشاء أول طلب</Button>
            ) : undefined
          }
        />
      )}
      {!feed.loading && !feed.error && feed.visible.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          {feed.visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              access={access}
              onOpen={() => setSelectedOrderId(order.id)}
            />
          ))}
        </div>
      )}

      <OrderCreateDialog
        key={creating ? "create-open" : "create-closed"}
        open={creating}
        dataSource={dataSource}
        access={access}
        suppliers={feed.suppliers}
        consumables={feed.consumables}
        events={events}
        onOpenChange={setCreating}
        onCreated={(order) => {
          setSelectedOrderId(order.id);
          feed.reload();
        }}
      />
      <OrderDetailDialog
        orderId={selectedOrderId}
        dataSource={dataSource}
        access={access}
        onClose={() => setSelectedOrderId(null)}
        onChanged={feed.reload}
      />
    </section>
  );
}
