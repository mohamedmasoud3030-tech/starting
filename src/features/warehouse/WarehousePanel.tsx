/**
 * Warehouse control panel inside the Event workspace.
 *
 * Designed for a phone or tablet on a warehouse floor, Arabic-first RTL:
 *  - every quantity is a large tap target with +/- steppers, so the common
 *    case needs no typing at all;
 *  - "صرف الكل" / "إرجاع الكل" cover the dominant full-load actions in one tap;
 *  - blocked controls always state WHY, in Arabic;
 *  - no raw UUIDs and no PostgreSQL error text ever reach the screen;
 *  - the irreversible final reconciliation requires an explicit confirmation.
 */

import { useState } from "react";
import type { AppRole } from "@/lib/dbTypes";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatOMR } from "@/lib/money";
import {
  useDispatchEquipment,
  useEventWarehouse,
  useReconcileWarehouse,
  useReturnEquipment,
} from "./warehouse.api";
import {
  canReconcileWarehouse,
  dispatchBlock,
  dispatchBlockMessage,
  reconcileBlock,
  reconcileBlockMessage,
  returnBlock,
  returnBlockMessage,
  validateDispatchQuantity,
  validateReturnQuantities,
  warehouseErrorMessage,
  WAREHOUSE_STATUS_LABELS,
  WAREHOUSE_STATUS_TONES,
  type WarehouseLine,
} from "./warehouse.model";

interface WarehousePanelProps {
  orgId: string | null;
  eventId: string;
  eventStatus: string;
  role: AppRole | null;
  canReadCost: boolean;
}

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

function QuantityChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
}) {
  return (
    <div className="flex min-w-20 flex-col items-center rounded-xl bg-slate-50 px-3 py-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <Badge tone={tone} className="mt-1 text-base font-black">
        {value}
      </Badge>
    </div>
  );
}

function LineCard({
  line,
  eventStatus,
  role,
  canReadCost,
  onDispatch,
  onReturn,
  busy,
}: {
  line: WarehouseLine;
  eventStatus: string;
  role: AppRole | null;
  canReadCost: boolean;
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

  const dBlock = dispatchBlock({ role, eventStatus, line });
  const rBlock = returnBlock({ role, line });

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
        <QuantityChip label="المطلوب تجهيزه" value={line.remainingToDispatch} tone="brand" />
        <QuantityChip label="المحجوز" value={line.reserved} tone="neutral" />
        <QuantityChip label="تم صرفه" value={line.dispatched} tone="brand" />
        <QuantityChip label="تم إرجاعه" value={line.returnedGood} tone="success" />
        <QuantityChip label="تالف" value={line.damaged} tone="danger" />
        <QuantityChip label="مفقود" value={line.lost} tone="danger" />
        <QuantityChip
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
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {localError}
        </p>
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
    </Card>
  );
}

