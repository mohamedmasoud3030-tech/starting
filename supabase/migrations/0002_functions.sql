-- ============================================================================
-- 0002 — Helper functions (authorization + triggers)
-- These are SECURITY DEFINER functions used by RLS policies. search_path is
-- pinned to empty so they cannot be hijacked; every object is fully qualified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Is the calling user an ACTIVE member of the given organization?
-- ---------------------------------------------------------------------------
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
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Does the calling user hold one of the given roles in the organization?
-- ---------------------------------------------------------------------------
create or replace function public.has_org_role(p_org_id uuid, p_roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.role = any (p_roles)
  );
$$;

revoke all on function public.has_org_role(uuid, app_role[]) from public;
grant execute on function public.has_org_role(uuid, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Can the calling user manage commercial configuration in the organization?
-- (OWNER and MANAGER only)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_commercial(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org_id, array['OWNER'::app_role, 'MANAGER'::app_role]);
$$;

revoke all on function public.can_manage_commercial(uuid) from public;
grant execute on function public.can_manage_commercial(uuid) to authenticated;
