-- Self-serve onboarding (first-organization creation), forward-only.
--
-- Industry-standard account lifecycle: every signed-up user can create THEIR
-- OWN organization and becomes its OWNER. Without this, a new user lands in a
-- login loop with no way into the product (there is no membership-management
-- UI yet and no operator provisioning step). Migration 0056 had revoked this
-- grant while onboarding was "future work"; that work now ships with the
-- /signup page and the first-login "أنشئ منشأتك" screen.
--
-- Security posture is unchanged for everyone else:
--   * `anon` (anonymous visitors) still holds NO grants at all (0059).
--   * The new user only ever owns the organization THEY create — RLS derives
--     access from their membership, and cross-organization access remains
--     impossible (composite FKs + RLS).
--   * `create_organization` itself still checks `auth.uid()` and inserts the
--     caller as OWNER.
--
-- Reversible by a later migration re-revoking the grant. No data touched.

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

comment on function public.create_organization(text, text) is
  'Self-serve first-organization onboarding: the authenticated caller becomes OWNER of the organization they create (migration 0061).';
