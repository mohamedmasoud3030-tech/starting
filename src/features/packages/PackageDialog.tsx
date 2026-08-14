import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { parseOMR, toOMRString } from "@/lib/money";
import type { PackageStatus } from "@/lib/database.types";
import type { CatalogListItem } from "@/features/catalog/catalog.api";
import { parseBaseGuestCount, validatePackage } from "./packageForm";
import {
  type PackageFormValues,
  type PackageWithLines,
  useSavePackage,
} from "./packages.api";

interface LineDraft {
  key: number;
  catalogItemId: string;
  quantityText: string;
}

let lineKeyCounter = 0;
const nextLineKey = () => ++lineKeyCounter;

export function PackageDialog({
  open,
  onOpenChange,
  orgId,
  catalogItems,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  catalogItems: CatalogListItem[];
  target: PackageWithLines | null; // null → create
}) {
  const isEditing = target !== null;
  const saveMutation = useSavePackage(orgId);

  const [name, setName] = useState(target?.package.name ?? "");
  const [nameEn, setNameEn] = useState(target?.package.name_en ?? "");
  const [description, setDescription] = useState(target?.package.description ?? "");
  const [status, setStatus] = useState<PackageStatus>(target?.package.status ?? "ACTIVE");
  const [baseGuestCount, setBaseGuestCount] = useState(
    target?.package.base_guest_count?.toString() ?? "",
  );
  const [lines, setLines] = useState<LineDraft[]>(() =>
    target
      ? target.lines.map((l) => ({
          key: nextLineKey(),
          catalogItemId: l.catalog_item_id,
          quantityText: trimQuantity(toOMRString(parseOMR(l.quantity))),
        }))
      : [],
  );
  const [errors, setErrors] = useState<ReturnType<typeof validatePackage>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset the whole form on each dialog open transition and whenever the
  // target package changes while open (no clobbering while open).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevTarget, setPrevTarget] = useState(target);
  if (open !== prevOpen || target !== prevTarget) {
    setPrevOpen(open);
    setPrevTarget(target);
    if (open) {
      if (target) {
        setName(target.package.name);
        setNameEn(target.package.name_en ?? "");
        setDescription(target.package.description ?? "");
        setStatus(target.package.status);
        setBaseGuestCount(
          target.package.base_guest_count?.toString() ?? "",
        );
        setLines(
          target.lines.map((l) => ({
            key: nextLineKey(),
            catalogItemId: l.catalog_item_id,
            quantityText: trimQuantity(toOMRString(parseOMR(l.quantity))),
          })),
        );
      } else {
        setName("");
        setNameEn("");
        setDescription("");
        setStatus("ACTIVE");
        setBaseGuestCount("");
        setLines([]);
      }
      setErrors({});
      setSubmitError(null);
    }
  }

  const activeItems = catalogItems.filter((i) => i.status === "ACTIVE");

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { key: nextLineKey(), catalogItemId: "", quantityText: "1" },
    ]);

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  const removeLine = (key: number) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const guest = parseBaseGuestCount(baseGuestCount);

    const values: PackageFormValues = {
      name,
      nameEn,
      description,
      status,
      baseGuestCount: guest.value,
      lines: lines.map((l) => ({
        catalogItemId: l.catalogItemId,
        quantity: parseQuantitySafe(l.quantityText),
      })),
    };

    const nextErrors = validatePackage(values);
    if (guest.error) {
      nextErrors.baseGuestCount = guest.error;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      await saveMutation.mutateAsync({
        packageId: isEditing && target ? target.package.id : null,
        values,
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "تعديل باقة" : "باقة جديدة"}
      description="عرّف مكوّنات الباقة وكمياتها الافتراضية"
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="اسم الباقة (عربي)" htmlFor="pkg-name" required error={errors.name}>
            <Input
              id="pkg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: ضيافة قهوة — 100 ضيف"
            />
          </Field>
          <Field label="الاسم (إنجليزي — اختياري)" htmlFor="pkg-name-en">
            <Input
              id="pkg-name-en"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="عدد الضيوف المرجعي (اختياري)"
            htmlFor="pkg-guests"
            error={errors.baseGuestCount}
          >
            <Input
              id="pkg-guests"
              inputMode="numeric"
              value={baseGuestCount}
              onChange={(e) => setBaseGuestCount(e.target.value)}
              placeholder="100"
            />
          </Field>
          <Field label="الحالة" htmlFor="pkg-status">
            <Select
              id="pkg-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PackageStatus)}
            >
              <option value="ACTIVE">نشطة</option>
              <option value="INACTIVE">غير نشطة</option>
            </Select>
          </Field>
        </div>

        <Field label="الوصف (اختياري)" htmlFor="pkg-desc">
          <Textarea
            id="pkg-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800">مكوّنات الباقة</h3>
            <Button variant="secondary" size="sm" onClick={addLine}>
              <Plus className="h-4 w-4" />
              إضافة صنف
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-base text-slate-500">
              لم تُضف أي أصناف بعد
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 p-2"
                >
                  <Select
                    value={line.catalogItemId}
                    onChange={(e) =>
                      updateLine(line.key, { catalogItemId: e.target.value })
                    }
                    aria-label="الصنف"
                    className="flex-1"
                  >
                    <option value="">اختر صنفاً...</option>
                    {activeItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    inputMode="decimal"
                    dir="ltr"
                    aria-label="الكمية"
                    value={line.quantityText}
                    onChange={(e) =>
                      updateLine(line.key, { quantityText: e.target.value })
                    }
                    className="w-28 text-left"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label="حذف السطر"
                    className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.lines && (
            <p className="mt-2 text-sm font-semibold text-red-600">{errors.lines}</p>
          )}
        </div>

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
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Parse a quantity string to integer milli-units (3 decimals), or NaN. */
function parseQuantitySafe(text: string): number {
  if (text.trim() === "") return Number.NaN;
  try {
    return parseOMR(text);
  } catch {
    return Number.NaN;
  }
}

/** Strip trailing zeros from a 3-decimal string ("3.000" → "3"). */
function trimQuantity(value: string): string {
  return value.replace(/\.?0+$/, "");
}
