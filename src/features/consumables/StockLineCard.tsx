import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { QuantityStat } from "@/components/ui/QuantityStat";
import { Select } from "@/components/ui/Select";
import { InlineError } from "@/components/ui/ErrorState";
import {
  formatQuantity,
  parseQuantityInput,
  validateQuantityAgainst,
  type StockLine,
} from "./consumables.model";

type LineMode = "none" | "receive" | "waste" | "adjust";

/** One tracked stock line with receive / waste / adjust flows. */
export function StockLineCard({
  line,
  canOperate,
  canManage,
  busy,
  onReceive,
  onWaste,
  onAdjust,
}: {
  line: StockLine;
  canOperate: boolean;
  canManage: boolean;
  busy: boolean;
  onReceive: (line: StockLine, quantityMilli: number, reference: string) => void;
  onWaste: (line: StockLine, quantityMilli: number, reason: string) => void;
  onAdjust: (line: StockLine, quantityMilli: number, reason: string) => void;
}) {
  const [mode, setMode] = useState<LineMode>("none");
  const [quantityText, setQuantityText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"زيادة" | "نقصان">("زيادة");
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");

  function reset(next: LineMode) {
    setMode(next);
    setQuantityText("");
    setNoteText("");
    setAdjustDirection("زيادة");
    setConfirming(false);
    setLocalError("");
  }

  function submit() {
    if (mode === "receive") {
      const parsed = parseQuantityInput(quantityText);
      if (!parsed.ok) {
        setLocalError(parsed.message);
        return;
      }
      setLocalError("");
      onReceive(line, parsed.milli, noteText);
      reset("none");
      return;
    }
    if (mode === "waste") {
      const parsed = validateQuantityAgainst(
        quantityText,
        line.onHandMilli,
        "الرصيد الحالي",
      );
      if (!parsed.valid) {
        setLocalError(parsed.message);
        return;
      }
      if (noteText.trim().length < 3) {
        setLocalError("سبب الإتلاف مطلوب.");
        return;
      }
      if (!confirming) {
        setConfirming(true);
        return;
      }
      setLocalError("");
      onWaste(line, parsed.milli, noteText);
      reset("none");
      return;
    }
    if (mode === "adjust") {
      const parsed = parseQuantityInput(quantityText);
      if (!parsed.ok) {
        setLocalError(parsed.message);
        return;
      }
      if (adjustDirection === "نقصان" && parsed.milli > line.onHandMilli) {
        setLocalError(
          `لا يمكن إنقاص أكثر من الرصيد الحالي (${formatQuantity(line.onHandMilli)}).`,
        );
        return;
      }
      if (noteText.trim().length < 3) {
        setLocalError("سبب التعديل مطلوب.");
        return;
      }
      if (!confirming) {
        setConfirming(true);
        return;
      }
      setLocalError("");
      onAdjust(
        line,
        adjustDirection === "نقصان" ? -parsed.milli : parsed.milli,
        noteText,
      );
      reset("none");
    }
  }

  return (
    <Card className={line.isLowStock ? "border-amber-300" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{line.itemName}</h3>
          <p className="text-sm text-slate-500">الوحدة: {line.itemUnit || "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {line.isLowStock && <Badge tone="warning">منخفض المخزون</Badge>}
          {!line.isTrackingActive && <Badge tone="neutral">التتبع موقوف</Badge>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <QuantityStat
          label="الرصيد الحالي"
          value={formatQuantity(line.onHandMilli)}
          tone={line.isLowStock ? "warning" : "success"}
        />
        <QuantityStat
          label="الحد الأدنى"
          value={formatQuantity(line.minimumMilli)}
          tone="neutral"
        />
      </div>

      {localError && (
        <InlineError message={localError} className="mt-3" />
      )}

      {mode === "none" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="lg"
            disabled={!canOperate || busy || !line.isTrackingActive}
            onClick={() => reset("receive")}
          >
            استلام
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={!canOperate || busy || line.onHandMilli <= 0}
            onClick={() => reset("waste")}
          >
            إتلاف
          </Button>
          {canManage && (
            <Button
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={() => reset("adjust")}
            >
              تعديل الرصيد
            </Button>
          )}
          {!canOperate && (
            <span className="self-center text-xs font-semibold text-slate-500">
              لا تملك صلاحية عمليات المخزون.
            </span>
          )}
        </div>
      )}

      {mode !== "none" && (
        <div
          className={`mt-4 space-y-3 rounded-xl p-3 ${
            mode === "receive" ? "bg-brand-50" : "bg-amber-50"
          }`}
        >
          <p className="font-bold">
            {mode === "receive" && `استلام ${line.itemName}`}
            {mode === "waste" && `إتلاف من ${line.itemName}`}
            {mode === "adjust" && `تعديل رصيد ${line.itemName}`}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {mode === "adjust" && (
              <Field label="نوع التعديل">
                <Select
                  value={adjustDirection}
                  onChange={(e) =>
                    setAdjustDirection(e.target.value as "زيادة" | "نقصان")
                  }
                >
                  <option value="زيادة">زيادة</option>
                  <option value="نقصان">نقصان</option>
                </Select>
              </Field>
            )}
            <Field label={`الكمية (${line.itemUnit || "وحدة"})`}>
              <Input
                inputMode="decimal"
                dir="ltr"
                placeholder="0.000"
                className="w-32 text-center text-lg font-black"
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
              />
            </Field>
            <Field
              label={
                mode === "receive" ? "المرجع (اختياري)" : "السبب (إلزامي)"
              }
            >
              <Input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={
                  mode === "receive" ? "رقم فاتورة أو مصدر" : "اشرح السبب"
                }
              />
            </Field>
          </div>
          {confirming && (
            <p className="font-black text-amber-900">
              تأكيد نهائي: هذه العملية تغيّر الرصيد الفعلي ولا يمكن حذفها.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={busy} onClick={submit}>
              {confirming
                ? "نعم، تنفيذ"
                : mode === "receive"
                  ? "تأكيد الاستلام"
                  : mode === "waste"
                    ? "تسجيل الإتلاف"
                    : "تنفيذ التعديل"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => reset("none")}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
