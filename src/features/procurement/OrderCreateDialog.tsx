import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatOMR } from "@/lib/money";
import type {
  ProcurementAccess,
  ProcurementDataSource,
  ProcurementEventOption,
  ProcurementLineKind,
  ProcurementOrderDetail,
  SupplierListItem,
} from "./contracts";
import { procurementErrorMessage } from "./errors";
import { LINE_KIND_LABELS } from "./presentation";
import {
  hasOrderErrors,
  linePreviewTotal,
  orderDraftToInput,
  validateOrderDraft,
  type OrderFormDraft,
  type OrderLineDraft,
} from "./validation";

let draftLineSequence = 0;
function newLine(): OrderLineDraft {
  draftLineSequence += 1;
  return {
    key: draftLineSequence,
    description: "",
    kind: "CONSUMABLE",
    unit: "قطعة",
    quantityText: "1",
    unitCostText: "",
  };
}

interface OrderCreateDialogProps {
  open: boolean;
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  suppliers: SupplierListItem[];
  events: ProcurementEventOption[];
  onOpenChange: (open: boolean) => void;
  onCreated: (order: ProcurementOrderDetail) => void;
}

export function OrderCreateDialog({
  open,
  dataSource,
  access,
  suppliers,
  events,
  onOpenChange,
  onCreated,
}: OrderCreateDialogProps) {
  const [draft, setDraft] = useState<OrderFormDraft>(() => ({
    supplierId: "",
    eventId: "",
    deliveryDueLocal: "",
    notes: "",
    lines: [newLine()],
  }));
  const [errors, setErrors] = useState(() => validateOrderDraft({
    supplierId: "supplier-placeholder",
    eventId: "",
    deliveryDueLocal: "2026-01-01T10:00",
    notes: "",
    lines: [{ ...newLine(), description: "بند", unit: "قطعة" }],
  }));
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function update(patch: Partial<OrderFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateLine(key: number, patch: Partial<OrderLineDraft>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...patch } : line),
    }));
  }

  function addLine() {
    setDraft((current) => ({ ...current, lines: [...current.lines, newLine()] }));
  }

  function removeLine(key: number) {
    setDraft((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateOrderDraft(draft);
    setErrors(nextErrors);
    if (hasOrderErrors(nextErrors)) return;
    setBusy(true);
    setSubmitError("");
    try {
      const created = await dataSource.createOrder(orderDraftToInput(draft));
      onCreated(created);
      onOpenChange(false);
    } catch (cause) {
      setSubmitError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "ACTIVE");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title="طلب توريد جديد"
      description="أنشئ مسودة واضحة للمورد. الاعتماد يتم في خطوة منفصلة."
      className="max-w-3xl"
    >
      {open && (
        <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المورد" htmlFor="order-supplier" required error={errors.supplierId}>
              <Select
                id="order-supplier"
                value={draft.supplierId}
                aria-invalid={Boolean(errors.supplierId)}
                aria-describedby={errors.supplierId ? "order-supplier-error" : undefined}
                onChange={(event) => update({ supplierId: event.target.value })}
              >
                <option value="">اختر المورد</option>
                {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </Select>
              {activeSuppliers.length === 0 && <p className="mt-1 text-sm font-semibold text-amber-700">لا يوجد مورد نشط متاح. أضف مورداً أو فعّل مورداً أولاً.</p>}
            </Field>
            <Field label="المناسبة (اختياري)" htmlFor="order-event">
              <Select id="order-event" value={draft.eventId} onChange={(event) => update({ eventId: event.target.value })}>
                <option value="">طلب عام غير مرتبط بمناسبة</option>
                {events.map((event) => <option key={event.id} value={event.id}>{event.eventNumber ? `${event.eventNumber} · ` : ""}{event.title}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="موعد التوريد" htmlFor="order-delivery-due" required error={errors.deliveryDueLocal} hint="التاريخ والوقت المتوقعان لوصول المواد أو الخدمة.">
            <Input
              id="order-delivery-due"
              type="datetime-local"
              dir="ltr"
              value={draft.deliveryDueLocal}
              aria-invalid={Boolean(errors.deliveryDueLocal)}
              aria-describedby={errors.deliveryDueLocal ? "order-delivery-due-error" : undefined}
              onChange={(event) => update({ deliveryDueLocal: event.target.value })}
            />
          </Field>

          <section aria-labelledby="order-lines-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 id="order-lines-heading" className="text-lg font-black">الأصناف / البنود</h3><p className="text-sm text-slate-500">الكمية بدقة 3 خانات عشرية كحد أقصى.</p></div>
              <Button variant="secondary" onClick={addLine}><Plus aria-hidden="true" />إضافة بند</Button>
            </div>
            {draft.lines.map((line, index) => {
              const lineError = errors.lineErrors[line.key] ?? {};
              const preview = access.canViewCommercialAmounts ? linePreviewTotal(line.unitCostText, line.quantityText) : null;
              return (
                <div key={line.key} className="relative rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="font-black">البند {index + 1}</h4>
                    <button type="button" className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40" aria-label={`حذف البند ${index + 1}`} disabled={draft.lines.length === 1} onClick={() => removeLine(line.key)}><Trash2 aria-hidden="true" /></button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field className="sm:col-span-2" label="وصف البند" htmlFor={`order-line-description-${line.key}`} required error={lineError.description}>
                      <Input id={`order-line-description-${line.key}`} value={line.description} aria-invalid={Boolean(lineError.description)} aria-describedby={lineError.description ? `order-line-description-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder="مثال: عبوات مياه 330 مل" />
                    </Field>
                    <Field label="نوع الاستلام" htmlFor={`order-line-kind-${line.key}`}>
                      <Select id={`order-line-kind-${line.key}`} value={line.kind} onChange={(event) => updateLine(line.key, { kind: event.target.value as ProcurementLineKind })}>
                        {(Object.keys(LINE_KIND_LABELS) as ProcurementLineKind[]).map((kind) => <option key={kind} value={kind}>{LINE_KIND_LABELS[kind]}</option>)}
                      </Select>
                    </Field>
                    <Field label="الوحدة" htmlFor={`order-line-unit-${line.key}`} required error={lineError.unit}>
                      <Input id={`order-line-unit-${line.key}`} value={line.unit} aria-invalid={Boolean(lineError.unit)} aria-describedby={lineError.unit ? `order-line-unit-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { unit: event.target.value })} placeholder="قطعة / كجم / خدمة" />
                    </Field>
                    <Field label="الكمية" htmlFor={`order-line-quantity-${line.key}`} required error={lineError.quantity}>
                      <Input id={`order-line-quantity-${line.key}`} inputMode="decimal" dir="ltr" value={line.quantityText} aria-invalid={Boolean(lineError.quantity)} aria-describedby={lineError.quantity ? `order-line-quantity-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { quantityText: event.target.value })} placeholder="0.000" />
                    </Field>
                    {access.canViewCommercialAmounts && (
                      <Field label="سعر الوحدة (ر.ع.)" htmlFor={`order-line-cost-${line.key}`} error={lineError.unitCost} hint="اختياري — بدقة 3 خانات عشرية.">
                        <Input id={`order-line-cost-${line.key}`} inputMode="decimal" dir="ltr" value={line.unitCostText} aria-invalid={Boolean(lineError.unitCost)} aria-describedby={lineError.unitCost ? `order-line-cost-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { unitCostText: event.target.value })} placeholder="0.000" />
                      </Field>
                    )}
                  </div>
                  {preview !== null && <p className="mt-3 rounded-xl bg-slate-50 p-2 text-sm font-bold">إجمالي البند: {formatOMR(preview)}</p>}
                </div>
              );
            })}
            {errors.lines && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{errors.lines}</p>}
          </section>

          <Field label="ملاحظات الطلب (اختياري)" htmlFor="order-notes">
            <Textarea id="order-notes" rows={3} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="تعليمات التوصيل أو تفاصيل يحتاجها المورد" />
          </Field>
          {submitError && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{submitError}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={busy || activeSuppliers.length === 0}>{busy ? "جارٍ إنشاء المسودة…" : "إنشاء المسودة"}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
