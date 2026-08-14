import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDbNumeric, type DbAmount } from "@/lib/money";
import type {
  CatalogCategoryRow,
  CatalogItemOperationalRow,
  CatalogItemInsert,
  CatalogItemRow,
  CatalogItemType,
  PricingMethod,
} from "@/lib/dbTypes";

export interface CatalogItemFormValues {
  name: string;
  nameEn: string;
  code: string;
  categoryId: string | null;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  costPrice: number; // integer milli-OMR
  sellingPrice: number; // integer milli-OMR
  description: string;
  status: "ACTIVE" | "INACTIVE";
}

/**
 * A catalog item as read by the UI. Sensitive commercial fields
 * (cost_price / internal_notes) are present only when the caller is a
 * cost-reading role (OWNER/MANAGER/ACCOUNTANT); otherwise they are null and
 * the row was fetched from the operational projection (catalog_items_operational).
 *
 * `cost_price` keeps the database transport type (`DbAmount`) and is widened
 * to `| null` for the operational projection. It is never used for arithmetic
 * directly: callers normalize it through `fromDbAmount` into exact milli-OMR.
 */
export type CatalogListItem = Omit<
  CatalogItemRow,
  "cost_price" | "internal_notes"
> & {
  cost_price: DbAmount;
  internal_notes: string | null;
};

/**
 * Narrow a nullable operational-view row into a `CatalogListItem`.
 *
 * PostgreSQL cannot prove nullability for view columns, so `supabase gen
 * types` types every column of `catalog_items_operational` as nullable even
 * though the underlying `catalog_items` columns are NOT NULL. Rather than
 * asserting that away with a cast, nullability is resolved explicitly:
 *
 *  - Identity and PRICING-critical columns are required. A row missing any of
 *    them is dropped (hence `flatMap`) rather than reaching the UI as a broken
 *    record — in particular a missing `selling_price` must never render as a
 *    free item.
 *  - Presentation metadata (`sort_order`) and timestamps are non-semantic for
 *    this list, so they fall back to benign defaults instead of hiding an
 *    otherwise valid catalog item from the pricing screens.
 *
 * `cost_price`/`internal_notes` are forced to null: this projection exists
 * precisely so non-cost-reading roles never receive them.
 */
export function fromOperationalRow(
  row: CatalogItemOperationalRow,
): CatalogListItem[] {
  const {
    id,
    organization_id,
    name,
    item_type,
    pricing_method,
    status,
    unit,
    selling_price,
  } = row;

  if (
    id == null ||
    organization_id == null ||
    name == null ||
    item_type == null ||
    pricing_method == null ||
    status == null ||
    unit == null ||
    selling_price == null
  ) {
    return [];
  }

  return [
    {
      id,
      organization_id,
      name,
      item_type,
      pricing_method,
      status,
      unit,
      selling_price,
      sort_order: row.sort_order ?? 0,
      created_at: row.created_at ?? "",
      updated_at: row.updated_at ?? "",
      category_id: row.category_id,
      code: row.code,
      name_en: row.name_en,
      description: row.description,
      cost_price: null,
      internal_notes: null,
    },
  ];
}

function toInsert(
  orgId: string,
  values: CatalogItemFormValues,
): CatalogItemInsert {
  return {
    organization_id: orgId,
    name: values.name.trim(),
    name_en: values.nameEn.trim() || null,
    code: values.code.trim() || null,
    category_id: values.categoryId,
    item_type: values.itemType,
    unit: values.unit,
    pricing_method: values.pricingMethod,
    cost_price: toDbNumeric(values.costPrice),
    selling_price: toDbNumeric(values.sellingPrice),
    description: values.description.trim() || null,
    status: values.status,
  };
}

export function useCatalogCategories(orgId: string | null) {
  return useQuery({
    queryKey: ["catalog-categories", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [] as CatalogCategoryRow[];
      const { data, error } = await supabase
        .from("catalog_categories")
        .select("*")
        .eq("organization_id", orgId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogCategoryRow[];
    },
  });
}

export function useCatalogItems(orgId: string | null, includeCost = false) {
  return useQuery({
    queryKey: ["catalog-items", orgId, includeCost],
    enabled: !!orgId,
    queryFn: async (): Promise<CatalogListItem[]> => {
      if (!orgId) return [];
      if (includeCost) {
        // Cost-reading roles read the base table (includes cost_price/internal_notes).
        const { data, error } = await supabase
          .from("catalog_items")
          .select("*")
          .eq("organization_id", orgId)
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
      // Operational roles read the non-sensitive projection only.
      const { data, error } = await supabase
        .from("catalog_items_operational")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).flatMap(fromOperationalRow);
    },
  });
}

export function useCreateCatalogItem(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CatalogItemFormValues) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const { data, error } = await supabase
        .from("catalog_items")
        .insert(toInsert(orgId, values))
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-items", orgId] });
    },
  });
}

export function useUpdateCatalogItem(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: CatalogItemFormValues;
    }) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const { data, error } = await supabase
        .from("catalog_items")
        .update(toInsert(orgId, values))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-items", orgId] });
    },
  });
}

export function useToggleCatalogItem(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }) => {
      const { error } = await supabase
        .from("catalog_items")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-items", orgId] });
    },
  });
}
