import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { QuotationDiscountType } from "./quotes.api";
import type { DraftPricing } from "./quotationDraft.model";

/**
 * Transport, surcharges, discount and validity for a quotation draft.
 * Pure presentation: values and the setter come from useQuotationDraft.
 */
export function QuotationPricingStep({
  pricing,
  onChange,
}: {
  pricing: DraftPricing;
  onChange: <K extends keyof DraftPricing>(key: K, value: DraftPricing[K]) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-lg font-black">النقل والخصم والتسعير</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3">
          <input
            type="checkbox"
            checked={pricing.transportRequired}
            onChange={(e) => onChange("transportRequired", e.target.checked)}
            className="h-5 w-5"
          />
          <span className="font-bold">يوجد نقل</span>
        </label>

        {pricing.transportRequired && (
          <>
            <Field label="مبلغ النقل (ريال)" htmlFor="q-transport">
              <Input
                id="q-transport"
                dir="ltr"
                inputMode="decimal"
                placeholder="0.000"
                value={pricing.transportAmount}
                onChange={(e) => onChange("transportAmount", e.target.value)}
              />
            </Field>
            <Field label="نطاق النقل (مثال: داخل نزوى / خارج نزوى)" htmlFor="q-transport-zone">
              <Input
                id="q-transport-zone"
                value={pricing.transportZone}
                onChange={(e) => onChange("transportZone", e.target.value)}
                placeholder="داخل نزوى"
              />
            </Field>
            <Field label="ملاحظة النقل (اختياري)" htmlFor="q-transport-note">
              <Input
                id="q-transport-note"
                value={pricing.transportNote}
                onChange={(e) => onChange("transportNote", e.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="رسوم إضافية (ريال، اختياري)" htmlFor="q-surcharge">
          <Input
            id="q-surcharge"
            dir="ltr"
            inputMode="decimal"
            placeholder="0.000"
            value={pricing.surchargeAmount}
            onChange={(e) => onChange("surchargeAmount", e.target.value)}
          />
        </Field>
        <Field label="ملاحظة الرسوم الإضافية" htmlFor="q-surcharge-note">
          <Input
            id="q-surcharge-note"
            value={pricing.surchargeNote}
            onChange={(e) => onChange("surchargeNote", e.target.value)}
          />
        </Field>

        <Field label="نوع الخصم" htmlFor="q-discount-type">
          <Select
            id="q-discount-type"
            value={pricing.discountType}
            onChange={(e) => onChange("discountType", e.target.value as QuotationDiscountType)}
          >
            <option value="NONE">بدون خصم</option>
            <option value="FIXED">خصم بقيمة ثابتة</option>
            <option value="PERCENT">خصم بنسبة مئوية</option>
          </Select>
        </Field>

        {pricing.discountType !== "NONE" && (
          <Field
            label={pricing.discountType === "PERCENT" ? "نسبة الخصم (%)" : "قيمة الخصم (ريال)"}
            htmlFor="q-discount-value"
          >
            <Input
              id="q-discount-value"
              dir="ltr"
              inputMode="decimal"
              value={pricing.discountValue}
              onChange={(e) => onChange("discountValue", e.target.value)}
            />
          </Field>
        )}

        <Field label="صالح حتى (اختياري)" htmlFor="q-valid-until">
          <Input
            id="q-valid-until"
            type="datetime-local"
            value={pricing.validUntil}
            onChange={(e) => onChange("validUntil", e.target.value)}
          />
        </Field>
      </div>
    </Card>
  );
}
