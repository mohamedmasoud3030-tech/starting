import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { MoneyInput } from "@/components/MoneyInput";
import {
  ITEM_TYPE_LABELS,
  PRICING_METHOD_LABELS,
  UNIT_OPTIONS,
} from "@/lib/domain";
import type {
  CatalogItemType,
  PricingMethod,
} from "@/lib/dbTypes";
import type { CatalogCategoryRow } from "@/lib/dbTypes";
import { fromDbAmount } from "@/lib/money";
import { validateCatalogItem } from "./catalogForm";
import {
  type CatalogItemFormValues,
  type CatalogListItem,
  useCreateCatalogItem,
  useUpdateCatalogItem,
} from "./catalog.api";

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as CatalogItemType[];
const PRICING_METHODS = Object.keys(PRICING_METHOD_LABELS) as PricingMethod[];

export function CatalogItemDialog({
  open,
  onOpenChange,
  orgId,
  categories,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  categories: CatalogCategoryRow[];
  item: CatalogListItem | null; // null → create mode
}) {
  const isEditing = item !== null;
  const createMutation = useCreateCatalogItem(orgId);
  const updateMutation = useUpdateCatalogItem(orgId);

  const [values, setValues] = useState<CatalogItemFormValues>(() =>
    initialValues(item),
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateCatalogItem>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Increments on every open transition and target change, so money inputs
  // (keyed on this) remount and reseed even across cancel + reopen.
  const [session, setSession] = useState(0);

  // Reset the whole form on each dialog open transition and whenever the
  // target item changes while the dialog is open. This runs during render
  // (React's "adjust state during render" pattern) so there is no stale flash,
  // and it does NOT clobber typing while the dialog remains open.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevItem, setPrevItem] = useState(item);
  if (open !== prevOpen || item !== prevItem) {
    setPrevOpen(open);
    setPrevItem(item);
    if (open) {
      setSession((s) => s + 1);
      setValues(initialValues(item));
      setErrors({});
      setSubmitError(null);
    }
  }

  const set = <K extends keyof CatalogItemFormValues>(
    key: K,
    value: CatalogItemFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const nextErrors = validateCatalogItem(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      if (isEditing && item) {
        await updateMutation.mutateAsync({ id: item.id, values });
      } else {
        await createMutation.mutateAsync(values);
      }
      onOpenChange(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ",
      );
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "تعديل صنف" : "صنف جديد"}
      description="أدخل بيانات الصنف وأسعاره"
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="الاسم (عربي)" htmlFor="ci-name" required error={errors.name}>
            <Input
              id="ci-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="مثال: قهوة عمانية"
            />
          </Field>
          <Field label="الاسم (إنجليزي — اختياري)" htmlFor="ci-name-en">
            <Input
              id="ci-name-en"
              dir="ltr"
              value={values.nameEn}
              onChange={(e) => set("nameEn", e.target.value)}
              placeholder="Omani coffee"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="النوع" htmlFor="ci-type" required>
            <Select
              id="ci-type"
              value={values.itemType}
              onChange={(e) => set("itemType", e.target.value as CatalogItemType)}
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="التصنيف" htmlFor="ci-category">
            <Select
              id="ci-category"
              value={values.categoryId ?? ""}
              onChange={(e) => set("categoryId", e.target.value || null)}
            >
              <option value="">بدون تصنيف</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="طريقة التسعير" htmlFor="ci-pricing" required>
            <Select
              id="ci-pricing"
              value={values.pricingMethod}
              onChange={(e) =>
                set("pricingMethod", e.target.value as PricingMethod)
              }
            >
              {PRICING_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PRICING_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الوحدة" htmlFor="ci-unit">
            <Input
              id="ci-unit"
              list="unit-options"
              value={values.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="مثال: ضيف"
            />
            <datalist id="unit-options">
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MoneyInput
            key={`cost-${item?.id ?? "new"}-${session}`}
            id="ci-cost"
            label="سعر التكلفة (لك)"
            value={values.costPrice}
            onChange={(v) => set("costPrice", v ?? Number.NaN)}
            error={errors.costPrice}
            hint="ما تدفعه أنت مقابل هذا الصنف"
          />
          <MoneyInput
            key={`selling-${item?.id ?? "new"}-${session}`}
            id="ci-selling"
            label="سعر البيع (للعميل)"
            value={values.sellingPrice}
            onChange={(v) => set("sellingPrice", v ?? Number.NaN)}
            error={errors.sellingPrice}
            hint="ما يدفعه العميل"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="الرمز (اختياري)" htmlFor="ci-code">
            <Input
              id="ci-code"
              dir="ltr"
              value={values.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="e.g. COFFEE-01"
            />
          </Field>
          <Field label="الحالة" htmlFor="ci-status">
            <Select
              id="ci-status"
              value={values.status}
              onChange={(e) =>
                set("status", e.target.value as "ACTIVE" | "INACTIVE")
              }
            >
              <option value="ACTIVE">نشط</option>
              <option value="INACTIVE">غير نشط</option>
            </Select>
          </Field>
        </div>

        <Field label="الوصف (اختياري)" htmlFor="ci-desc">
          <Textarea
            id="ci-desc"
            rows={2}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        {submitError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-700"
          >
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function initialValues(item: CatalogListItem | null): CatalogItemFormValues {
  if (!item) {
    return {
      name: "",
      nameEn: "",
      code: "",
      categoryId: null,
      itemType: "SERVICE",
      unit: "",
      pricingMethod: "FIXED",
      costPrice: 0,
      sellingPrice: 0,
      description: "",
      status: "ACTIVE",
    };
  }
  return {
    name: item.name,
    nameEn: item.name_en ?? "",
    code: item.code ?? "",
    categoryId: item.category_id,
    itemType: item.item_type,
    unit: item.unit ?? "",
    pricingMethod: item.pricing_method,
    costPrice: fromDbAmount(item.cost_price),
    sellingPrice: fromDbAmount(item.selling_price),
    description: item.description ?? "",
    status: item.status,
  };
}
