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
  /**
   * The caller's EFFECTIVE capability set in the current organization,
   * computed server-side (`my_capabilities`): role preset + owner overrides.
   * `null` while the report is still loading (UI keeps its role-derived
   * fallback) or when the server refuses. This is the single source of
   * truth for every capability-based UI affordance; the database remains
   * the security boundary.
   */
  capabilities: Set<string> | null;
  /** Capability-based UI gate (see `capabilities`). */
  hasCapability: (capability: string) => boolean;
  /** OWNER or MANAGER within the CURRENT organization (capability-backed, role fallback while loading). */
  canManageCommercial: boolean;
  /**
   * quotation.issue — issue/accept/convert/reject/expire quotations. Distinct
   * from `canManageCommercial` (quotation.manage) per the 0079 RPC gates, even
   * though the role presets are identical today.
   */
  canIssueQuotation: boolean;
  /** cost.visibility within the CURRENT organization (capability-backed, role fallback while loading). */
  canReadCost: boolean;
  /** payroll.read within the CURRENT organization (capability-backed, role fallback while loading). */
  canReadPayroll: boolean;
  /** customer.manage within the CURRENT organization (capability-backed, role fallback while loading). */
  canWriteCustomers: boolean;
  /**
   * Claim a single-use organization invitation (migration 0079): the
   * invitation's email must match the signed-in user's email. On success the
   * provider reloads memberships and the application shell appears.
   */
  claimInvitation: (code: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Self-serve first-organization onboarding (migration 0061): creates the
   * organization and reloads the caller's memberships so they become its
   * OWNER immediately.
   */
  createOrganization: (name: string) => Promise<void>;
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
