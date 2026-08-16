import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatOMR, parseOMR, parseQuantityMilli, type MilliOMR } from "@/lib/money";
import type { PricingMethod } from "@/lib/dbTypes";
import { computeQuotationLineTotalMilli } from "./quotationMath";

/**
 * Sidebar scratch calculator: lets the owner price a service before deciding.
 * Pure local presentation state; creates no records.
 */
export function ScratchCalculator({ guestCount }: { guestCount: number | null }) {
  const [method, setMethod] = useState<PricingMethod>("PER_UNIT");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");

  let result: MilliOMR | null = null;
  try {
    result = computeQuotationLineTotalMilli(
      method,
      parseOMR(price === "" ? "0" : price),
      parseQuantityMilli(qty === "" ? "1" : qty),
      guestCount,
    );
  } catch {
    result = null;
  }

  return (
    <div className="space-y-3">
      <Field label="طريقة الحساب" htmlFor="calc-method">
        <Select id="calc-method" value={method} onChange={(e) => setMethod(e.target.value as PricingMethod)}>
          <option value="PER_UNIT">لكل وحدة</option>
          <option value="PER_GUEST">لكل ضيف</option>
          <option value="FIXED">مبلغ ثابت</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="كمية الحساب" htmlFor="calc-qty">
          <Input id="calc-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="سعر الحساب (ر.ع.)" htmlFor="calc-price">
          <Input
            id="calc-price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.000"
          />
        </Field>
      </div>
      <div className="rounded-xl bg-brand-50 p-3 text-center">
        <p className="text-sm text-brand-800">النتيجة</p>
        <p className="text-2xl font-black text-brand-900">
          {method === "PER_GUEST" && guestCount === null
            ? "حدد عدد الضيوف"
            : result !== null
              ? formatOMR(result)
              : "—"}
        </p>
      </div>
    </div>
  );
}
