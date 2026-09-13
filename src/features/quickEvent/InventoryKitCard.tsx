import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HOSPITALITY_INVENTORY } from "./hospitalityInventory";
import { useInventorySeedStatus, useSeedHospitalityInventory } from "./quickEvent.api";

/**
 * One-tap starter kit: adds the office's full hospitality inventory
 * (8 categories, ~60 items) to the catalog. Hidden once it's all there.
 */
export function InventoryKitCard({ orgId }: { orgId: string | null }) {
  const status = useInventorySeedStatus(orgId);
  const seed = useSeedHospitalityInventory(orgId);
  if (!status.data || status.data.seeded) return null;
  const total = HOSPITALITY_INVENTORY.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4">
      <div className="flex items-start gap-3">
        <Boxes className="mt-0.5 h-7 w-7 shrink-0 text-brand-700" />
        <div>
          <p className="text-lg font-black text-brand-900">أضف عدة الضيافة الكاملة بضغطة</p>
          <p className="text-sm text-brand-900/80">
            {HOSPITALITY_INVENTORY.map((c) => c.name).join(" · ")} — {total} صنف.
            تقدر تعدّل أو تحذف أي صنف بعدها، وتكتب الكميات الفعلية من المخزن.
          </p>
          {status.data.count > 0 && (
            <p className="mt-1 text-xs text-brand-900/70">موجود حالياً {status.data.count} من {status.data.total}.</p>
          )}
        </div>
      </div>
      <Button size="lg" disabled={seed.isPending} onClick={() => seed.mutate()}>
        {seed.isPending ? "جارٍ الإضافة…" : "أضف العدة"}
      </Button>
      {seed.error ? (
        <p role="alert" className="w-full text-sm font-bold text-red-700">
          {seed.error instanceof Error ? seed.error.message : "تعذر الإضافة"}
        </p>
      ) : null}
    </div>
  );
}
