import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useSaveStockItem, useUntrackedConsumables } from "./consumables.api";
import { consumableErrorMessage, parseQuantityInput } from "./consumables.model";

/** Activate stock tracking for an untracked catalog consumable. */
export function TrackNewItem({
  orgId,
  busy,
  onError,
}: {
  orgId: string | null;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const untracked = useUntrackedConsumables(orgId);
  const saveItem = useSaveStockItem(orgId);
  const [catalogItemId, setCatalogItemId] = useState("");
  const [minimumText, setMinimumText] = useState("");

  if (untracked.isLoading || !untracked.data || untracked.data.length === 0) {
    return null;
  }

  async function submit() {
    if (!catalogItemId) return;
    let minimumMilli = 0;
    if (minimumText.trim() !== "") {
      const parsed = parseQuantityInput(minimumText);
      if (!parsed.ok) {
        onError(parsed.message);
        return;
      }
      minimumMilli = parsed.milli;
    }
    onError("");
    try {
      await saveItem.mutateAsync({
        catalogItemId,
        minimumMilli,
        isTrackingActive: true,
      });
      setCatalogItemId("");
      setMinimumText("");
    } catch (e) {
      onError(consumableErrorMessage(e));
    }
  }

  return (
    <Card>
      <h3 className="font-black">تفعيل تتبع صنف استهلاكي</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="الصنف">
          <Select
            value={catalogItemId}
            onChange={(e) => setCatalogItemId(e.target.value)}
          >
            <option value="">اختر الصنف</option>
            {untracked.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} {item.unit ? `· ${item.unit}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الحد الأدنى (اختياري)">
          <Input
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            className="w-32 text-center"
            value={minimumText}
            onChange={(e) => setMinimumText(e.target.value)}
          />
        </Field>
        <Button
          size="lg"
          disabled={busy || !catalogItemId || saveItem.isPending}
          onClick={() => void submit()}
        >
          تفعيل التتبع
        </Button>
      </div>
    </Card>
  );
}
