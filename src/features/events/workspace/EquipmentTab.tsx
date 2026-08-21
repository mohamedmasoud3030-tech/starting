import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/app/authContext";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { useSaveEquipmentCapacity } from "@/features/warehouse/warehouse.api";
import type { Capacity, Reservation } from "../events.api";
import { EQUIPMENT_RESERVATION_LABELS } from "../eventCommand.model";

/**
 * Equipment tab: reservation form + reservations list, plus (defect F11) the
 * capacity provisioning form — capacity rows previously had no product path
 * to exist, which left the "اختر المعدة" list permanently empty.
 *
 * Provisioning is offered to OWNER/MANAGER only (the UI gate is conservative;
 * the database policy additionally allows WAREHOUSE).
 */
export function EquipmentTab({
  orgId,
  capacities,
  reservations,
  canProvision,
  run,
}: {
  orgId: string | null;
  capacities: ReadonlyArray<Capacity>;
  reservations: ReadonlyArray<Reservation>;
  canProvision: boolean;
  run: (name: string, args: Record<string, unknown>) => Promise<void>;
}) {
  const { currentOrganization } = useAuth();
  const orgIdActive = orgId ?? currentOrganization?.id ?? null;
  const catalog = useCatalogItems(orgIdActive);
  const saveCapacity = useSaveEquipmentCapacity(orgIdActive);

  const reusableItems = (catalog.data?.rows ?? []).filter(
    (item) => item.item_type === "REUSABLE_EQUIPMENT" && item.status === "ACTIVE",
  );

  const [capacityItem, setCapacityItem] = useState("");
  const [capacityQty, setCapacityQty] = useState("");
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [capacityDone, setCapacityDone] = useState(false);

  const existingCapacity = capacities.find(
    (c) => c.catalog_item_id === capacityItem,
  );

  async function submitCapacity() {
    setCapacityError(null);
    setCapacityDone(false);
    if (!capacityItem) {
      setCapacityError("اختر المعدة أولاً");
      return;
    }
    const quantity = Number(capacityQty);
    if (!Number.isInteger(quantity) || quantity < 0 || capacityQty.trim() === "") {
      setCapacityError("أدخل سعة صحيحة (صفر أو أكثر)");
      return;
    }
    try {
      await saveCapacity.mutateAsync({
        existingId: existingCapacity?.id ?? null,
        values: { catalogItemId: capacityItem, totalQuantity: quantity },
      });
      setCapacityDone(true);
      setCapacityItem("");
      setCapacityQty("");
    } catch (cause) {
      setCapacityError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذر حفظ السعة",
      );
    }
  }

  return (
    <div className="space-y-4">
      {canProvision && (
        <Card>
          <h2 className="mb-3 font-black">سعة المعدات</h2>
          <p className="mb-3 text-sm text-slate-500">
            عرّف السعة الكلية لكل معدة قابلة لإعادة الاستخدام — تظهر مباشرة في قائمة الحجز أدناه.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              value={capacityItem}
              onChange={(e) => setCapacityItem(e.target.value)}
              aria-label="المعدة"
              className="min-w-52 flex-1"
            >
              <option value="">اختر المعدة</option>
              {reusableItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              aria-label="السعة الكلية"
              placeholder={existingCapacity ? String(existingCapacity.total_quantity) : "السعة الكلية"}
              value={capacityQty}
              onChange={(e) => setCapacityQty(e.target.value)}
              className="w-40"
            />
            <Button type="button" onClick={() => void submitCapacity()} disabled={saveCapacity.isPending}>
              {saveCapacity.isPending ? "جارٍ الحفظ…" : existingCapacity ? "تحديث السعة" : "حفظ السعة"}
            </Button>
          </div>
          {capacityError && (
            <p className="mt-2 text-sm font-bold text-red-700" role="alert">
              {capacityError}
            </p>
          )}
          {capacityDone && (
            <p className="mt-2 text-sm font-bold text-emerald-700" role="status">
              تم حفظ السعة بنجاح.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-black">حجز معدات</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("reserve_event_equipment", {
              p_capacity_id: String(f.get("capacity")),
              p_quantity: Number(f.get("quantity")),
              p_idempotency_key: crypto.randomUUID(),
            });
          }}
        >
          <Select name="capacity" required>
            <option value="">اختر المعدة</option>
            {capacities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.catalog_items?.name ?? c.catalog_item_id} · المتاح الكلي {c.total_quantity}
              </option>
            ))}
          </Select>
          <Input name="quantity" type="number" min="1" placeholder="الكمية" required className="w-32" />
          <Button type="submit">حجز</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {reservations.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد معدات محجوزة بعد.</p>
        ) : (
          reservations.map((r) => {
            const name =
              capacities.find((c) => c.id === r.equipment_capacity_id)?.catalog_items?.name ??
              capacities.find((c) => c.id === r.equipment_capacity_id)?.catalog_item_id;
            return (
              <Card key={r.id} className="p-4">
                <p className="font-black">{name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  الكمية المطلوبة: <span className="font-bold">{r.quantity}</span>
                  {" · "}
                  {EQUIPMENT_RESERVATION_LABELS[r.status] ?? r.status}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  الصرف والإرجاع والتلف تُدار من تبويب المخزن — مطلوب → خرج → عاد.
                </p>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
