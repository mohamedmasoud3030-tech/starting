import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Capacity, Reservation } from "../events.api";

export function EquipmentTab({
  capacities,
  reservations,
  run,
}: {
  capacities: ReadonlyArray<Capacity>;
  reservations: ReadonlyArray<Reservation>;
  run: (name: string, args: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
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
      {reservations.map((r) => (
        <Card key={r.id}>
          <p className="font-bold">
            {capacities.find((c) => c.id === r.equipment_capacity_id)?.catalog_item_id}
          </p>
          <p>
            {r.quantity} · {r.status}
          </p>
        </Card>
      ))}
    </div>
  );
}
