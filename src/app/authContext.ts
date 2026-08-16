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
   * The organization the user is currently operating within. Defaults to the
   * first ACTIVE membership (sorted by organization name) and follows an
   * explicit selection made through `switchOrganization`.
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
  /**
   * Switch the active organization (account/tenant). Ignored unless the id matches one
   * of the user's ACTIVE memberships. Switching drops the whole query cache so
   * no rows from the previous organization can be rendered.
   */
  switchOrganization: (organizationId: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
