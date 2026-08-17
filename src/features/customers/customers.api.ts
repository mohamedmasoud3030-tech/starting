import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CustomerRow, CustomerType } from "@/lib/dbTypes";

export interface CustomerFormValues {
  name: string;
  phone: string;
  whatsapp: string;
  customerType: CustomerType;
  notes: string;
}

export interface CustomerList {
  /** Rows on the current page (capped by PostgREST `max_rows`). */
  rows: CustomerRow[];
  /** Exact organization total, or null when the count is unavailable. */
  total: number | null;
}

export function useCustomers(orgId: string | null) {
  return useQuery({
    queryKey: ["customers", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<CustomerList> => {
      if (!orgId) return { rows: [], total: null };
      const { data, error, count } = await supabase
        .from("customers")
        .select("*", { count: "exact" })
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return { rows: (data ?? []) as CustomerRow[], total: count ?? null };
    },
  });
}

function toInsert(orgId: string, values: CustomerFormValues) {
  return {
    organization_id: orgId,
    name: values.name.trim(),
    phone: values.phone.trim() || null,
    whatsapp: values.whatsapp.trim() || null,
    customer_type: values.customerType,
    notes: values.notes.trim() || null,
  };
}

/** Paginated customers list for the Customers screen (D21-ext). */
export function useCustomersPage(orgId: string | null, pageSize = 50) {
  const [size, setSize] = useState(pageSize);
  const query = useQuery({
    queryKey: ["customers-page", orgId, size],
    enabled: !!orgId,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<CustomerList> => {
      const { data, error, count } = await supabase
        .from("customers")
        .select("*", { count: "exact" })
        .eq("organization_id", orgId!)
        .order("name", { ascending: true })
        .range(0, size - 1);
      if (error) throw error;
      return { rows: (data ?? []) as CustomerRow[], total: count ?? null };
    },
  });
  const loaded = query.data?.rows.length ?? 0;
  const total = query.data?.total ?? null;
  const hasMore = typeof total === "number" && loaded < total;
  return {
    ...query,
    hasMore,
    loadMore: () => setSize((current) => current + pageSize),
  };
}

export function useSaveCustomer(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string | null;
      values: CustomerFormValues;
    }) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      if (id) {
        const { error } = await supabase
          .from("customers")
          .update(toInsert(orgId, values))
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("customers")
          .insert(toInsert(orgId, values));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customers", orgId] });
      void qc.invalidateQueries({ queryKey: ["customers-page", orgId] });
    },
  });
}
