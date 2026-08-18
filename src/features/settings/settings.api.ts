import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FunctionArgs } from "@/lib/dbTypes";
import type { OrganizationSettingsRow } from "@/lib/dbTypes";
import { supabase } from "@/lib/supabase";

/** Query key for the current organization's settings row. */
export function settingsQueryKey(orgId: string | null) {
  return ["organization-settings", orgId] as const;
}

/**
 * The current organization's settings (identity, contact, legal, documents).
 * A missing row is a legitimate "not configured yet" state (null), not an error.
 */
export function useOrganizationSettings(orgId: string | null) {
  return useQuery({
    queryKey: settingsQueryKey(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as OrganizationSettingsRow | null;
    },
  });
}

export type SaveSettingsInput = FunctionArgs<"save_organization_settings">;

/** Persists the full settings payload through the OWNER-only upsert command. */
export function useSaveOrganizationSettings(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveSettingsInput) => {
      const { data, error } = await supabase.rpc("save_organization_settings", input);
      if (error) throw error;
      return data as OrganizationSettingsRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey(orgId) });
    },
  });
}
