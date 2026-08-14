import type { AppRole } from "@/lib/database.types";
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
  organization: { name: string };
}

/**
 * Deterministically select the "current" organization: the first membership
 * ordered by organization name (Arabic collation). A multi-org switcher is
 * deferred; this keeps the selection stable and org-scoped.
 */
export function selectCurrentMembership<T extends MembershipLike>(
  memberships: T[],
): T | null {
  if (memberships.length === 0) return null;
  return (
    [...memberships].sort((a, b) =>
      a.organization.name.localeCompare(b.organization.name, "ar"),
    )[0] ?? null
  );
}
