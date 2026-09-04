import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Query key for the caller's effective capability set in an organization. */
export function capabilitiesQueryKey(orgId: string | null) {
  return ["my-capabilities", orgId] as const;
}

/**
 * The caller's EFFECTIVE capabilities in the given organization, computed
 * server-side by `my_capabilities` (role preset + owner overrides +
 * organization-active check) — the single report the UI mirrors.
 *
 * Returns `undefined` while loading (callers keep their role-derived
 * fallback) and `null` on refusal (not a member / org inactive). The query
 * cache is tenant-keyed: the identity switch already drops it.
 */
export function useMyCapabilities(orgId: string | null) {
  return useQuery({
    queryKey: capabilitiesQueryKey(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_capabilities", {
        p_org_id: orgId!,
      });
      if (error) throw error;
      const report = (data ?? {}) as Record<string, boolean>;
      return new Set(
        Object.entries(report)
          .filter(([, allowed]) => allowed)
          .map(([capability]) => capability),
      );
    },
  });
}
