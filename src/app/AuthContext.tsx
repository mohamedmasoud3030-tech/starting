import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { identityKey, resetTenantCache } from "./tenantCache";
import type { AppRole, ProfileRow } from "@/lib/dbTypes";
import {
  canManageCommercialFor,
  canReadCostFor,
  canWriteCustomersFor,
  selectCurrentMembership,
} from "./authRoles";
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

  // Authorization derives ONLY from the role inside the CURRENT organization.
  const canManageCommercial = canManageCommercialFor(currentRole);
  const canReadCost = canReadCostFor(currentRole);
  const canWriteCustomers = canWriteCustomersFor(currentRole);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      memberships,
      currentOrganization,
      currentMembership,
      currentRole,
      canManageCommercial,
      canReadCost,
      canWriteCustomers,
      loading,
      error,
      login,
      logout,
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
      canManageCommercial,
      canReadCost,
      canWriteCustomers,
      loading,
      error,
      login,
      logout,
      switchOrganization,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
