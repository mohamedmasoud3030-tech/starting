-- ============================================================================
-- 0003 — Organizations, Profiles, Memberships
-- Multi-tenant foundation. All business data is scoped by organization_id.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text,
  default_currency text not null default 'OMR',
  timezone text not null default 'Asia/Muscat',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles — identity is separate from membership.
-- One row per auth.users row; owned by Supabase Auth.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership — the explicit link between an auth user and an organization,
-- carrying the role model and lifecycle state.
-- ---------------------------------------------------------------------------
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'SUPERVISOR',
  status membership_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_memberships_org_user_unique unique (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id);

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user is created.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Authorization helper functions (used by RLS). SECURITY DEFINER, search_path
-- pinned empty, all objects fully qualified. Created here (after the tables
-- they reference) so function-body validation passes during replay.
-- ============================================================================

-- Is the calling user an ACTIVE member of the given organization?
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

-- Does the calling user hold one of the given roles in the organization?
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

-- Can the calling user manage commercial configuration in the organization?
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