export function WarehousePanel({
  orgId,
  eventId,
  eventStatus,
  role,
  canReadCost,
}: WarehousePanelProps) {
  const warehouse = useEventWarehouse(orgId, eventId, canReadCost);
  const dispatchMutation = useDispatchEquipment(orgId, eventId);
  const returnMutation = useReturnEquipment(orgId, eventId);
  const reconcileMutation = useReconcileWarehouse(orgId, eventId);
  const [error, setError] = useState("");
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  const busy =
    dispatchMutation.isPending ||
    returnMutation.isPending ||
    reconcileMutation.isPending;

  if (warehouse.isLoading) return <p>جارٍ تحميل حالة المخزن…</p>;
  if (warehouse.isError) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
        {warehouseErrorMessage(warehouse.error)}
      </p>
    );
  }
  if (!warehouse.data) return <p>تعذر تحميل حالة المخزن.</p>;

  const { lines, defects, summary } = warehouse.data;
  const recBlock = reconcileBlock({ role, summary });

  async function runDispatch(
    line: WarehouseLine,
    quantity: number,
    reference: string,
  ) {
    setError("");
    try {
      await dispatchMutation.mutateAsync({
        reservationId: line.reservationId,
        quantity,
        reference,
        notes: "",
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(warehouseErrorMessage(e));
    }
  }

  async function runReturn(
    line: WarehouseLine,
    q: { good: number; damaged: number; lost: number },
    notes: string,
  ) {
    setError("");
    try {
      await returnMutation.mutateAsync({
        reservationId: line.reservationId,
        good: q.good,
        damaged: q.damaged,
        lost: q.lost,
        reference: "",
        conditionNotes: notes,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(warehouseErrorMessage(e));
    }
  }

  async function runReconcile() {
    setError("");
    try {
      await reconcileMutation.mutateAsync({
        notes: reconcileNotes,
        idempotencyKey: crypto.randomUUID(),
      });
      setConfirmingReconcile(false);
      setReconcileNotes("");
    } catch (e) {
      setError(warehouseErrorMessage(e));
      setConfirmingReconcile(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">حالة التسوية</p>
            <Badge tone={WAREHOUSE_STATUS_TONES[summary.status]} className="mt-1 text-base">
              {WAREHOUSE_STATUS_LABELS[summary.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuantityChip label="المحجوز" value={summary.reserved} tone="neutral" />
            <QuantityChip label="تم صرفه" value={summary.dispatched} tone="brand" />
            <QuantityChip label="تم إرجاعه" value={summary.returned_good} tone="success" />
            <QuantityChip label="تالف" value={summary.damaged} tone="danger" />
            <QuantityChip label="مفقود" value={summary.lost} tone="danger" />
            <QuantityChip
              label="متبقي بالخارج"
              value={summary.outstanding}
              tone={summary.outstanding > 0 ? "warning" : "success"}
            />
          </div>
        </div>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </p>
      )}

      {defects.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <p className="font-black text-red-800">
            بيانات غير مكتملة في {defects.length} سطر من أسطر المعدات. لا تُعرض
            كميات غير موثوقة — راجع المسؤول قبل التسوية.
          </p>
        </Card>
      )}

      {lines.length === 0 ? (
        <Card>
          <p className="font-bold text-slate-600">
            لا توجد معدات محجوزة لهذه المناسبة. احجز المعدات أولاً من تبويب المعدات.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <LineCard
              key={line.reservationId}
              line={line}
              eventStatus={eventStatus}
              role={role}
              canReadCost={canReadCost}
              busy={busy}
              onDispatch={(l, q, r) => void runDispatch(l, q, r)}
              onReturn={(l, q, n) => void runReturn(l, q, n)}
            />
          ))}
        </div>
      )}

      {canReconcileWarehouse(role) && (
        <Card>
          <h3 className="font-black">التسوية النهائية للمخزن</h3>
          <p className="mt-1 text-sm text-slate-600">
            بعد التسوية لا يمكن تسجيل صرف أو إرجاع لهذه المناسبة.
          </p>
          {!confirmingReconcile ? (
            <div className="mt-3 flex flex-col">
              <Button
                size="lg"
                disabled={recBlock.blocked || busy}
                onClick={() => setConfirmingReconcile(true)}
              >
                إتمام التسوية النهائية
              </Button>
              {recBlock.blocked && (
                <span className="mt-2 text-sm font-semibold text-slate-600">
                  {reconcileBlockMessage(recBlock)}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3 rounded-xl bg-amber-50 p-3">
              <p className="font-black text-amber-900">
                تأكيد نهائي: هل تريد إغلاق مخزن هذه المناسبة؟ لا يمكن التراجع.
              </p>
              <Input
                placeholder="ملاحظات التسوية (اختياري)"
                aria-label="ملاحظات التسوية"
                value={reconcileNotes}
                onChange={(e) => setReconcileNotes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="lg" disabled={busy} onClick={() => void runReconcile()}>
                  نعم، إتمام التسوية
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => setConfirmingReconcile(false)}
                >
                  تراجع
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
