import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { clampPage, pageRange, totalPagesFor, usePagedList } from "@/lib/pagination";
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

/** Paginated customers list for the Customers screen (D21): real 0-based pages. */
export function useCustomersPage(orgId: string | null, pageSize = 50) {
  const { page, setPage } = usePagedList(orgId);
  const query = useQuery({
    queryKey: ["customers-page", orgId, page, pageSize],
    enabled: !!orgId,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<CustomerList> => {
      const [from, to] = pageRange(page, pageSize);
      const { data, error, count } = await supabase
        .from("customers")
        .select("*", { count: "exact" })
        .eq("organization_id", orgId!)
        .order("name", { ascending: true })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as CustomerRow[], total: count ?? null };
    },
  });
  const totalPages = totalPagesFor(query.data?.total ?? null, pageSize);
  const goToPage = (next: number) => setPage(clampPage(next, totalPages));
  return {
    ...query,
    page,
    pageSize,
    totalPages,
    hasPreviousPage: page > 0,
    hasNextPage: totalPages == null ? false : page + 1 < totalPages,
    goToPage,
    nextPage: () => goToPage(page + 1),
    previousPage: () => goToPage(page - 1),
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
