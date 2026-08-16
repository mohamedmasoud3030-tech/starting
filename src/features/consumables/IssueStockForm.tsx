import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { InlineError } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { formatQuantity, type StockLine } from "./consumables.model";

/** Issue tracked stock to the event: item + exact quantity. */
export function IssueStockForm({
  blockMessage,
  stockLines,
  selectedStock,
  stockItemId,
  onStockItemIdChange,
  quantityText,
  onQuantityTextChange,
  localError,
  busy,
  onSubmit,
}: {
  blockMessage: string | null;
  stockLines: ReadonlyArray<StockLine>;
  selectedStock: StockLine | undefined;
  stockItemId: string;
  onStockItemIdChange: (value: string) => void;
  quantityText: string;
  onQuantityTextChange: (value: string) => void;
  localError: string;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <Card>
      <h3 className="font-black">صرف للمناسبة</h3>
      {blockMessage ? (
        <p className="mt-2 text-sm font-semibold text-slate-500">{blockMessage}</p>
      ) : stockLines.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-slate-500">
          لا توجد أصناف متوفرة في مخزون المواد الاستهلاكية.
        </p>
      ) : (
        <>
          {localError && <InlineError message={localError} className="mt-2" />}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="الصنف">
              <Select value={stockItemId} onChange={(e) => onStockItemIdChange(e.target.value)}>
                <option value="">اختر الصنف</option>
                {stockLines.map((l) => (
                  <option key={l.stockItemId} value={l.stockItemId}>
                    {l.itemName} · المتوفر {formatQuantity(l.onHandMilli)} {l.itemUnit}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`الكمية${selectedStock ? ` (${selectedStock.itemUnit || "وحدة"})` : ""}`}>
              <Input
                inputMode="decimal"
                dir="ltr"
                placeholder="0.000"
                className="w-32 text-center text-lg font-black"
                value={quantityText}
                onChange={(e) => onQuantityTextChange(e.target.value)}
              />
            </Field>
            <Button size="lg" disabled={busy} onClick={onSubmit}>
              صرف
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
