import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole } from "@/lib/dbTypes";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Organization members (team surface)
// ---------------------------------------------------------------------------

export interface OrgMember {
  userId: string;
  role: AppRole;
  fullName: string | null;
}

export function orgMembersQueryKey(orgId: string | null) {
  return ["org-members", orgId] as const;
}

/**
 * The organization's ACTIVE members with their display names. Readable by
 * any org member (RLS `memberships_select_org_member`); names come from
 * profiles (own-row + member-visible via profiles RLS).
 */
export function useOrgMembers(orgId: string | null) {
  return useQuery({
    queryKey: orgMembersQueryKey(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_memberships")
        .select("user_id, role")
        .eq("organization_id", orgId!)
        .eq("status", "ACTIVE")
        .order("role");
      if (error) throw error;
      const rows = data ?? [];
      const userIds = rows.map((r) => r.user_id);
      let names = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profilesError) throw profilesError;
        names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
      }
      return rows.map((r) => ({
        userId: r.user_id,
        role: r.role as AppRole,
        fullName: names.get(r.user_id) ?? null,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Per-member effective capability report (OWNER-only RPC)
// ---------------------------------------------------------------------------

export interface MemberCapabilityRow {
  capability: string;
  allowed: boolean;
  source: string;
}

export function memberCapabilitiesQueryKey(
  orgId: string | null,
  userId: string | null,
) {
  return ["member-capabilities", orgId, userId] as const;
}

/**
 * `member_capability_list`: the member's effective capabilities with their
 * source (role preset vs owner override). OWNER-only server-side.
 */
export function useMemberCapabilities(
  orgId: string | null,
  userId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: memberCapabilitiesQueryKey(orgId, userId),
    enabled: !!orgId && !!userId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("member_capability_list", {
        p_org_id: orgId!,
        p_user_id: userId!,
      });
      if (error) throw error;
      return (data ?? []) as MemberCapabilityRow[];
    },
  });
}

function invalidateCapabilityReports(
  qc: ReturnType<typeof useQueryClient>,
  orgId: string | null,
) {
  void qc.invalidateQueries({ queryKey: ["member-capabilities", orgId] });
  // The owner's own report can change if they manage themselves is blocked,
  // but re-validating keeps the UI consistent either way.
  void qc.invalidateQueries({ queryKey: ["my-capabilities", orgId] });
}

/** OWNER-only: grant (allowed=true) or deny (allowed=false) a capability. */
export function useSetMemberPermission(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      capability: string;
      allowed: boolean;
    }) => {
      const { data, error } = await supabase.rpc("set_member_permission", {
        p_org_id: orgId!,
        p_user_id: input.userId,
        p_capability: input.capability,
        p_allowed: input.allowed,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateCapabilityReports(qc, orgId);
      void qc.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) });
    },
  });
}

/** OWNER-only: remove an owner override, restoring the role preset. */
export function useClearMemberPermission(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; capability: string }) => {
      const { data, error } = await supabase.rpc("clear_member_permission", {
        p_org_id: orgId!,
        p_user_id: input.userId,
        p_capability: input.capability,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateCapabilityReports(qc, orgId);
      void qc.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Invitations (OWNER-only surface; codes are never listed for non-owners)
// ---------------------------------------------------------------------------

export interface OrgInvitation {
  id: string;
  email: string;
  role: AppRole;
  code: string;
  status: string;
  createdAt: string;
}

export function orgInvitationsQueryKey(orgId: string | null) {
  return ["org-invitations", orgId] as const;
}

/** PENDING invitations for the organization (OWNER sees them via RLS). */
export function useOrgInvitations(orgId: string | null) {
  return useQuery({
    queryKey: orgInvitationsQueryKey(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_invitations")
        .select("id, email, role, code, status, created_at")
        .eq("organization_id", orgId!)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role as AppRole,
        code: r.code,
        status: r.status,
        createdAt: r.created_at,
      }));
    },
  });
}

/**
 * OWNER-only: create a single-use invitation for the exact email. The code
 * is returned ONCE and shared out-of-band; the invitee signs up with that
 * email and claims it — no privileged user creation from the browser.
 */
export function useCreateOrgInvitation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: AppRole }) => {
      const { data, error } = await supabase.rpc("create_org_invitation", {
        p_org_id: orgId!,
        p_email: input.email,
        p_role: input.role,
      });
      if (error) throw error;
      if (!data) throw new Error("تعذّر إنشاء الدعوة");
      return data as { code: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgInvitationsQueryKey(orgId) });
    },
  });
}

/** OWNER-only: revoke a PENDING invitation (irreversible, audited). */
export function useRevokeOrgInvitation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { data, error } = await supabase.rpc("revoke_org_invitation", {
        p_org_id: orgId!,
        p_invitation_id: invitationId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgInvitationsQueryKey(orgId) });
    },
  });
}
