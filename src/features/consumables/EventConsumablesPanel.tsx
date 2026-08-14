/**
 * Event consumables panel inside the Event workspace (S4B).
 *
 * The operator sees, per item: تم صرفه / مرتجع صالح / تم استهلاكه / هالك /
 * المتبقي مع المناسبة, plus the Event-level "حالة التسوية" badge. Actions:
 *  - صرف للمناسبة (issue from tracked stock, blocked on shortage);
 *  - مرتجع صالح (usable return to warehouse);
 *  - تم استهلاكه (actual consumption);
 *  - هالك (event waste, reason required);
 *  - التسوية النهائية (OWNER/MANAGER, explicit confirmation, irreversible).
 *
 * All Arabic/RTL, large touch targets, exact decimal quantities, explicit
 * blocked reasons, and no raw UUID / SQL error ever reaches the screen.
 */

import { useState } from "react";
import type { AppRole } from "@/lib/dbTypes";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  useConsumableStock,
  useConsumeAtEvent,
  useEventConsumables,
  useIssueToEvent,
  useReconcileConsumables,
  useReturnFromEvent,
  useWasteAtEvent,
} from "./consumables.api";
import {
  canManageConsumables,
  consumableErrorMessage,
  CONSUMABLE_STATUS_LABELS,
  CONSUMABLE_STATUS_TONES,
  custodyBlock,
  custodyBlockMessage,
  formatQuantity,
  issueBlock,
  issueBlockMessage,
  reconcileConsumablesBlock,
  reconcileConsumablesBlockMessage,
  validateQuantityAgainst,
  type EventConsumableLine,
} from "./consumables.model";

interface EventConsumablesPanelProps {
  orgId: string | null;
  eventId: string;
  eventStatus: string;
  role: AppRole | null;
}

function QuantityChip({
  label,
  milli,
  tone,
}: {
  label: string;
  milli: number;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
}) {
  return (
    <div className="flex min-w-20 flex-col items-center rounded-xl bg-slate-50 px-3 py-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <Badge tone={tone} className="mt-1 text-base font-black">
        {formatQuantity(milli)}
      </Badge>
    </div>
  );
}

type CustodyMode = "none" | "return" | "consume" | "waste";

