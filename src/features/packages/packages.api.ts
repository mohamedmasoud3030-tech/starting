import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDbAmount } from "@/lib/money";
import type {
  PackageItemRow,
  PackageRow,
  PackageStatus,
} from "@/lib/database.types";

export interface PackageLineInput {
  catalogItemId: string;
  quantity: number; // integer milli-quantity (3 decimals)
}

export interface PackageFormValues {
  name: string;
  nameEn: string;
  description: string;
  status: PackageStatus;
  baseGuestCount: number | null;
  lines: PackageLineInput[];
}

export interface PackageWithLines {
  package: PackageRow;
  lines: PackageItemRow[];
}

export function usePackages(orgId: string | null) {
  return useQuery({
    queryKey: ["packages", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<PackageWithLines[]> => {
      if (!orgId) return [];
      const [packagesRes, linesRes] = await Promise.all([
        supabase
          .from("packages")
          .select("*")
          .eq("organization_id", orgId)
          .order("name", { ascending: true }),
        supabase
          .from("package_items")
          .select("*")
          .eq("organization_id", orgId),
      ]);
      if (packagesRes.error) throw packagesRes.error;
      if (linesRes.error) throw linesRes.error;

      const lines = linesRes.data ?? [];
      return (packagesRes.data ?? []).map((pkg) => ({
        package: pkg,
        lines: lines.filter((l) => l.package_id === pkg.id),
      }));
    },
  });
}

export function useSavePackage(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      packageId,
      values,
    }: {
      packageId: string | null;
      values: PackageFormValues;
    }) => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const { data, error } = await supabase.rpc("save_package", {
        p_org_id: orgId,
        p_package_id: packageId,
        p_name: values.name,
        p_name_en: values.nameEn.trim() || null,
        p_description: values.description.trim() || null,
        p_status: values.status,
        p_base_guest_count: values.baseGuestCount,
        p_items: values.lines.map((l) => ({
          catalog_item_id: l.catalogItemId,
          quantity: toDbAmount(l.quantity),
        })),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["packages", orgId] });
    },
  });
}
