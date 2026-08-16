import type { AppRole } from "@/lib/dbTypes";
import {
  COMMERCIAL_ROLES,
  COST_READER_ROLES,
  CUSTOMER_WRITE_ROLES,
} from "@/lib/domain";

/**
 * Commercial configuration permission derives ONLY from the role the user
 * holds inside the CURRENTLY ACTIVE organization (never from roles in other
 * organizations).
 */
export function canManageCommercialFor(role: AppRole | null): boolean {
  return role !== null && COMMERCIAL_ROLES.includes(role);
}

export function canReadCostFor(role: AppRole | null): boolean {
  return role !== null && COST_READER_ROLES.includes(role);
}

export function canWriteCustomersFor(role: AppRole | null): boolean {
  return role !== null && CUSTOMER_WRITE_ROLES.includes(role);
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
