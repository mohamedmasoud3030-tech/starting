import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { identityKey, resetTenantCache } from "./tenantCache";
import type { AppRole, ProfileRow } from "@/lib/dbTypes";
import {
  canManageCommercialFor,
  canReadCostFor,
  canReadPayrollFor,
  canWriteCustomersFor,
  selectCurrentMembership,
} from "./authRoles";
import { useMyCapabilities } from "./capabilities.api";
import {
  readStoredOrganizationId,
  writeStoredOrganizationId,
} from "./organizationPreference";
import { AuthContext, type ActiveMembership, type AuthContextValue } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [memberships, setMemberships] = useState<ActiveMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(() => readStoredOrganizationId());

  const loadMemberships = useCallback(async (userId: string) => {
    const { data: membershipRows, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "ACTIVE");

    if (membershipError) throw membershipError;

    const active = membershipRows ?? [];
    if (active.length === 0) {
      setMemberships([]);
      return;
    }

    const orgIds = active.map((m) => m.organization_id);
    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("*")
      .in("id", orgIds)
      .eq("is_active", true);

    if (orgError) throw orgError;

    const orgMap = new Map((orgRows ?? []).map((o) => [o.id, o]));
    const result: ActiveMembership[] = active
      .map((m) => {
        const organization = orgMap.get(m.organization_id);
        return organization ? { membership: m, organization } : null;
      })
      .filter((x): x is ActiveMembership => x !== null);

    setMemberships(result);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw profileError;
    setProfile(data ?? null);
  }, []);

  const hydrate = useCallback(
    async (activeSession: Session | null) => {
      if (!activeSession?.user) {
        setUser(null);
        setSession(null);
        setProfile(null);
        setMemberships([]);
        return;
      }
      setUser(activeSession.user);
      setSession(activeSession);
      await Promise.all([
        loadProfile(activeSession.user.id),
        loadMemberships(activeSession.user.id),
      ]);
    },
    [loadProfile, loadMemberships],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      try {
        if (!isSupabaseConfigured) {
          setError(
            "النظام غير مهيأ بعد. يرجى ضبط إعدادات الاتصال في ملف البيئة (.env).",
          );
          setLoading(false);
          return;
        }

        const {
          data: { session: activeSession },
        } = await supabase.auth.getSession();
        if (!cancelled) await hydrate(activeSession);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      void (async () => {
        try {
          await hydrate(newSession);
        } catch (err) {
          setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
        } finally {
          setLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrate]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      if (!isSupabaseConfigured) {
        throw new Error(
          "النظام غير مهيأ بعد. يرجى ضبط إعدادات الاتصال في ملف البيئة (.env).",
        );
      }
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      await hydrate(data.session);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "تعذّر تسجيل الدخول";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setMemberships([]);
  }, []);

  /**
   * Active organization (independent tenant) for a user who belongs to more
   * than one organization.
   *
   * An explicit selection wins; otherwise the deterministic default (first
   * active membership by organization name) is used, so single-organization users
   * see no change at all. The selection is remembered per browser so a
   * user returns to the organization they were working in.
   */
  const current = useMemo(
    () => selectCurrentMembership(memberships, selectedOrganizationId),
    [memberships, selectedOrganizationId],
  );
  const currentMembership = current?.membership ?? null;
  const currentOrganization = current?.organization ?? null;

  const createOrganization = useCallback(
    async (name: string) => {
      if (!user) throw new Error("يجب تسجيل الدخول أولاً");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("اسم المنشأة مطلوب");
      const { data, error: rpcError } = await supabase.rpc(
        "create_organization",
        { p_name: trimmed },
      );
      if (rpcError) throw rpcError;
      if (!data) throw new Error("تعذّر إنشاء المنشأة");
      await loadMemberships(user.id);
    },
    [user, loadMemberships],
  );

  const switchOrganization = useCallback(
    (organizationId: string) => {
      // Ignore an organization the user is not actually a member of: the
      // active organization must always be backed by a real ACTIVE membership.
      const target = memberships.find(
        (m) => m.organization.id === organizationId,
      );
      if (!target) return;
      setSelectedOrganizationId(organizationId);
      writeStoredOrganizationId(organizationId);
    },
    [memberships],
  );

  /**
   * Tenant isolation at the cache layer: whenever the effective identity
   * changes (sign in, sign out, or an organization switch) every cached query
   * is dropped, so no rows fetched as the previous identity can be rendered.
   */
  const currentIdentity = identityKey(user?.id ?? null, currentOrganization?.id ?? null);
  const previousIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousIdentityRef.current === null) {
      previousIdentityRef.current = currentIdentity;
      return;
    }
    if (previousIdentityRef.current === currentIdentity) return;
    previousIdentityRef.current = currentIdentity;
    resetTenantCache(queryClient);
  }, [currentIdentity, queryClient]);
  const currentRole = useMemo<AppRole | null>(
    () => currentMembership?.role ?? null,
    [currentMembership],
  );

  // Delegated capabilities (0079): the server report is the single source
  // of truth the UI mirrors (role preset + owner overrides, computed by
  // has_permission server-side). Tenant-keyed, so the identity-switch cache
  // reset above keeps it isolated per organization.
  const capabilitiesQuery = useMyCapabilities(currentOrganization?.id ?? null);

  /**
   * UI affordance derivation: once the authoritative capability report is
   * loaded it decides; while it is still arriving the role preset is a
   * safe interim fallback (identical to the server default for members
   * without owner overrides). Hiding/enabling in the UI is NEVER the
   * security boundary — every mutation is enforced by RPC/RLS.
   */
  const effectiveCapabilities =
    capabilitiesQuery.isSuccess || capabilitiesQuery.isError
      ? capabilitiesQuery.data ?? null
      : null;

  const hasCapability = useCallback(
    (capability: string) => effectiveCapabilities?.has(capability) ?? false,
    [effectiveCapabilities],
  );

  const canManageCommercial =
    effectiveCapabilities !== null
      ? effectiveCapabilities.has("quotation.manage")
      : canManageCommercialFor(currentRole);
  const canIssueQuotation =
    effectiveCapabilities !== null
      ? effectiveCapabilities.has("quotation.issue")
      : canManageCommercialFor(currentRole);
  const canReadCost =
    effectiveCapabilities !== null
      ? effectiveCapabilities.has("cost.visibility")
      : canReadCostFor(currentRole);
  const canReadPayroll =
    effectiveCapabilities !== null
      ? effectiveCapabilities.has("payroll.read")
      : canReadPayrollFor(currentRole);
  const canWriteCustomers =
    effectiveCapabilities !== null
      ? effectiveCapabilities.has("customer.manage")
      : canWriteCustomersFor(currentRole);

  /**
   * Claim a single-use invitation into the current signed-in account. The
   * server verifies the invitation exists, is PENDING, and its email matches
   * the caller (no privileged user creation from the browser — the account
   * already exists via normal sign-up).
   */
  const claimInvitation = useCallback(
    async (code: string) => {
      if (!user) throw new Error("يجب تسجيل الدخول أولاً");
      const trimmed = code.trim();
      if (!trimmed) throw new Error("أدخل رمز الدعوة");
      const { data, error } = await supabase.rpc("claim_org_invitation", {
        p_code: trimmed,
      });
      if (error) throw new Error(claimErrorMessage(error));
      if (!data) throw new Error("تعذّر تفعيل الدعوة، حاول مجدداً");
      await loadMemberships(user.id);
    },
    [user, loadMemberships],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      memberships,
      currentOrganization,
      currentMembership,
      currentRole,
      capabilities: effectiveCapabilities,
      hasCapability,
      canManageCommercial,
      canIssueQuotation,
      canReadCost,
      canReadPayroll,
      canWriteCustomers,
      loading,
      error,
      login,
      logout,
      createOrganization,
      claimInvitation,
      switchOrganization,
    }),
    [
      user,
      session,
      profile,
      memberships,
      currentOrganization,
      currentMembership,
      currentRole,
      effectiveCapabilities,
      hasCapability,
      canManageCommercial,
      canIssueQuotation,
      canReadCost,
      canReadPayroll,
      canWriteCustomers,
      loading,
      error,
      login,
      logout,
      createOrganization,
      claimInvitation,
      switchOrganization,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Friendly Arabic mapping for the server's invitation claim rejections. */
function claimErrorMessage(error: { message: string }): string {
  switch (error.message) {
    case "NOT_AUTHENTICATED":
      return "يجب تسجيل الدخول أولاً";
    case "INVITATION_NOT_FOUND":
      return "رمز الدعوة غير صحيح أو لا يوجد";
    case "INVITATION_NOT_PENDING":
      return "تم استخدام هذه الدعوة أو إلغاؤها";
    case "INVITATION_EMAIL_MISMATCH":
      return "البريد الإلكتروني المسجّل لا يطابق بريد الدعوة";
    case "ALREADY_ORG_MEMBER":
      return "أنت بالفعل عضو في هذه المنشأة";
    case "ORG_NOT_ACTIVE":
      return "المنشأة غير نشطة";
    default:
      return "تعذّر تفعيل الدعوة";
  }
}
