import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  AppRole,
  MembershipRow,
  OrganizationRow,
  ProfileRow,
} from "@/lib/dbTypes";
import {
  canManageCommercialFor,
  canReadCostFor,
  canWriteCustomersFor,
  selectCurrentMembership,
} from "./authRoles";

export interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  memberships: ActiveMembership[];
  /**
   * The organization the user is currently operating within. Deterministically
   * selected as the first ACTIVE membership (sorted by organization name).
   * A multi-org switcher is deferred; authorization is already org-scoped.
   */
  currentOrganization: OrganizationRow | null;
  currentMembership: MembershipRow | null;
  /** The single role the user holds INSIDE the current organization. */
  currentRole: AppRole | null;
  /** OWNER or MANAGER within the CURRENT organization only. */
  canManageCommercial: boolean;
  /** OWNER, MANAGER, or ACCOUNTANT within the CURRENT organization only. */
  canReadCost: boolean;
  /** OWNER, MANAGER, or SUPERVISOR within the CURRENT organization only. */
  canWriteCustomers: boolean;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

    init();

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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
