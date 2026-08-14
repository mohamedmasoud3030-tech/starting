import { useState, type FormEvent } from "react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type {
  ProcurementDataSource,
  ProcurementOrderDetail,
  ProcurementReceipt,
} from "./contracts";
import { capabilityMessage, procurementErrorMessage } from "./errors";
import { LINE_KIND_LABELS } from "./presentation";
import {
  formatQuantity,
  parsePositiveQuantity,
  validateReceiptDraft,
  type ReceiptLineDraft,
} from "./validation";

interface ReceivingDialogProps {
  open: boolean;
  order: ProcurementOrderDetail;
  dataSource: ProcurementDataSource;
  onOpenChange: (open: boolean) => void;
  onReceived: () => void;
}

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function ReceivingDialog({
  open,
  order,
  dataSource,
  onOpenChange,
  onReceived,
}: ReceivingDialogProps) {
  const receivableLines = order.lines.filter(
    (line) => line.remainingQuantityMilli > 0,
  );
  const [draft, setDraft] = useState<ReceiptLineDraft[]>(() =>
    receivableLines.map((line) => ({ orderLineId: line.id, quantityText: "" })),
  );
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"edit" | "confirm" | "success">("edit");
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [receipt, setReceipt] = useState<ProcurementReceipt | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  function setQuantity(orderLineId: string, quantityText: string) {
    setDraft((current) =>
      current.map((item) =>
        item.orderLineId === orderLineId ? { ...item, quantityText } : item,
      ),
    );
    setErrors((current) => {
      const next = { ...current };
      delete next[orderLineId];
      delete next._form;
      return next;
    });
  }

  function fillRemaining() {
    setDraft(
      receivableLines.map((line) => ({
        orderLineId: line.id,
        quantityText: line.receive.allowed
          ? formatQuantity(line.remainingQuantityMilli)
          : "",
      })),
    );
    setErrors({});
  }

  function review(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateReceiptDraft(draft, order.lines);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setRequestError("");
    setStage("confirm");
  }

  const selected = draft.flatMap((item) => {
    if (!item.quantityText.trim()) return [];
    const quantity = parsePositiveQuantity(item.quantityText);
    const line = order.lines.find((candidate) => candidate.id === item.orderLineId);
    if (!quantity.ok || !line) return [];
    return [{ line, quantityMilli: quantity.milli }];
  });

  async function confirmReceipt() {
    setBusy(true);
    setRequestError("");
    try {
      const created = await dataSource.recordReceipt({
        orderId: order.id,
        lines: selected.map(({ line, quantityMilli }) => ({
          orderLineId: line.id,
          quantityMilli,
        })),
        notes: notes.trim() || null,
        idempotencyKey,
      });
      setReceipt(created);
      setStage("success");
      onReceived();
    } catch (cause) {
      // The same key and payload are retained so retry is safe.
      setRequestError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function backToEdit() {
    setStage("edit");
    setRequestError("");
    // The operator may change the payload, so it gets a fresh request key.
    setIdempotencyKey(newIdempotencyKey());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title={stage === "success" ? "تم تسجيل الاستلام" : `استلام الطلب ${order.orderNumber}`}
      description={
        stage === "edit"
          ? "سجّل ما وصل فعلياً فقط. يمكنك استلام الكمية كاملة أو جزءاً منها."
          : stage === "confirm"
            ? "راجع الكميات قبل التأكيد النهائي."
            : undefined
      }
      className="max-w-2xl"
    >
      {stage === "edit" && (
        <form className="space-y-4" onSubmit={review} noValidate>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 p-3">
            <p className="font-bold text-brand-900">المورد: {order.supplier.name}</p>
            <Button variant="secondary" onClick={fillRemaining}>تحديد كل المتبقي</Button>
          </div>
          <div className="space-y-3">
            {receivableLines.map((line, lineIndex) => {
              const lineDraft = draft.find((item) => item.orderLineId === line.id);
              const error = errors[line.id];
              const inputId = `receipt-quantity-${lineIndex}`;
              return (
                <div key={line.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-black">{line.description}</h3>
                      <Badge className="mt-1">{LINE_KIND_LABELS[line.kind]}</Badge>
                    </div>
                    <span className="font-bold text-slate-600">{line.unit}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 p-2"><dt className="text-xs font-semibold text-slate-500">المطلوب</dt><dd className="mt-1 font-black">{formatQuantity(line.orderedQuantityMilli)}</dd></div>
                    <div className="rounded-xl bg-emerald-50 p-2"><dt className="text-xs font-semibold text-emerald-700">المستلم</dt><dd className="mt-1 font-black text-emerald-800">{formatQuantity(line.receivedQuantityMilli)}</dd></div>
                    <div className="rounded-xl bg-amber-50 p-2"><dt className="text-xs font-semibold text-amber-700">المتبقي</dt><dd className="mt-1 font-black text-amber-800">{formatQuantity(line.remainingQuantityMilli)}</dd></div>
                  </dl>
                  <Field
                    className="mt-3"
                    label={line.kind === "CATERING_SERVICE" ? `الكمية المسلّمة الآن (${line.unit})` : `الكمية المستلمة الآن (${line.unit})`}
                    htmlFor={inputId}
                    error={error}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id={inputId}
                        inputMode="decimal"
                        dir="ltr"
                        disabled={!line.receive.allowed}
                        value={lineDraft?.quantityText ?? ""}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${inputId}-error` : undefined}
                        placeholder="0.000"
                        className="text-center text-lg font-black sm:max-w-48"
                        onChange={(event) => setQuantity(line.id, event.target.value)}
                      />
                      {line.receive.allowed && (
                        <Button
                          variant="outline"
                          onClick={() => setQuantity(line.id, formatQuantity(line.remainingQuantityMilli))}
                        >
                          استلام كامل المتبقي
                        </Button>
                      )}
                    </div>
                  </Field>
                  {!line.receive.allowed && (
                    <p className="mt-2 text-sm font-semibold text-slate-500">
                      {capabilityMessage(line.receive.reason)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {errors._form && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{errors._form}</p>}
          <Field label="ملاحظة الاستلام (اختياري)" htmlFor="receipt-notes">
            <Textarea id="receipt-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: تم فحص العبوات وحالتها سليمة" />
          </Field>
          <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
            استلام المواد الاستهلاكية يحدّث المخزون من خلال إجراء الخادم المعتمد؛ هذه الشاشة لا تعدّل الرصيد مباشرة.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit"><PackageCheck aria-hidden="true" />مراجعة الاستلام</Button>
          </div>
        </form>
      )}

      {stage === "confirm" && (
        <div className="space-y-4">
          <div className="space-y-2" aria-label="ملخص كميات الاستلام">
            {selected.map(({ line, quantityMilli }) => (
              <div key={line.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                <div><p className="font-bold">{line.description}</p><p className="text-sm text-slate-500">{line.kind === "CATERING_SERVICE" ? "تأكيد تسليم خدمة" : "استلام مواد"}</p></div>
                <p className="text-lg font-black">{formatQuantity(quantityMilli)} {line.unit}</p>
              </div>
            ))}
          </div>
          <p className="font-bold">هل تؤكد أن هذه الكميات وصلت فعلياً؟</p>
          {requestError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
              <p className="font-bold">{requestError}</p>
              <p className="mt-1 text-sm">يمكنك إعادة المحاولة بأمان؛ لن يتكرر الاستلام الناجح.</p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={backToEdit}>تعديل الكميات</Button>
            <Button disabled={busy} onClick={() => void confirmReceipt()}>
              {busy ? "جارٍ تسجيل الاستلام…" : requestError ? "إعادة المحاولة" : "تأكيد الاستلام"}
            </Button>
          </div>
        </div>
      )}

      {stage === "success" && (
        <div className="flex flex-col items-center py-6 text-center" role="status">
          <CheckCircle2 className="h-16 w-16 text-emerald-600" aria-hidden="true" />
          <h3 className="mt-3 text-xl font-black text-emerald-800">تم حفظ الاستلام بنجاح</h3>
          {receipt?.receiptNumber && <p className="mt-1 font-bold text-slate-600">مرجع الاستلام: {receipt.receiptNumber}</p>}
          <p className="mt-2 max-w-md text-slate-600">تم تحديث حالة الطلب. إن كانت الكمية جزئية فسيبقى المتبقي ظاهراً للاستلام القادم.</p>
          <Button className="mt-5" onClick={() => onOpenChange(false)}>تم</Button>
        </div>
      )}
    </Dialog>
  );
}
