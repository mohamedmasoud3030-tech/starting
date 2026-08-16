-- ============================================================================
-- Phase 4 — production public-demo teardown
--
-- The temporary demo migrations intentionally made the PostgREST `anon` role
-- inherit `public_demo_admin`, which carries browser CRUD/read/RPC capability
-- for the named demo organization. Production now uses normal Supabase Auth by
-- default, so that inherited capability must not remain reachable merely
-- because the frontend demo flag is disabled.
--
-- This is deliberately a forward-only capability teardown. Historical demo
-- migrations are left intact for replay/auditability; the dedicated role is
-- retained but made inert so no object ownership/dependency rewrite is needed.
-- Authenticated application grants are untouched.
-- ============================================================================

revoke public_demo_admin from anon;

-- Defense in depth: even an accidental future membership grant must not revive
-- the old browser capability set. The role is nologin and becomes inert.
revoke all privileges on schema public from public_demo_admin;
revoke all privileges on all tables in schema public from public_demo_admin;
revoke all privileges on all sequences in schema public from public_demo_admin;
revoke all privileges on all functions in schema public from public_demo_admin;

comment on role public_demo_admin is
  'INERT legacy role retained only for migration history; production public demo access is disabled.';
