import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatOMR } from "@/lib/money";
import { InlineError } from "@/components/ui/ErrorState";
import type {
  ProcurementAccess,
  ProcurementConsumableOption,
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
    catalogItemId: "",
    description: "",
    kind: "CONSUMABLE",
    unit: "",
    quantityText: "1",
    unitCostText: "",
  };
}

function todayInMuscat(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

interface OrderCreateDialogProps {
  open: boolean;
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
  suppliers: SupplierListItem[];
  consumables: ProcurementConsumableOption[];
  events: ProcurementEventOption[];
  onOpenChange: (open: boolean) => void;
  onCreated: (order: ProcurementOrderDetail) => void;
}

export function OrderCreateDialog({
  open,
  dataSource,
  access,
  suppliers,
  consumables,
  events,
  onOpenChange,
  onCreated,
}: OrderCreateDialogProps) {
  const [draft, setDraft] = useState<OrderFormDraft>(() => ({
    supplierId: "",
    eventId: "",
    orderDate: todayInMuscat(),
    deliveryDueLocal: "",
    notes: "",
    lines: [newLine()],
  }));
  const [errors, setErrors] = useState(() => validateOrderDraft({
    supplierId: "supplier-placeholder",
    eventId: "",
    orderDate: "2026-01-01",
    deliveryDueLocal: "",
    notes: "",
    lines: [{ ...newLine(), kind: "OTHER", description: "بند", unit: "قطعة", unitCostText: "0" }],
  }));
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  function rotateIntentKey() {
    setIdempotencyKey(newIdempotencyKey());
  }

  function update(patch: Partial<OrderFormDraft>) {
    rotateIntentKey();
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateLine(key: number, patch: Partial<OrderLineDraft>) {
    rotateIntentKey();
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...patch } : line),
    }));
  }

  function addLine() {
    rotateIntentKey();
    setDraft((current) => ({ ...current, lines: [...current.lines, newLine()] }));
  }

  function removeLine(key: number) {
    rotateIntentKey();
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
      const created = await dataSource.createOrder(orderDraftToInput(draft, idempotencyKey));
      onCreated(created);
      onOpenChange(false);
    } catch (cause) {
      // The intent key remains unchanged so an ambiguous failure can replay.
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
      description="أنشئ مسودة واضحة للمورد. الاعتماد والإرسال والتأكيد خطوات منفصلة."
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاريخ الطلب" htmlFor="order-date" required error={errors.orderDate}>
              <Input
                id="order-date"
                type="date"
                dir="ltr"
                value={draft.orderDate}
                aria-invalid={Boolean(errors.orderDate)}
                onChange={(event) => update({ orderDate: event.target.value })}
              />
            </Field>
            <Field label="موعد التوريد المتوقع (اختياري)" htmlFor="order-delivery-due" error={errors.deliveryDueLocal} hint="بتوقيت سلطنة عمان.">
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
          </div>

          <section aria-labelledby="order-lines-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 id="order-lines-heading" className="text-lg font-black">الأصناف / البنود</h3><p className="text-sm text-slate-500">الكمية والسعر بدقة 3 خانات عشرية كحد أقصى.</p></div>
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
                    <Field label="نوع البند" htmlFor={`order-line-kind-${line.key}`}>
                      <Select
                        id={`order-line-kind-${line.key}`}
                        value={line.kind}
                        onChange={(event) => {
                          const kind = event.target.value as ProcurementLineKind;
                          updateLine(line.key, {
                            kind,
                            catalogItemId: kind === "CONSUMABLE" ? line.catalogItemId : "",
                          });
                        }}
                      >
                        {(Object.keys(LINE_KIND_LABELS) as ProcurementLineKind[]).map((kind) => <option key={kind} value={kind}>{LINE_KIND_LABELS[kind]}</option>)}
                      </Select>
                    </Field>
                    {line.kind === "CONSUMABLE" ? (
                      <Field label="صنف المخزون" htmlFor={`order-line-catalog-${line.key}`} required error={lineError.catalogItemId}>
                        <Select
                          id={`order-line-catalog-${line.key}`}
                          value={line.catalogItemId}
                          aria-invalid={Boolean(lineError.catalogItemId)}
                          onChange={(event) => {
                            const item = consumables.find((candidate) => candidate.id === event.target.value);
                            updateLine(line.key, {
                              catalogItemId: event.target.value,
                              description: item?.name ?? "",
                              unit: item?.unit ?? "",
                            });
                          }}
                        >
                          <option value="">اختر صنفاً متتبَّعاً</option>
                          {consumables.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}
                        </Select>
                        {consumables.length === 0 && <p className="mt-1 text-sm font-semibold text-amber-700">لا توجد أصناف استهلاكية مفعّل لها تتبع المخزون.</p>}
                      </Field>
                    ) : (
                      <>
                        <Field className="sm:col-span-2" label="وصف البند" htmlFor={`order-line-description-${line.key}`} required error={lineError.description}>
                          <Input id={`order-line-description-${line.key}`} value={line.description} aria-invalid={Boolean(lineError.description)} aria-describedby={lineError.description ? `order-line-description-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder="مثال: وجبات غداء" />
                        </Field>
                        <Field label="الوحدة" htmlFor={`order-line-unit-${line.key}`} required error={lineError.unit}>
                          <Input id={`order-line-unit-${line.key}`} value={line.unit} aria-invalid={Boolean(lineError.unit)} aria-describedby={lineError.unit ? `order-line-unit-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { unit: event.target.value })} placeholder="وجبة / خدمة / قطعة" />
                        </Field>
                      </>
                    )}
                    {line.kind === "CONSUMABLE" && line.catalogItemId && (
                      <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">الوحدة المعتمدة: <strong>{line.unit}</strong></div>
                    )}
                    <Field label="الكمية" htmlFor={`order-line-quantity-${line.key}`} required error={lineError.quantity}>
                      <Input id={`order-line-quantity-${line.key}`} inputMode="decimal" dir="ltr" value={line.quantityText} aria-invalid={Boolean(lineError.quantity)} aria-describedby={lineError.quantity ? `order-line-quantity-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { quantityText: event.target.value })} placeholder="0.000" />
                    </Field>
                    {access.canViewCommercialAmounts && (
                      <Field label="سعر الوحدة المتفق عليه (ر.ع.)" htmlFor={`order-line-cost-${line.key}`} required error={lineError.unitCost} hint="بدقة 3 خانات عشرية.">
                        <Input id={`order-line-cost-${line.key}`} inputMode="decimal" dir="ltr" value={line.unitCostText} aria-invalid={Boolean(lineError.unitCost)} aria-describedby={lineError.unitCost ? `order-line-cost-${line.key}-error` : undefined} onChange={(event) => updateLine(line.key, { unitCostText: event.target.value })} placeholder="0.000" />
                      </Field>
                    )}
                  </div>
                  {preview !== null && <p className="mt-3 rounded-xl bg-slate-50 p-2 text-sm font-bold">إجمالي البند: {formatOMR(preview)}</p>}
                </div>
              );
            })}
            {errors.lines && <InlineError message={errors.lines} />}
          </section>

          <Field label="ملاحظات الطلب (اختياري)" htmlFor="order-notes">
            <Textarea id="order-notes" rows={3} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="تعليمات التوصيل أو تفاصيل يحتاجها المورد" />
          </Field>
          {submitError && <InlineError message={submitError} />}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={busy || activeSuppliers.length === 0 || !access.canViewCommercialAmounts}>{busy ? "جارٍ إنشاء المسودة…" : "إنشاء المسودة"}</Button>
          </div>
          {!access.canViewCommercialAmounts && <p className="text-sm font-semibold text-amber-700">إنشاء الطلب التجاري يحتاج صلاحية الاطلاع على التكلفة المتفق عليها.</p>}
        </form>
      )}
    </Dialog>
  );
}
