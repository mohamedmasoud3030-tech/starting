import { describe, expect, it } from "vitest";
import { validateCatalogItem } from "./catalogForm";
import type { CatalogItemFormValues } from "./catalog.api";

function baseValues(overrides: Partial<CatalogItemFormValues> = {}): CatalogItemFormValues {
  return {
    name: "قهوة عمانية",
    nameEn: "",
    code: "",
    categoryId: null,
    itemType: "SERVICE",
    unit: "ضيف",
    pricingMethod: "PER_GUEST",
    costPrice: 1200, // 1.200
    sellingPrice: 2500, // 2.500
    description: "",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("catalog item validation", () => {
  it("accepts a valid item", () => {
    expect(validateCatalogItem(baseValues())).toEqual({});
  });

  it("rejects an empty name", () => {
    const errors = validateCatalogItem(baseValues({ name: "   " }));
    expect(errors.name).toBeDefined();
  });

  it("rejects a negative cost price", () => {
    const errors = validateCatalogItem(baseValues({ costPrice: -1 }));
    expect(errors.costPrice).toBeDefined();
  });

  it("rejects a negative selling price", () => {
    const errors = validateCatalogItem(baseValues({ sellingPrice: -100 }));
    expect(errors.sellingPrice).toBeDefined();
  });

  it("rejects a NaN money value", () => {
    const errors = validateCatalogItem(baseValues({ sellingPrice: Number.NaN }));
    expect(errors.sellingPrice).toBeDefined();
  });

  it("allows zero cost and selling prices", () => {
    const errors = validateCatalogItem(baseValues({ costPrice: 0, sellingPrice: 0 }));
    expect(errors).toEqual({});
  });
});
