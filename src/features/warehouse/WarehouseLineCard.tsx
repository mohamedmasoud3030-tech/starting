import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { QuantityStat } from "@/components/ui/QuantityStat";
import { formatOMR } from "@/lib/money";
import { InlineError } from "@/components/ui/ErrorState";
import {
  dispatchBlock,
  dispatchBlockMessage,
  returnBlock,
  returnBlockMessage,
  validateDispatchQuantity,
  validateReturnQuantities,
  type WarehouseLine,
} from "./warehouse.model";
import { HandoverEvidenceSection } from "./HandoverEvidenceSection";

/** Large touch-friendly quantity stepper: minimal typing on a warehouse floor. */
function QuantityStepper({
  label,
  value,
  max,
  onChange,
  tone = "neutral",
}: {
  label: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
  tone?: "neutral" | "danger";
}) {
  const clamp = (next: number) => Math.min(Math.max(next, 0), Math.max(max, 0));
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`text-sm font-bold ${tone === "danger" ? "text-red-700" : "text-slate-600"}`}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={`إنقاص ${label}`}
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </Button>
        <Input
          type="number"
          min="0"
          max={max}
          inputMode="numeric"
          aria-label={label}
          className="w-20 text-center text-lg font-black"
          value={String(value)}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={`زيادة ${label}`}
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </Button>
      </div>
    </div>
  );
}

/** One equipment line with dispatch / return flows (local presentation state). */
export function WarehouseLineCard({
  orgId,
  line,
  eventStatus,
  canOperate,
  canReadCost,
  canCaptureEvidence,
  onDispatch,
  onReturn,
  busy,
}: {
  orgId: string | null;
  line: WarehouseLine;
  eventStatus: string;
  /** warehouse.dispatch — precomputed by the panel. */
  canOperate: boolean;
  canReadCost: boolean;
  canCaptureEvidence: boolean;
  onDispatch: (line: WarehouseLine, quantity: number, reference: string) => void;
  onReturn: (
    line: WarehouseLine,
    q: { good: number; damaged: number; lost: number },
    notes: string,
  ) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"none" | "dispatch" | "return">("none");
  const [dispatchQty, setDispatchQty] = useState(line.remainingToDispatch);
  const [reference, setReference] = useState("");
  const [good, setGood] = useState(line.outstanding);
  const [damaged, setDamaged] = useState(0);
  const [lost, setLost] = useState(0);
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState("");

  const dBlock = dispatchBlock({ canOperate, eventStatus, line });
  const rBlock = returnBlock({ canOperate, line });

  function submitDispatch() {
    const check = validateDispatchQuantity(dispatchQty, line);
    if (!check.valid) {
      setLocalError(check.message);
      return;
    }
    setLocalError("");
    onDispatch(line, dispatchQty, reference);
    setMode("none");
  }

  function submitReturn() {
    const check = validateReturnQuantities({ good, damaged, lost }, line);
    if (!check.valid) {
      setLocalError(check.message);
      return;
    }
    setLocalError("");
    onReturn(line, { good, damaged, lost }, notes);
    setMode("none");
  }

  return (
    <Card className={line.outstanding > 0 ? "border-amber-300" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{line.equipmentName}</h3>
          <p className="text-sm text-slate-500">{line.equipmentUnit}</p>
        </div>
        {line.isReconciled && <Badge tone="success">تمت التسوية</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <QuantityStat label="المطلوب تجهيزه" value={line.remainingToDispatch} tone="brand" />
        <QuantityStat label="المحجوز" value={line.reserved} tone="neutral" />
        <QuantityStat label="تم صرفه" value={line.dispatched} tone="brand" />
        <QuantityStat label="تم إرجاعه" value={line.returnedGood} tone="success" />
        <QuantityStat label="تالف" value={line.damaged} tone="danger" />
        <QuantityStat label="مفقود" value={line.lost} tone="danger" />
        <QuantityStat
          label="متبقي بالخارج"
          value={line.outstanding}
          tone={line.outstanding > 0 ? "warning" : "success"}
        />
      </div>

      {canReadCost && line.damageLossValuationMilli !== null && line.damageLossValuationMilli > 0 && (
        <p className="mt-3 text-sm font-bold text-red-700">
          قيمة التالف والمفقود: {formatOMR(line.damageLossValuationMilli)}
        </p>
      )}

      {localError && (
        <InlineError message={localError} className="mt-3" />
      )}

      {mode === "none" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="flex flex-col">
            <Button
              size="lg"
              disabled={dBlock.blocked || busy}
              onClick={() => {
                setDispatchQty(line.remainingToDispatch);
                setLocalError("");
                setMode("dispatch");
              }}
            >
              صرف من المخزن
            </Button>
            {dBlock.blocked && (
              <span className="mt-1 max-w-56 text-xs font-semibold text-slate-500">
                {dispatchBlockMessage(dBlock)}
              </span>
            )}
          </div>
          <div className="flex flex-col">
            <Button
              size="lg"
              variant="secondary"
              disabled={rBlock.blocked || busy}
              onClick={() => {
                setGood(line.outstanding);
                setDamaged(0);
                setLost(0);
                setLocalError("");
                setMode("return");
              }}
            >
              تسجيل إرجاع
            </Button>
            {rBlock.blocked && (
              <span className="mt-1 max-w-56 text-xs font-semibold text-slate-500">
                {returnBlockMessage(rBlock)}
              </span>
            )}
          </div>
        </div>
      )}

      {mode === "dispatch" && (
        <div className="mt-4 space-y-3 rounded-xl bg-brand-50 p-3">
          <p className="font-bold">صرف {line.equipmentName}</p>
          <QuantityStepper
            label="الكمية المصروفة"
            value={dispatchQty}
            max={line.remainingToDispatch}
            onChange={setDispatchQty}
          />
          <Input
            placeholder="رقم الشاحنة أو المرجع (اختياري)"
            aria-label="المرجع"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={busy} onClick={submitDispatch}>
              تأكيد الصرف
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDispatchQty(line.remainingToDispatch);
                setMode("none");
              }}
            >
              صرف الكل ({line.remainingToDispatch})
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setMode("none")}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {mode === "return" && (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-3">
          <p className="font-bold">
            إرجاع {line.equipmentName} — المتبقي بالخارج {line.outstanding}
          </p>
          <div className="flex flex-wrap gap-4">
            <QuantityStepper label="سليم" value={good} max={line.outstanding} onChange={setGood} />
            <QuantityStepper
              label="تالف"
              value={damaged}
              max={line.outstanding}
              onChange={setDamaged}
              tone="danger"
            />
            <QuantityStepper
              label="مفقود"
              value={lost}
              max={line.outstanding}
              onChange={setLost}
              tone="danger"
            />
          </div>
          <Input
            placeholder="ملاحظات الحالة (اختياري)"
            aria-label="ملاحظات الحالة"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={busy} onClick={submitReturn}>
              تأكيد الإرجاع
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setGood(line.outstanding);
                setDamaged(0);
                setLost(0);
              }}
            >
              إرجاع الكل سليم ({line.outstanding})
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setMode("none")}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {orgId && (
        <HandoverEvidenceSection
          orgId={orgId}
          reservationId={line.reservationId}
          canEdit={canCaptureEvidence}
        />
      )}
    </Card>
  );
}
