/**
 * Remembered active organization (account/tenant) for users who belong to
 * more than one independent organization.
 *
 * This is a UI convenience ONLY — never an authorization input. The stored id
 * is always re-validated against the user's real ACTIVE memberships before it
 * is used (see `selectCurrentMembership`), so a tampered value can at most
 * select an organization the user already belongs to, and otherwise falls back
 * to the deterministic default.
 */

const STORAGE_KEY = "hospitality.activeOrganizationId";

/** Reads the remembered organization id, tolerating unavailable storage. */
export function readStoredOrganizationId(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Private mode / disabled storage: fall back to the deterministic default.
    return null;
  }
}

/** Remembers the user's active organization. Best-effort. */
export function writeStoredOrganizationId(organizationId: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, organizationId);
  } catch {
    // Ignore: the selection still applies for this session.
  }
}
