import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDbAmount } from "@/lib/money";
import type {
  CatalogCategoryRow,
  CatalogItemInsert,
  CatalogItemRow,
  CatalogItemType,
  PricingMethod,
} from "@/lib/database.types";

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
    cost_price: toDbAmount(values.costPrice),
    selling_price: toDbAmount(values.sellingPrice),
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

export function useCatalogItems(orgId: string | null) {
  return useQuery({
    queryKey: ["catalog-items", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [] as CatalogItemRow[];
      const { data, error } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogItemRow[];
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