function CustodyLineCard({
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

  const modeTitles: Record<Exclude<CustodyMode, "none">, string> = {
    return: "مرتجع صالح إلى المخزن",
    consume: "تسجيل استهلاك فعلي",
    waste: "تسجيل هالك",
  };

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
        <QuantityChip label="تم صرفه" milli={line.issuedMilli} tone="brand" />
        <QuantityChip label="مرتجع صالح" milli={line.returnedMilli} tone="success" />
        <QuantityChip label="تم استهلاكه" milli={line.consumedMilli} tone="neutral" />
        <QuantityChip label="هالك" milli={line.wastedMilli} tone="danger" />
        <QuantityChip
          label="المتبقي مع المناسبة"
          milli={line.outstandingMilli}
          tone={line.outstandingMilli > 0 ? "warning" : "success"}
        />
      </div>

      {localError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {localError}
        </p>
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
            {modeTitles[mode]} — المتبقي {formatQuantity(line.outstandingMilli)}
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

export function EventConsumablesPanel({
  orgId,
  eventId,
  eventStatus,
  role,
}: EventConsumablesPanelProps) {
  const eventConsumables = useEventConsumables(orgId, eventId);
  const stock = useConsumableStock(orgId);
  const issueMutation = useIssueToEvent(orgId, eventId);
  const returnMutation = useReturnFromEvent(orgId, eventId);
  const consumeMutation = useConsumeAtEvent(orgId, eventId);
  const wasteMutation = useWasteAtEvent(orgId, eventId);
  const reconcileMutation = useReconcileConsumables(orgId, eventId);

  const [error, setError] = useState("");
  const [issueStockItemId, setIssueStockItemId] = useState("");
  const [issueQuantityText, setIssueQuantityText] = useState("");
  const [issueLocalError, setIssueLocalError] = useState("");
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  const busy =
    issueMutation.isPending ||
    returnMutation.isPending ||
    consumeMutation.isPending ||
    wasteMutation.isPending ||
    reconcileMutation.isPending;

  if (eventConsumables.isLoading) return <p>جارٍ تحميل مواد المناسبة…</p>;
  if (eventConsumables.isError) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
        {consumableErrorMessage(eventConsumables.error)}
      </p>
    );
  }
  if (!eventConsumables.data || eventConsumables.data.summary === null) {
    return <p>تعذر تحميل حالة مواد المناسبة.</p>;
  }

  const { lines, defects, summary } = eventConsumables.data;
  const stockLines = (stock.data?.lines ?? []).filter(
    (l) => l.isTrackingActive && l.onHandMilli > 0,
  );
  const iBlock = issueBlock({
    role,
    eventStatus,
    isReconciled: summary.isReconciled,
  });
  const recBlock = reconcileConsumablesBlock({ role, summary });
  const selectedStock = stockLines.find((l) => l.stockItemId === issueStockItemId);

  async function runIssue() {
    if (!selectedStock) {
      setIssueLocalError("اختر الصنف أولاً.");
      return;
    }
    const check = validateQuantityAgainst(
      issueQuantityText,
      selectedStock.onHandMilli,
      "الرصيد المتوفر",
    );
    if (!check.valid) {
      setIssueLocalError(check.message);
      return;
    }
    setIssueLocalError("");
    setError("");
    try {
      await issueMutation.mutateAsync({
        stockItemId: selectedStock.stockItemId,
        quantityMilli: check.milli,
        reference: "",
        idempotencyKey: crypto.randomUUID(),
      });
      setIssueStockItemId("");
      setIssueQuantityText("");
    } catch (e) {
      setError(consumableErrorMessage(e));
    }
  }

  async function runCustody(
    kind: "return" | "consume" | "waste",
    line: EventConsumableLine,
    quantityMilli: number,
    note: string,
  ) {
    setError("");
    const input = {
      stockItemId: line.stockItemId,
      quantityMilli,
      note,
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      if (kind === "return") await returnMutation.mutateAsync(input);
      else if (kind === "consume") await consumeMutation.mutateAsync(input);
      else await wasteMutation.mutateAsync(input);
    } catch (e) {
      setError(consumableErrorMessage(e));
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
      setError(consumableErrorMessage(e));
      setConfirmingReconcile(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">حالة التسوية</p>
            <Badge tone={CONSUMABLE_STATUS_TONES[summary.status]} className="mt-1 text-base">
              {CONSUMABLE_STATUS_LABELS[summary.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuantityChip label="تم صرفه" milli={summary.issuedMilli} tone="brand" />
            <QuantityChip label="مرتجع صالح" milli={summary.returnedMilli} tone="success" />
            <QuantityChip label="تم استهلاكه" milli={summary.consumedMilli} tone="neutral" />
            <QuantityChip label="هالك" milli={summary.wastedMilli} tone="danger" />
            <QuantityChip
              label="المتبقي مع المناسبة"
              milli={summary.outstandingMilli}
              tone={summary.outstandingMilli > 0 ? "warning" : "success"}
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
            بيانات غير مكتملة في {defects.length} سطر من مواد المناسبة. لا تُعرض
            كميات غير موثوقة — راجع المسؤول قبل التسوية.
          </p>
        </Card>
      )}

      {!summary.isReconciled && (
        <Card>
          <h3 className="font-black">صرف للمناسبة</h3>
          {iBlock.blocked ? (
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {issueBlockMessage(iBlock)}
            </p>
          ) : stockLines.length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-slate-500">
              لا توجد أصناف متوفرة في مخزون المواد الاستهلاكية.
            </p>
          ) : (
            <>
              {issueLocalError && (
                <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 font-bold text-red-700">
                  {issueLocalError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="الصنف">
                  <Select
                    value={issueStockItemId}
                    onChange={(e) => setIssueStockItemId(e.target.value)}
                  >
                    <option value="">اختر الصنف</option>
                    {stockLines.map((l) => (
                      <option key={l.stockItemId} value={l.stockItemId}>
                        {l.itemName} · المتوفر {formatQuantity(l.onHandMilli)}{" "}
                        {l.itemUnit}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={`الكمية${selectedStock ? ` (${selectedStock.itemUnit || "وحدة"})` : ""}`}
                >
                  <Input
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.000"
                    className="w-32 text-center text-lg font-black"
                    value={issueQuantityText}
                    onChange={(e) => setIssueQuantityText(e.target.value)}
                  />
                </Field>
                <Button size="lg" disabled={busy} onClick={() => void runIssue()}>
                  صرف
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {lines.length === 0 ? (
        <Card>
          <p className="font-bold text-slate-600">
            لم تُصرف مواد استهلاكية لهذه المناسبة بعد.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <CustodyLineCard
              key={line.stockItemId}
              line={line}
              role={role}
              busy={busy}
              onMove={(kind, l, q, n) => void runCustody(kind, l, q, n)}
            />
          ))}
        </div>
      )}

      {canManageConsumables(role) && (
        <Card>
          <h3 className="font-black">التسوية النهائية للمواد الاستهلاكية</h3>
          <p className="mt-1 text-sm text-slate-600">
            بعد التسوية لا يمكن تسجيل صرف أو مرتجع أو استهلاك أو هالك لهذه
            المناسبة.
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
                  {reconcileConsumablesBlockMessage(recBlock)}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3 rounded-xl bg-amber-50 p-3">
              <p className="font-black text-amber-900">
                تأكيد نهائي: هل تريد إغلاق مواد هذه المناسبة؟ لا يمكن التراجع.
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
