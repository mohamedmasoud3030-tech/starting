import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

/** Add a custom commercial line (service / staff / equipment / other). */
export function CommercialLineForm({
  submit,
}: {
  submit: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  function go(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void submit({
      p_line_id: null,
      p_description: String(f.get("description")),
      p_item_type: String(f.get("type")),
      p_unit: String(f.get("unit")),
      p_pricing_method: String(f.get("method")),
      p_quantity: String(f.get("quantity")),
      p_unit_selling_price: String(f.get("sell")),
      p_expected_unit_cost: String(f.get("cost")),
      p_notes: null,
    });
  }

  return (
    <Card>
      <h2 className="mb-3 font-black">إضافة خدمة مخصصة</h2>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={go}>
        <Field label="الوصف">
          <Input name="description" required />
        </Field>
        <Field label="النوع">
          <Select name="type">
            <option value="SERVICE">خدمة</option>
            <option value="STAFF">طاقم</option>
            <option value="REUSABLE_EQUIPMENT">معدات</option>
            <option value="OTHER">أخرى</option>
          </Select>
        </Field>
        <Field label="الوحدة">
          <Input name="unit" required />
        </Field>
        <Field label="طريقة التسعير">
          <Select name="method">
            <option value="PER_UNIT">لكل وحدة</option>
            <option value="FIXED">ثابت</option>
            <option value="PER_GUEST">لكل ضيف</option>
            <option value="PER_HOUR">لكل ساعة</option>
            <option value="PER_DAY">لكل يوم</option>
            <option value="MANUAL">يدوي</option>
          </Select>
        </Field>
        <Field label="الكمية">
          <Input name="quantity" type="number" min="0.001" step="0.001" required />
        </Field>
        <Field label="سعر البيع">
          <Input name="sell" type="number" min="0" step="0.001" required />
        </Field>
        <Field label="التكلفة المتوقعة">
          <Input name="cost" type="number" min="0" step="0.001" required />
        </Field>
        <div className="flex items-end">
          <Button type="submit">إضافة</Button>
        </div>
      </form>
    </Card>
  );
}
