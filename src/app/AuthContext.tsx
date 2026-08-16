import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { AppRole, ProfileRow } from "@/lib/dbTypes";
import {
  canManageCommercialFor,
  canReadCostFor,
  canWriteCustomersFor,
  selectCurrentMembership,
} from "./authRoles";
import { PUBLIC_DEMO_MODE, PUBLIC_DEMO_ORG_ID } from "./publicDemo";
import { AuthContext, type ActiveMembership, type AuthContextValue } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [memberships, setMemberships] = useState<ActiveMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const loadPublicDemo = useCallback(async () => {
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", PUBLIC_DEMO_ORG_ID)
      .eq("is_active", true)
      .single();
    if (organizationError) throw organizationError;

    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("*")
      .eq("organization_id", PUBLIC_DEMO_ORG_ID)
      .eq("status", "ACTIVE")
      .eq("role", "OWNER")
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) throw new Error("تعذّر تحميل مؤسسة العرض العام");

    setUser(null);
    setSession(null);
    setProfile(null);
    setMemberships([{ membership, organization }]);
  }, []);

  const hydrate = useCallback(
    async (activeSession: Session | null) => {
      if (PUBLIC_DEMO_MODE) {
        await loadPublicDemo();
        return;
      }

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
    [loadProfile, loadMemberships, loadPublicDemo],
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

        if (PUBLIC_DEMO_MODE) {
          // Public demo deliberately carries no browser user/session. Clearing a
          // previously persisted session ensures every visitor uses the anon key.
          const {
            data: { session: persistedSession },
          } = await supabase.auth.getSession();
          if (persistedSession) await supabase.auth.signOut();
          if (!cancelled) await hydrate(null);
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
          await hydrate(PUBLIC_DEMO_MODE ? null : newSession);
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
      if (PUBLIC_DEMO_MODE) {
        await hydrate(null);
        return;
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
    if (PUBLIC_DEMO_MODE) {
      await hydrate(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setMemberships([]);
  }, [hydrate]);

  // Deterministic current organization = first active membership (by name).
  const current = useMemo(() => selectCurrentMembership(memberships), [memberships]);
  const currentMembership = current?.membership ?? null;
  const currentOrganization = current?.organization ?? null;
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
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

