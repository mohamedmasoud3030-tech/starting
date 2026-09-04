import type { AppRole } from "@/lib/dbTypes";
import {
  COMMERCIAL_ROLES,
  COST_READER_ROLES,
  CUSTOMER_WRITE_ROLES,
  STAFF_ASSIGN_ROLES,
  PAYROLL_READ_ROLES,
} from "@/lib/domain";

/**
 * LOADING-ONLY fallbacks for the delegated capability model (0079).
 *
 * The authoritative gate is the server-computed capability set
 * (`my_capabilities` = role preset + owner overrides), which AuthContext
 * exposes as `capabilities` / `hasCapability`. These role-preset predicates
 * mirror the server's `role_default_capability` and are used ONLY while that
 * report is still arriving, so the UI never blanks out on first paint. They
 * match the server exactly for members without owner overrides. The
 * database remains the security boundary in every case.
 */
export function canManageCommercialFor(role: AppRole | null): boolean {
  return role !== null && COMMERCIAL_ROLES.includes(role);
}

export function canReadCostFor(role: AppRole | null): boolean {
  return role !== null && COST_READER_ROLES.includes(role);
}

/** Loading-only fallback for the `payroll.read` capability (0079). */
export function canReadPayrollFor(role: AppRole | null): boolean {
  return role !== null && PAYROLL_READ_ROLES.includes(role);
}

export function canWriteCustomersFor(role: AppRole | null): boolean {
  return role !== null && CUSTOMER_WRITE_ROLES.includes(role);
}

/**
 * Assign / release event staff. Intentionally ROLE-based (not capability):
 * the RPCs gate on `has_org_role(OWNER, MANAGER, SUPERVISOR)` and 0079 left
 * it that way, so a capability would drift from the server for overridden members.
 */
export function canAssignStaffFor(role: AppRole | null): boolean {
  return role !== null && STAFF_ASSIGN_ROLES.includes(role);
}

export interface MembershipLike {
  membership: { role: AppRole };
  organization: { id?: string; name: string };
}

/**
 * Select the organization the user is currently operating within.
 *
 * A user may belong to several independent organizations (tenants) and so
 * hold several ACTIVE memberships. When one is
 * explicitly selected it wins — but ONLY if it corresponds to a real ACTIVE
 * membership in the supplied list, so a stale or tampered preference can never
 * widen access. Otherwise the historical deterministic default applies: the
 * first membership ordered by organization name (Arabic collation).
 *
 * Authorization is unchanged: the role always comes from the membership INSIDE
 * the selected organization, and the database remains authoritative via RLS.
 */
export function selectCurrentMembership<T extends MembershipLike>(
  memberships: T[],
  selectedOrganizationId?: string | null,
): T | null {
  if (memberships.length === 0) return null;

  if (selectedOrganizationId) {
    const selected = memberships.find(
      (m) => m.organization.id === selectedOrganizationId,
    );
    if (selected) return selected;
  }

  return (
    [...memberships].sort((a, b) =>
      a.organization.name.localeCompare(b.organization.name, "ar"),
    )[0] ?? null
  );
}
