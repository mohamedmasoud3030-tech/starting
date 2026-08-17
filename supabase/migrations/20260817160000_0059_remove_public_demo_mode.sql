-- Remove the temporary public demo mode (defect D2), forward-only.
--
-- Industry best practice: no standing elevated grants for anonymous roles.
-- The demo period granted `anon` (via the inherited `public_demo_admin` role)
-- OWNER-equivalent table/function access whose only scope guard was the exact
-- demo organization NAME. That dormant surface is removed here:
--
--   1. `is_org_member` / `has_org_role` are restored to their canonical
--      membership-only definitions (no anonymous bypass branch).
--   2. The 0054 actor patch (`auth.uid()` → `app_private.effective_actor_id()`)
--      is reversed across every public function, symmetrically.
--   3. `public_demo_admin` is stripped of all privileges and dropped; its
--      inheritance by `anon` disappears with it. Any residual direct grants
--      on the two authorization helpers are revoked from `anon`.
--   4. The private helper schema `app_private` is dropped.
--
-- Authenticated authorization, RLS policies, and every command are unchanged
-- by this migration (identical semantics for non-anonymous callers). The
-- frontend demo flag (`VITE_PUBLIC_DEMO_MODE`) is removed in the same change
-- set; AGENTS.md forbids demo login paths permanently.
--
-- No data is touched. Re-enabling a demo would require a fresh, reviewed
-- migration rather than a role name remaining behind.

-- ===========================================================================
-- 1. Restore canonical authorization helpers (no anonymous bypass)
-- ===========================================================================
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and o.is_active = true
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and o.is_active = true
      and m.role = any (p_roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;

-- ===========================================================================
-- 2. Reverse the 0054 actor patch across every public function
-- ===========================================================================
do $restore_actor$
declare
  r record;
  v_definition text;
begin
  for r in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_catalog.pg_get_functiondef(p.oid) ilike '%app_private.effective_actor_id()%'
  loop
    v_definition := replace(
      pg_catalog.pg_get_functiondef(r.oid),
      'app_private.effective_actor_id()',
      'auth.uid()'
    );
    execute v_definition;
  end loop;
end;
$restore_actor$;

-- ===========================================================================
-- 3. Strip and drop the demo role, then drop the helper schema
-- ===========================================================================
drop owned by public_demo_admin;
drop role if exists public_demo_admin;

drop schema if exists app_private cascade;
