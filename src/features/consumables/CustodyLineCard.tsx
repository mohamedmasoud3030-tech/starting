import { useState } from "react";
import type { AppRole } from "@/lib/dbTypes";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { QuantityStat } from "@/components/ui/QuantityStat";
import { InlineError } from "@/components/ui/ErrorState";
import {
  custodyBlock,
  custodyBlockMessage,
  formatQuantity,
  validateQuantityAgainst,
  type EventConsumableLine,
} from "./consumables.model";

type CustodyMode = "none" | "return" | "consume" | "waste";

const MODE_TITLES: Record<Exclude<CustodyMode, "none">, string> = {
  return: "مرتجع صالح إلى المخزن",
  consume: "تسجيل استهلاك فعلي",
  waste: "تسجيل هالك",
};

/** One event consumable line with return / consume / waste flows. */
export function CustodyLineCard({
  line,
  role,
  busy,
  onMove,
}: {
  line: EventConsumableLine;
  role: AppRole | null;
  busy: boolean;
  onMove: (
    kind: Exclude<CustodyMode, "none">,
    line: EventConsumableLine,
    quantityMilli: number,
    note: string,
  ) => void;
}) {
  const [mode, setMode] = useState<CustodyMode>("none");
  const [quantityText, setQuantityText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [localError, setLocalError] = useState("");

  const block = custodyBlock({ role, line });

  function reset(next: CustodyMode) {
    setMode(next);
    setQuantityText(next === "none" ? "" : formatQuantity(line.outstandingMilli));
    setNoteText("");
    setLocalError("");
  }

  function submit() {
    if (mode === "none") return;
    const check = validateQuantityAgainst(
      quantityText,
      line.outstandingMilli,
      "المتبقي مع المناسبة",
    );
    if (!check.valid) {
      setLocalError(check.message);
      return;
    }
    if (mode === "waste" && noteText.trim().length < 3) {
      setLocalError("سبب الهالك مطلوب.");
      return;
    }
    setLocalError("");
    onMove(mode, line, check.milli, noteText);
    setMode("none");
    setQuantityText("");
    setNoteText("");
  }

  return (
    <Card className={line.outstandingMilli > 0 ? "border-amber-300" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{line.itemName}</h3>
          <p className="text-sm text-slate-500">الوحدة: {line.itemUnit || "—"}</p>
        </div>
        {line.isReconciled && <Badge tone="success">تمت التسوية</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <QuantityStat label="تم صرفه" value={formatQuantity(line.issuedMilli)} tone="brand" />
        <QuantityStat label="مرتجع صالح" value={formatQuantity(line.returnedMilli)} tone="success" />
        <QuantityStat label="تم استهلاكه" value={formatQuantity(line.consumedMilli)} tone="neutral" />
        <QuantityStat label="هالك" value={formatQuantity(line.wastedMilli)} tone="danger" />
        <QuantityStat
          label="المتبقي مع المناسبة"
          value={formatQuantity(line.outstandingMilli)}
          tone={line.outstandingMilli > 0 ? "warning" : "success"}
        />
      </div>

      {localError && (
        <InlineError message={localError} className="mt-3" />
      )}

      {mode === "none" && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              variant="secondary"
              disabled={block.blocked || busy}
              onClick={() => reset("return")}
            >
              مرتجع صالح
            </Button>
            <Button
              size="lg"
              disabled={block.blocked || busy}
              onClick={() => reset("consume")}
            >
              تم استهلاكه
            </Button>
            <Button
              size="lg"
              variant="danger"
              disabled={block.blocked || busy}
              onClick={() => reset("waste")}
            >
              هالك
            </Button>
          </div>
          {block.blocked && (
            <span className="text-xs font-semibold text-slate-500">
              {custodyBlockMessage(block)}
            </span>
          )}
        </div>
      )}

      {mode !== "none" && (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-3">
          <p className="font-bold">
            {MODE_TITLES[mode]} — المتبقي {formatQuantity(line.outstandingMilli)}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={`الكمية (${line.itemUnit || "وحدة"})`}>
              <Input
                inputMode="decimal"
                dir="ltr"
                className="w-32 text-center text-lg font-black"
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
              />
            </Field>
            <Field label={mode === "waste" ? "سبب الهالك (إلزامي)" : "ملاحظة (اختياري)"}>
              <Input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={mode === "waste" ? "اشرح سبب الهالك" : ""}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={busy} onClick={submit}>
              تأكيد
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
