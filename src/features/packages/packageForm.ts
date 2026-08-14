import type { PackageFormValues } from "./packages.api";

export type PackageFormErrors = Partial<
  Record<"name" | "lines" | "baseGuestCount", string>
>;

/**
 * Validate a package template. `quantity` is integer milli-units (3 decimals)
 * and must be > 0. `baseGuestCount` (already parsed) must be a positive
 * integer when provided. Duplicate catalog items in one package are rejected
 * before hitting the unique constraint.
 */
export function validatePackage(values: PackageFormValues): PackageFormErrors {
  const errors: PackageFormErrors = {};

  if (!values.name.trim()) {
    errors.name = "الاسم مطلوب";
  }

  const seen = new Set<string>();
  for (const line of values.lines) {
    if (!line.catalogItemId) {
      errors.lines = "اختر صنفاً لكل سطر";
      break;
    }
    if (Number.isNaN(line.quantity) || line.quantity <= 0) {
      errors.lines = "الكمية يجب أن تكون أكبر من صفر";
      break;
    }
    if (seen.has(line.catalogItemId)) {
      errors.lines = "لا يمكن تكرار نفس الصنف في الباقة الواحدة";
      break;
    }
    seen.add(line.catalogItemId);
  }

  if (
    values.baseGuestCount != null &&
    (!Number.isInteger(values.baseGuestCount) || values.baseGuestCount <= 0)
  ) {
    errors.baseGuestCount = "عدد الضيوف يجب أن يكون رقماً صحيحاً أكبر من صفر";
  }

  return errors;
}

/**
 * Parse and validate the raw base-guest-count string. Returns the parsed
 * positive integer, or an Arabic error for malformed / non-positive input.
 */
export function parseBaseGuestCount(raw: string): {
  value: number | null;
  error?: string;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "عدد الضيوف يجب أن يكون رقماً صحيحاً" };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    return { value: null, error: "عدد الضيوف يجب أن يكون أكبر من صفر" };
  }
  return { value: n };
}
