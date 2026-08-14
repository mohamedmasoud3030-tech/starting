-- ============================================================================
-- 0003 — Organizations, Profiles, Memberships + authorization helpers
-- Multi-tenant foundation. All business data is scoped by organization_id.
--
-- Authorization helper functions are created here (after the tables they
-- reference) so PostgreSQL function-body validation passes during replay.
-- All helpers are SECURITY DEFINER with a pinned empty search_path and fully
-- qualified object references, and they verify BOTH membership activity AND
-- organization activity (an inactive organization blocks access even when a
-- membership row remains ACTIVE — see 04-security-and-tenancy.md).
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
-- Membership — explicit link between auth user and organization.
-- One membership row = one role per organization.
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

-- ---------------------------------------------------------------------------
-- is_org_member — ACTIVE membership in an ACTIVE organization.
-- An inactive organization blocks access entirely (no reads, no writes).
-- Recovery is performed by reactivating the organization (documented).
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
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and o.is_active = true
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- has_org_role — ACTIVE membership with one of the given roles, in an ACTIVE org.
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
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and o.is_active = true
      and m.role = any (p_roles)
  );
$$;

revoke all on function public.has_org_role(uuid, app_role[]) from public;
grant execute on function public.has_org_role(uuid, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- can_manage_commercial — may CHANGE commercial configuration (OWNER/MANAGER).
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_commercial(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]);
$$;

revoke all on function public.can_manage_commercial(uuid) from public;
grant execute on function public.can_manage_commercial(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- can_read_cost — may READ sensitive commercial cost data (cost_price /
-- internal_notes). OWNER, MANAGER (full commercial) and ACCOUNTANT (financial
-- cost visibility). Read-only; does not imply write.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_cost(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(
    p_org_id,
    array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role]
  );
$$;

revoke all on function public.can_read_cost(uuid) from public;
grant execute on function public.can_read_cost(uuid) to authenticated;
