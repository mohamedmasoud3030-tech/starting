-- Security hardening: align the schema with the documented authorization
-- posture for the organization-creation bootstrap.
--
-- `create_organization` is an onboarding bootstrap. No product surface calls
-- it from the browser, and the repository's security documentation
-- (docs/refactor/database-audit.md, section 7) records that it must not be
-- granted to the browser role, with future self-service onboarding going
-- through a server-side or explicitly restricted path.
--
-- The original migration 0009 kept the legacy grant to `authenticated`. This
-- migration removes it so the live schema matches the documented intent.
-- It is fully reversible: if self-service onboarding is ever product-approved,
-- a future migration must re-introduce access through that reviewed,
-- restricted path rather than a blanket grant.
--
-- No data is touched. The function itself, its owner (postgres), and its use
-- by migrations/triggers are unchanged.

revoke execute on function public.create_organization(text, text) from authenticated;
revoke execute on function public.create_organization(text, text) from anon;

comment on function public.create_organization(text, text) is
  'Onboarding bootstrap. Not executable by client roles; see migration 0056 and docs/refactor/database-audit.md.';
