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

import { useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import {
  useAdjustStock,
  useConsumableStock,
  useReceiveStock,
  useSaveStockItem,
  useUntrackedConsumables,
  useWasteStock,
} from "./consumables.api";
import {
  canManageConsumables,
  canOperateConsumables,
  consumableErrorMessage,
  formatQuantity,
  parseQuantityInput,
  validateQuantityAgainst,
  type StockLine,
} from "./consumables.model";

type LineMode = "none" | "receive" | "waste" | "adjust";

function StockLineCard({
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
        <div className="flex min-w-24 flex-col items-center rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-500">الرصيد الحالي</span>
          <Badge
            tone={line.isLowStock ? "warning" : "success"}
            className="mt-1 text-base font-black"
          >
            {formatQuantity(line.onHandMilli)}
          </Badge>
        </div>
        <div className="flex min-w-24 flex-col items-center rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-500">الحد الأدنى</span>
          <Badge tone="neutral" className="mt-1 text-base font-black">
            {formatQuantity(line.minimumMilli)}
          </Badge>
        </div>
      </div>

      {localError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {localError}
        </p>
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

function TrackNewItem({
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

export function ConsumablesPage() {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const stock = useConsumableStock(orgId);
  const receive = useReceiveStock(orgId);
  const waste = useWasteStock(orgId);
  const adjust = useAdjustStock(orgId);
  const [error, setError] = useState("");

  const canOperate = canOperateConsumables(currentRole);
  const canManage = canManageConsumables(currentRole);
  const busy = receive.isPending || waste.isPending || adjust.isPending;

  async function runReceive(line: StockLine, quantityMilli: number, reference: string) {
    setError("");
    try {
      await receive.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reference,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runWaste(line: StockLine, quantityMilli: number, reason: string) {
    setError("");
    try {
      await waste.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runAdjust(line: StockLine, quantityMilli: number, reason: string) {
    setError("");
    try {
      await adjust.mutateAsync({
        stockItemId: line.stockItemId,
        quantityMilli,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  if (stock.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (stock.isError) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
        {consumableErrorMessage(stock.error)}
      </p>
    );
  }

  const lines = stock.data?.lines ?? [];
  const defects = stock.data?.defects ?? [];
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

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </p>
      )}

      {defects.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <p className="font-black text-red-800">
            بيانات غير مكتملة في {defects.length} صنف. لا تُعرض أرصدة غير
            موثوقة — راجع المسؤول.
          </p>
        </Card>
      )}

      {canManage && (
        <TrackNewItem orgId={orgId} busy={busy} onError={setError} />
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
              canOperate={canOperate}
              canManage={canManage}
              busy={busy}
              onReceive={(l, q, r) => void runReceive(l, q, r)}
              onWaste={(l, q, r) => void runWaste(l, q, r)}
              onAdjust={(l, q, r) => void runAdjust(l, q, r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
