import type { CatalogItemFormValues } from "./catalog.api";

export type CatalogItemFormErrors = Partial<
  Record<"name" | "costPrice" | "sellingPrice", string>
>;

/**
 * Validate a catalog item form. Money fields are integer milli-OMR.
 * Returns a map of field → Arabic error message.
 */
export function validateCatalogItem(
  values: CatalogItemFormValues,
): CatalogItemFormErrors {
  const errors: CatalogItemFormErrors = {};
  if (!values.name.trim()) {
    errors.name = "الاسم مطلوب";
  }
  if (Number.isNaN(values.costPrice)) {
    errors.costPrice = "أدخل تكلفة صحيحة";
  } else if (values.costPrice < 0) {
    errors.costPrice = "التكلفة لا يمكن أن تكون سالبة";
  }
  if (Number.isNaN(values.sellingPrice)) {
    errors.sellingPrice = "أدخل سعر بيع صحيح";
  } else if (values.sellingPrice < 0) {
    errors.sellingPrice = "سعر البيع لا يمكن أن يكون سالباً";
  }
  return errors;
}
