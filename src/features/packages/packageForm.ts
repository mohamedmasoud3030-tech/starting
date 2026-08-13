import type { PackageFormValues } from "./packages.api";

export type PackageFormErrors = Partial<
  Record<"name" | "lines", string>
>;

export function validatePackage(values: PackageFormValues): PackageFormErrors {
  const errors: PackageFormErrors = {};
  if (!values.name.trim()) {
    errors.name = "الاسم مطلوب";
  }
  const invalid = values.lines.some(
    (l) => !l.catalogItemId || Number.isNaN(l.quantity) || l.quantity < 0,
  );
  if (invalid) {
    errors.lines = "تأكد من اختيار صنف لكل سطر وإدخال كمية صحيحة";
  }
  return errors;
}
