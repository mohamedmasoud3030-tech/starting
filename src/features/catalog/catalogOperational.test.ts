import { describe, expect, it } from "vitest";
import { fromOperationalRow } from "./catalog.api";
import { fromDbAmount } from "@/lib/money";
import type { CatalogItemOperationalRow } from "@/lib/dbTypes";

/**
 * `catalog_items_operational` is the non-sensitive projection read by roles
 * that may NOT see cost. Because PostgreSQL cannot prove nullability for view
 * columns, every generated column type is nullable; these tests pin how that
 * nullability is resolved at the boundary.
 */

const row: CatalogItemOperationalRow = {
  id: "c1",
  organization_id: "org",
  category_id: null,
  code: null,
  name: "قهوة",
  name_en: null,
  description: null,
  item_type: "SERVICE",
  unit: "ضيف",
  pricing_method: "PER_GUEST",
  selling_price: 2.8,
  sort_order: null,
  status: "ACTIVE",
  created_at: null,
  updated_at: null,
};

describe("catalog operational projection normalization", () => {
  it("never exposes cost or internal notes to operational roles", () => {
    const items = fromOperationalRow(row);
    expect(items).toHaveLength(1);
    expect(items[0]!.cost_price).toBeNull();
    expect(items[0]!.internal_notes).toBeNull();
  });

  it("preserves the exact selling price through milli-OMR normalization", () => {
    const items = fromOperationalRow(row);
    expect(fromDbAmount(items[0]!.selling_price)).toBe(2800);
  });

  it("keeps rows whose non-semantic metadata is absent", () => {
    // sort_order/timestamps are presentation-only; a valid, priceable catalog
    // item must not disappear from the pricing screens because of them.
    expect(fromOperationalRow(row)).toHaveLength(1);
    expect(fromOperationalRow(row)[0]!.sort_order).toBe(0);
  });

  it("drops rows missing a price rather than rendering them as free", () => {
    expect(fromOperationalRow({ ...row, selling_price: null })).toHaveLength(0);
  });

  it("drops rows missing identity or pricing-critical columns", () => {
    for (const key of [
      "id",
      "organization_id",
      "name",
      "item_type",
      "pricing_method",
      "status",
      "unit",
    ] as const) {
      expect(fromOperationalRow({ ...row, [key]: null })).toHaveLength(0);
    }
  });
});
