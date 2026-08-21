import type { FormEvent } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ITEM_TYPE_LABELS, PRICING_METHOD_LABELS } from "@/lib/domain";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";
import type { DraftLine } from "./quotationDraft.model";

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as CatalogItemType[];
const PRICING_METHODS = Object.keys(PRICING_METHOD_LABELS) as PricingMethod[];

/**
 * Step 2 — "الخدمات والسعر": package application, custom line entry and the
 * editable line list. All mutations go through the controller callbacks.
 */
export function QuotationServicesStep({
  packages,
  selectedPackage,
  onSelectedPackageChange,
  onApplyPackage,
  onAddCustomLine,
  lines,
  lineTotals,
  onUpdateLine,
  onRemoveLine,
}: {
  packages: ReadonlyArray<{
    package: { id: string; name: string; status: string };
  }>;
  selectedPackage: string;
  onSelectedPackageChange: (value: string) => void;
  onApplyPackage: () => void;
  onAddCustomLine: (e: FormEvent<HTMLFormElement>) => void;
  lines: ReadonlyArray<DraftLine>;
  lineTotals: ReadonlyArray<MilliOMR | null>;
  onUpdateLine: (
    clientKey: string,
    patch: Partial<Pick<DraftLine, "description" | "quantity" | "unitSellingPrice">>,
  ) => void;
  onRemoveLine: (clientKey: string) => void;
}) {
  return (
    <Card id="quotation-services" className="scroll-mt-24 p-5">
      <h2 className="mb-1 text-xl font-black">
        <span className="text-brand-700">٢.</span> الخدمات والسعر
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        أضف الخدمات والأسعار يدوياً. الباقة اختيارية وليست مطلوبة لإصدار العرض.
      </p>

      <form className="grid gap-3 sm:grid-cols-6" onSubmit={onAddCustomLine}>
        <div className="sm:col-span-3">
          <Field label="الوصف" htmlFor="line-description">
            <Input id="line-description" name="description" placeholder="مثال: طاولة ملكية" />
          </Field>
        </div>
        <div className="sm:col-span-1">
          <Field label="النوع" htmlFor="line-item-type">
            <Select id="line-item-type" name="itemType" defaultValue="SERVICE">
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-1">
          <Field label="الوحدة" htmlFor="line-unit">
            <Input id="line-unit" name="unit" placeholder="وحدة" />
          </Field>
        </div>
        <div className="sm:col-span-1">
          <Field label="طريقة التسعير" htmlFor="line-pricing-method">
            <Select id="line-pricing-method" name="pricingMethod" defaultValue="FIXED">
              {PRICING_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PRICING_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="الكمية" htmlFor="line-quantity">
            <Input id="line-quantity" name="quantity" type="number" min="0.001" step="0.001" placeholder="1" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="سعر الوحدة (ر.ع.)" htmlFor="line-price">
            <Input id="line-price" name="price" type="number" min="0" step="0.001" placeholder="50.000" />
          </Field>
        </div>
        <div className="sm:col-span-2 flex items-end">
          <Button type="submit">
            <Plus className="h-5 w-5" />
            إضافة خدمة
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
        <div className="min-w-52 flex-1">
          <Field label="باقة جاهزة" htmlFor="qq-package">
            <Select
              id="qq-package"
              value={selectedPackage}
              onChange={(e) => onSelectedPackageChange(e.target.value)}
            >
              <option value="">اختياري — اختر الباقة…</option>
              {packages
                .filter((p) => p.package.status === "ACTIVE")
                .map((p) => (
                  <option key={p.package.id} value={p.package.id}>
                    {p.package.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Button variant="secondary" onClick={onApplyPackage}>
          <Package className="h-5 w-5" />
          تطبيق الباقة
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {lines.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-slate-500">
            لا توجد خدمات بعد.
          </p>
        ) : (
          lines.map((line, index) => {
            const total = lineTotals[index];
            return (
              <div
                key={line.clientKey}
                className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto] sm:items-end"
              >
                <Field label="الخدمة" htmlFor={`draft-description-${line.clientKey}`}>
                  <div className="relative">
                    <Input
                      id={`draft-description-${line.clientKey}`}
                      aria-label={`وصف خدمة ${line.description}`}
                      value={line.description}
                      onChange={(event) => onUpdateLine(line.clientKey, { description: event.target.value })}
                    />
                    {!line.isCustom && (
                      <Badge tone="neutral" className="absolute top-3 left-2">
                        من باقة
                      </Badge>
                    )}
                  </div>
                </Field>
                <Field label={`الكمية (${line.unit})`} htmlFor={`draft-quantity-${line.clientKey}`}>
                  <Input
                    id={`draft-quantity-${line.clientKey}`}
                    aria-label={`كمية خدمة ${line.description}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => onUpdateLine(line.clientKey, { quantity: event.target.value })}
                  />
                </Field>
                <Field label="سعر الوحدة (ر.ع.)" htmlFor={`draft-price-${line.clientKey}`}>
                  <Input
                    id={`draft-price-${line.clientKey}`}
                    aria-label={`سعر خدمة ${line.description}`}
                    inputMode="decimal"
                    value={line.unitSellingPrice}
                    onChange={(event) => onUpdateLine(line.clientKey, { unitSellingPrice: event.target.value })}
                  />
                </Field>
                <div className="flex min-h-12 items-center justify-between gap-2 sm:justify-end">
                  <div className="text-left">
                    <p className="text-xs text-slate-500">{PRICING_METHOD_LABELS[line.pricingMethod]}</p>
                    <p className="font-black">
                      {total != null ? formatOMR(total) : "حدد الضيوف"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`حذف خدمة ${line.description}`}
                    onClick={() => onRemoveLine(line.clientKey)}
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
