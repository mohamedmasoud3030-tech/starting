import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type {
  AppRole,
  MembershipRow,
  OrganizationRow,
  ProfileRow,
} from "@/lib/dbTypes";

export interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

export interface AuthContextValue {
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

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
