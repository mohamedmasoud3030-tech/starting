/**
 * Central consumables stock screen (S4B).
 *
 * Designed for a phone or tablet on a warehouse floor, Arabic-first RTL:
 *  - each tracked item shows الصنف / الوحدة / الرصيد الحالي / الحد الأدنى with
 *    a clear "منخفض المخزون" indicator derived from the authoritative balance;
 *  - استلام (receive) is the one-tap common case; إتلاف (warehouse waste) and
 *    تعديل الرصيد (OWNER/MANAGER adjustment) require an explicit reason and a
 *    confirmation step because they destroy/correct physical stock;
 *  - exact decimal quantity entry (up to 3 decimals), no floating point;
 *  - blocked actions always state WHY, in Arabic;
 *  - no raw UUIDs and no PostgreSQL error text ever reach the screen.
 */

import { useAuth } from "@/app/authContext";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { consumableErrorMessage } from "./consumables.model";
import { StockLineCard } from "./StockLineCard";
import { TrackNewItem } from "./TrackNewItem";
import { useConsumablesPage } from "./useConsumablesPage";

export function ConsumablesPage() {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const page = useConsumablesPage(orgId, currentRole);

  if (page.stock.isLoading) {
    return <LoadingState label="جارٍ تحميل المخزون…" full />;
  }

  if (page.stock.isError) {
    return <InlineError message={consumableErrorMessage(page.stock.error)} />;
  }

  const lines = page.stock.data?.lines ?? [];
  const defects = page.stock.data?.defects ?? [];
  const lowCount = lines.filter((l) => l.isLowStock).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="المواد الاستهلاكية"
        description="رصيد المخزن للمواد الاستهلاكية: استلام، إتلاف، وتعديلات موثقة."
      />

      {lowCount > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-black text-amber-900">
            {lowCount === 1
              ? "صنف واحد منخفض المخزون."
              : `${lowCount} أصناف منخفضة المخزون.`}
          </p>
        </Card>
      )}

      {page.error && <InlineError message={page.error} />}

      {defects.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <p className="font-black text-red-800">
            بيانات غير مكتملة في {defects.length} صنف. لا تُعرض أرصدة غير
            موثوقة — راجع المسؤول.
          </p>
        </Card>
      )}

      {page.canManage && (
        <TrackNewItem orgId={orgId} busy={page.busy} onError={page.setError} />
      )}

      {lines.length === 0 ? (
        <EmptyState
          title="لا توجد أصناف متتبعة"
          description="فعّل تتبع المخزون لأصناف الكتالوج الاستهلاكية لبدء تسجيل الأرصدة."
        />
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <StockLineCard
              key={line.stockItemId}
              line={line}
              canOperate={page.canOperate}
              canManage={page.canManage}
              busy={page.busy}
              onReceive={(l, q, r) => void page.runReceive(l, q, r)}
              onWaste={(l, q, r) => void page.runWaste(l, q, r)}
              onAdjust={(l, q, r) => void page.runAdjust(l, q, r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
