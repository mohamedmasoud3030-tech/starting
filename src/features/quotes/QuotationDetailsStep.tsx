import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { DraftForm } from "./quotationDraft.model";

/**
 * Step 1 — "بيانات بسيطة": optional prospect/event fields. Pure
 * presentation; all state lives in the useQuotationDraft controller.
 */
export function QuotationDetailsStep({
  form,
  onFieldChange,
  guestCount,
  onGuestCountChange,
}: {
  form: DraftForm;
  onFieldChange: (key: keyof DraftForm, value: string) => void;
  guestCount: string;
  onGuestCountChange: (value: string) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-xl font-black">
        <span className="text-brand-700">١.</span> بيانات بسيطة
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        كل الحقول اختيارية عدا اسم العميل المتوقع.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم العميل / المتوقع *" htmlFor="qq-prospect-name">
          <Input
            id="qq-prospect-name"
            value={form.prospectName}
            onChange={(e) => onFieldChange("prospectName", e.target.value)}
            placeholder="مثال: محمد"
            required
          />
        </Field>
        <Field label="رقم الجوال" htmlFor="qq-prospect-phone">
          <Input
            id="qq-prospect-phone"
            value={form.prospectPhone}
            onChange={(e) => onFieldChange("prospectPhone", e.target.value)}
            inputMode="tel"
            dir="ltr"
          />
        </Field>
        <Field label="واتساب (إن اختلف)" htmlFor="qq-whatsapp">
          <Input
            id="qq-whatsapp"
            value={form.prospectWhatsapp}
            onChange={(e) => onFieldChange("prospectWhatsapp", e.target.value)}
            inputMode="tel"
            dir="ltr"
          />
        </Field>
        <Field label="اسم الشركة / الجهة (اختياري)" htmlFor="qq-company">
          <Input
            id="qq-company"
            value={form.prospectCompany}
            onChange={(e) => onFieldChange("prospectCompany", e.target.value)}
          />
        </Field>
        <Field label="اسم المناسبة (اختياري)" htmlFor="qq-event-title">
          <Input
            id="qq-event-title"
            value={form.eventTitle}
            onChange={(e) => onFieldChange("eventTitle", e.target.value)}
            placeholder="زفاف، مؤتمر…"
          />
        </Field>
        <Field label="تاريخ البداية (إن معروف)" htmlFor="qq-start">
          <Input
            id="qq-start"
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => onFieldChange("startAt", e.target.value)}
          />
        </Field>
        <Field label="تاريخ النهاية (إن معروف)" htmlFor="qq-end">
          <Input
            id="qq-end"
            type="datetime-local"
            value={form.endAt}
            onChange={(e) => onFieldChange("endAt", e.target.value)}
          />
        </Field>
        <Field label="الموقع / القاعة (إن معروف)" htmlFor="qq-venue">
          <Input
            id="qq-venue"
            value={form.venueName}
            onChange={(e) => onFieldChange("venueName", e.target.value)}
            placeholder="قاعة الريان"
          />
        </Field>
        <Field label="عدد الضيوف (إن معروف)" htmlFor="qq-guests">
          <Input
            id="qq-guests"
            type="number"
            min="1"
            value={guestCount}
            onChange={(e) => onGuestCountChange(e.target.value)}
            placeholder="120"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="qq-notes">
            <Textarea
              id="qq-notes"
              value={form.notes}
              onChange={(e) => onFieldChange("notes", e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}
