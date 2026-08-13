import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CustomerRow, CustomerType } from "@/lib/database.types";

export interface CustomerFormValues {
  name: string;
  phone: string;
  whatsapp: string;
  customerType: CustomerType;
  notes: string;
}

export function useCustomers(orgId: string | null) {
  return useQuery({
    queryKey: ["customers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [] as CustomerRow[];
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
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
    },
  });
}
