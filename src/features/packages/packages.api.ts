import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDbAmount } from "@/lib/money";
import type {
  PackageItemRow,
  PackageRow,
  PackageStatus,
} from "@/lib/dbTypes";

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
        // `save_package(p_package_id uuid)` has NO SQL default, so the
        // generated Args type is a required `string`. "Create" mode is
        // expressed by passing SQL NULL, which the function tests with
        // `if p_package_id is null then ... insert`. `undefined` would omit
        // the argument entirely and fail to resolve the overload, so the
        // deliberate null is preserved and narrowed here.
        p_package_id: packageId as string,
        p_name: values.name,
        // The remaining parameters DO have SQL defaults, so the generated
        // Args type marks them optional (`?: string`) rather than nullable.
        // Omitting them (undefined) lets PostgreSQL apply its own `default
        // null`, which is exactly the previous behaviour — whereas sending an
        // explicit JSON null would be a type error.
        p_name_en: values.nameEn.trim() || undefined,
        p_description: values.description.trim() || undefined,
        p_status: values.status,
        p_base_guest_count: values.baseGuestCount ?? undefined,
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
