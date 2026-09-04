-- ============================================================================
-- 0079: Owner-delegated capabilities (per-member permission layer).
--
-- Product decision (binding): the primary app users are the owner/manager and
-- a small number of trusted assistants whose CAPABILITIES the owner configures.
-- app_role values stay as presets/default capability sets; this migration adds
-- an authoritative per-member override layer enforced at the PostgreSQL
-- boundary. The frontend only mirrors server decisions.
--
-- Capability model (20 capabilities):
--   customer.manage, quotation.manage, quotation.issue, event.manage,
--   catalog.manage, warehouse.dispatch, warehouse.reconcile, consumable.manage,
--   stock.adjust, attendance.record, procurement.manage, staff.manage,
--   payment.record, payment.void, invoice.manage, finance.manage,
--   cost.visibility, payroll.read, payroll.pay, settings.manage
--   settings.manage and user.manage (owner-only) are OWNER-exclusive.
--
-- Enforcement points:
--   * has_permission(org, cap) -> OWNER always true; else per-member override;
--     else role preset (role_default_capability). Unknown caps -> false.
--   * can_read_cost / can_manage_commercial are redefined as wrappers around
--     has_permission (cost.visibility / quotation.manage) so every existing
--     cost boundary and commercial command becomes override-aware unchanged.
--   * can_read_payroll (new) = has_permission(payroll.read).
--   * Operational RPC gates are re-pointed from has_org_role presets to
--     has_permission (below in this migration, `create or replace` blocks).
--   * Payroll read views are re-gated to can_read_payroll.
--
-- Security properties (pgTAP-verified in 008x test files):
--   * OWNER: full control, cannot be demoted/revoked (trigger), permissions
--     immutable.
--   * Non-owner can never self-grant: set/clear + invitation creation are
--     OWNER-only; org_member_permissions has NO client RLS policies.
--   * user.manage (member list + override management) is OWNER-only.
--   * Assistant provisioning is invitation/claim (code + exact email match);
--     no privileged Auth user creation from the browser.
--   * Cross-org access rejected at the boundary in every path.
-- ============================================================================

-- 1) The (org, user) uniqueness on organization_memberships already exists
--    (0003, organization_memberships_org_user_unique); the permission table
--    below uses it for its composite FK.

-- 2) OWNER membership is immutable: first owner insert allowed; an owner row
--    can never be demoted, deactivated, or a second owner created.
create or replace function public.protect_owner_membership()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT'
     and new.role = 'OWNER'::public.app_role
     and exists (select 1 from public.organization_memberships m
                 where m.organization_id = new.organization_id
                   and m.role = 'OWNER'::public.app_role
                   and m.status = 'ACTIVE')
  then
    raise exception 'ORGANIZATION_ALREADY_HAS_OWNER' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE'
     and old.role = 'OWNER'::public.app_role
     and (new.role is distinct from 'OWNER'::public.app_role
          or new.status is distinct from 'ACTIVE'::public.membership_status)
  then
    raise exception 'OWNER_MEMBERSHIP_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_memberships_protect_owner on public.organization_memberships;
create trigger organization_memberships_protect_owner
before insert or update on public.organization_memberships
for each row
execute function public.protect_owner_membership();

-- 3) Per-member capability overrides. No client RLS policies: the table is
--    invisible to direct table access; owner reads/writes only through the
--    security definer functions below (user.manage = OWNER-only).
create table public.org_member_permissions (
  organization_id uuid not null,
  user_id uuid not null,
  capability text not null check (
    capability in (
      'customer.manage', 'quotation.manage', 'quotation.issue',
      'event.manage', 'catalog.manage', 'warehouse.dispatch',
      'warehouse.reconcile', 'consumable.manage', 'stock.adjust',
      'attendance.record', 'procurement.manage', 'staff.manage',
      'payment.record', 'payment.void', 'invoice.manage', 'finance.manage',
      'cost.visibility', 'payroll.read', 'payroll.pay', 'settings.manage'
    )
  ),
  allowed boolean not null,
  set_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, capability),
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade
);

alter table public.org_member_permissions enable row level security;
-- intentionally no policies: authenticated/anon have no direct access.
revoke all on table public.org_member_permissions from public, anon, authenticated;
create trigger org_member_permissions_set_updated_at
before update on public.org_member_permissions
for each row
execute function public.set_updated_at();

-- 4) Role preset defaults (the existing role matrix, preserved).
create or replace function public.role_default_capability(
  p_role public.app_role,
  p_capability text
)
returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'customer.manage' then p_role in ('OWNER','MANAGER','SUPERVISOR')
    when 'quotation.manage' then p_role in ('OWNER','MANAGER')
    when 'quotation.issue' then p_role in ('OWNER','MANAGER')
    when 'event.manage' then p_role in ('OWNER','MANAGER','SUPERVISOR')
    when 'catalog.manage' then p_role in ('OWNER','MANAGER')
    when 'warehouse.dispatch' then p_role in ('OWNER','MANAGER','SUPERVISOR','WAREHOUSE')
    when 'warehouse.reconcile' then p_role in ('OWNER','MANAGER')
    when 'consumable.manage' then p_role in ('OWNER','MANAGER','SUPERVISOR','WAREHOUSE')
    when 'stock.adjust' then p_role in ('OWNER','MANAGER')
    when 'attendance.record' then p_role in ('OWNER','MANAGER','SUPERVISOR')
    when 'procurement.manage' then p_role in ('OWNER','MANAGER')
    when 'staff.manage' then p_role in ('OWNER','MANAGER')
    when 'payment.record' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'payment.void' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'invoice.manage' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'finance.manage' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'cost.visibility' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'payroll.read' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'payroll.pay' then p_role in ('OWNER','MANAGER','ACCOUNTANT')
    when 'settings.manage' then p_role = 'OWNER'
    else false
  end;
$$;

-- KEEP IN SYNC with the CHECK constraint on org_member_permissions.
create or replace function public.known_capabilities()
returns setof text
language sql
immutable
as $$
  select unnest(array[
    'customer.manage', 'quotation.manage', 'quotation.issue',
    'event.manage', 'catalog.manage', 'warehouse.dispatch',
    'warehouse.reconcile', 'consumable.manage', 'stock.adjust',
    'attendance.record', 'procurement.manage', 'staff.manage',
    'payment.record', 'payment.void', 'invoice.manage', 'finance.manage',
    'cost.visibility', 'payroll.read', 'payroll.pay', 'settings.manage'
  ]::text[]);
$$;

create or replace function public.is_known_capability(p_capability text)
returns boolean
language sql
immutable
as $$
  select p_capability in (select public.known_capabilities());
$$;

-- 5) The canonical boundary predicate.
--    OWNER -> always true. Otherwise: per-member override if present, else the
--    role preset. Unknown capability -> false (fail closed).
create or replace function public.has_permission(
  p_org_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Mirrors has_org_role semantics: an INACTIVE organization confers no
  -- capabilities, even to its OWNER (inactive orgs are frozen, not deletable).
  select
    exists (
      select 1
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = p_org_id
        and m.user_id = auth.uid()
        and m.status = 'ACTIVE'
        and o.is_active = true
        and m.role = 'OWNER'
    )
    or
    coalesce(
      (
        select op.allowed
        from public.org_member_permissions op
        join public.organization_memberships m
          on m.organization_id = op.organization_id and m.user_id = op.user_id
        join public.organizations o on o.id = m.organization_id
        where op.organization_id = p_org_id
          and op.user_id = auth.uid()
          and op.capability = p_capability
          and m.status = 'ACTIVE'
          and o.is_active = true
      ),
      (
        select public.role_default_capability(m.role, p_capability)
        from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id
        where m.organization_id = p_org_id
          and m.user_id = auth.uid()
          and m.status = 'ACTIVE'
          and o.is_active = true
      )
    ) is true;
$$;

revoke all on function public.has_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
revoke all on function public.role_default_capability(public.app_role, text) from public, anon, authenticated;
revoke all on function public.known_capabilities() from public, anon, authenticated;
revoke all on function public.is_known_capability(text) from public, anon, authenticated;

-- 6) Client-facing capability read (the single source of truth the UI mirrors).
create or replace function public.my_capabilities(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c text;
  out_caps jsonb := '{}'::jsonb;
begin
  -- Membership (not capability) is required to GET the report; an inactive
  -- organization returns all-false (mirroring has_permission), never an error,
  -- so the UI can never diverge from the boundary.
  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Compute from has_permission so the UI can never diverge from the boundary.
  for c in select public.known_capabilities() loop
    out_caps := out_caps || jsonb_build_object(c, public.has_permission(p_org_id, c));
  end loop;
  return out_caps;
end;
$$;

revoke all on function public.my_capabilities(uuid) from public, anon;
grant execute on function public.my_capabilities(uuid) to authenticated;

-- 7) OWNER-only member permission management (user.manage).
create or replace function public.member_capability_list(
  p_org_id uuid,
  p_user_id uuid
)
returns table (capability text, allowed boolean, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_override boolean;
  c text;
begin
  if auth.uid() is null or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = p_org_id
    and m.user_id = p_user_id
    and m.status = 'ACTIVE';
  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  for c in select public.known_capabilities() loop
    if v_role = 'OWNER' then
      capability := c;
      allowed := true;
      source := 'OWNER';
    else
      select op.allowed into v_override
      from public.org_member_permissions op
      where op.organization_id = p_org_id
        and op.user_id = p_user_id
        and op.capability = c;
      if found then
        capability := c;
        allowed := v_override;
        source := 'OVERRIDE';
      else
        capability := c;
        allowed := public.role_default_capability(v_role, c);
        source := 'PRESET';
      end if;
    end if;
    return next;
  end loop;
  return;
end;
$$;

revoke all on function public.member_capability_list(uuid, uuid) from public, anon;
grant execute on function public.member_capability_list(uuid, uuid) to authenticated;

create or replace function public.set_member_permission(
  p_org_id uuid,
  p_user_id uuid,
  p_capability text,
  p_allowed boolean
)
returns public.org_member_permissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_row public.org_member_permissions;
begin
  if auth.uid() is null or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not public.is_known_capability(p_capability) then
    raise exception 'UNKNOWN_CAPABILITY' using errcode = '22023';
  end if;
  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = p_org_id
    and m.user_id = p_user_id
    and m.status = 'ACTIVE'
  for update;
  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_role = 'OWNER' then
    raise exception 'OWNER_PERMISSIONS_IMMUTABLE' using errcode = '23514';
  end if;
  insert into public.org_member_permissions (organization_id, user_id, capability, allowed, set_by)
  values (p_org_id, p_user_id, p_capability, p_allowed, auth.uid())
  on conflict (organization_id, user_id, capability)
  do update set allowed = excluded.allowed, set_by = excluded.set_by, updated_at = now()
  returning * into v_row;
  perform public.record_audit(
    p_org_id, 'MEMBER_PERMISSION_SET', 'org_member_permission',
    v_row.organization_id || ':' || v_row.user_id,
    jsonb_build_object('capability', p_capability, 'allowed', p_allowed)
  );
  return v_row;
end;
$$;

revoke all on function public.set_member_permission(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_member_permission(uuid, uuid, text, boolean) to authenticated;

create or replace function public.clear_member_permission(
  p_org_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  delete from public.org_member_permissions op
  where op.organization_id = p_org_id
    and op.user_id = p_user_id
    and op.capability = p_capability;
  if found then
    perform public.record_audit(
      p_org_id, 'MEMBER_PERMISSION_CLEARED', 'org_member_permission',
      p_org_id || ':' || p_user_id,
      jsonb_build_object('capability', p_capability)
    );
  end if;
end;
$$;

revoke all on function public.clear_member_permission(uuid, uuid, text) from public, anon;
grant execute on function public.clear_member_permission(uuid, uuid, text) to authenticated;

-- 8) Invitation/claim provisioning: the only assistant onboarding path.
--    OWNER creates a single-use code bound to an exact email + preset role;
--    the invitee claims it with a signed-in account whose email matches.
create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (length(trim(email)) between 5 and 320 and position('@' in email) > 1),
  role public.app_role not null check (role in ('MANAGER', 'SUPERVISOR', 'WAREHOUSE', 'ACCOUNTANT')),
  code text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'CLAIMED', 'SUPERSEDED', 'REVOKED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz
);

create index org_invitations_org_idx
  on public.org_invitations (organization_id, status, created_at);

alter table public.org_invitations enable row level security;
-- Invitation codes are user.manage material: only the OWNER sees them.
-- Invitees receive the code out-of-band (claim link); they never query it.
create policy org_invitations_select_owner on public.org_invitations
  for select
  using (public.has_org_role(organization_id, array['OWNER'::public.app_role]));
revoke all on table public.org_invitations from public, anon;
grant select on table public.org_invitations to authenticated;

create or replace function public.create_org_invitation(
  p_org_id uuid,
  p_email text,
  p_role public.app_role
)
returns public.org_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.org_invitations;
  v_email text;
  v_seed text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  if auth.uid() is null or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_role not in ('MANAGER', 'SUPERVISOR', 'WAREHOUSE', 'ACCOUNTANT') then
    raise exception 'INVALID_INVITATION_ROLE' using errcode = '22023';
  end if;
  v_email := trim(p_email);

  update public.org_invitations
     set status = 'SUPERSEDED'
   where organization_id = p_org_id
     and lower(email) = lower(v_email)
     and status = 'PENDING';

  v_seed := md5(random()::text || '|' || gen_random_uuid()::text || '|' || clock_timestamp()::text);
  for i in 1..8 loop
    v_code := v_code || substr(v_alphabet, (abs(hashtext(v_seed || i::text)) % 31) + 1, 1);
  end loop;

  insert into public.org_invitations (organization_id, email, role, code, created_by)
  values (p_org_id, v_email, p_role, v_code, auth.uid())
  returning * into v;

  perform public.record_audit(
    p_org_id, 'INVITATION_CREATED', 'org_invitation', v.id::text,
    jsonb_build_object('email', v_email, 'role', p_role::text)
  );
  return v;
end;
$$;

revoke all on function public.create_org_invitation(uuid, text, public.app_role) from public, anon;
grant execute on function public.create_org_invitation(uuid, text, public.app_role) to authenticated;

create or replace function public.claim_org_invitation(p_code text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.org_invitations;
  v_org public.organizations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_inv
  from public.org_invitations
  where upper(replace(coalesce(p_code, ''), ' ', '')) = upper(code)
  for update;
  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'PENDING' then
    raise exception 'INVITATION_NOT_PENDING' using errcode = '23514';
  end if;

  select * into v_org
  from public.organizations
  where id = v_inv.organization_id
  for update;
  if not found or not v_org.is_active then
    raise exception 'ORG_NOT_ACTIVE' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = v_inv.organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  ) then
    raise exception 'ALREADY_ORG_MEMBER' using errcode = '23514';
  end if;

  select coalesce(lower(email), '') into v_email
  from auth.users
  where id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_inv.organization_id, auth.uid(), v_inv.role, 'ACTIVE');

  update public.org_invitations
     set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
   where id = v_inv.id;

  perform public.record_audit(
    v_inv.organization_id, 'INVITATION_CLAIMED', 'org_invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role::text)
  );
  return v_org;
end;
$$;

revoke all on function public.claim_org_invitation(text) from public, anon;
grant execute on function public.claim_org_invitation(text) to authenticated;

create or replace function public.revoke_org_invitation(
  p_org_id uuid,
  p_invitation_id uuid
)
returns public.org_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.org_invitations;
begin
  if auth.uid() is null or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  update public.org_invitations
     set status = 'REVOKED'
   where id = p_invitation_id
     and organization_id = p_org_id
     and status = 'PENDING'
  returning * into v;
  if not found then
    raise exception 'INVITATION_NOT_REVOCABLE' using errcode = '23514';
  end if;
  perform public.record_audit(p_org_id, 'INVITATION_REVOKED', 'org_invitation', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

revoke all on function public.revoke_org_invitation(uuid, uuid) from public, anon;
grant execute on function public.revoke_org_invitation(uuid, uuid) to authenticated;

-- 9) Data-boundary predicates, redefined to the capability layer.
--    Every existing cost-gated view, report, and commercial command now
--    respects per-member overrides with zero body changes.
create or replace function public.can_read_cost(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_org_id, 'cost.visibility');
$$;

create or replace function public.can_manage_commercial(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_org_id, 'quotation.manage');
$$;

create or replace function public.can_read_payroll(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_org_id, 'payroll.read');
$$;

grant execute on function public.can_read_payroll(uuid) to authenticated;

-- 10) Operational RLS policies re-pointed from role presets to capabilities.
--     (Select policies unchanged; membership/organization write policies are
--     already OWNER-only = user.manage by definition.)
drop policy if exists customers_insert_operational on public.customers;
drop policy if exists customers_update_operational on public.customers;
create policy customers_write_manage on public.customers
  for insert
  with check (public.has_permission(organization_id, 'customer.manage'));
create policy customers_write_manage_update on public.customers
  for update
  using (public.has_permission(organization_id, 'customer.manage'))
  with check (public.has_permission(organization_id, 'customer.manage'));

-- Preserves 0057 semantics exactly: role check in USING (row visibility),
-- status gate in WITH CHECK (violating the gate raises 42501, not a no-op).
drop policy if exists events_update_operational on public.events;
create policy events_update_manage on public.events
  for update
  using (public.has_permission(organization_id, 'event.manage'))
  with check (
    public.has_permission(organization_id, 'event.manage')
    and status in ('DRAFT', 'QUOTED')
  );

drop policy if exists catalog_categories_write_commercial on public.catalog_categories;
drop policy if exists catalog_categories_update_commercial on public.catalog_categories;
create policy catalog_categories_manage on public.catalog_categories
  for insert
  with check (public.has_permission(organization_id, 'catalog.manage'));
create policy catalog_categories_manage_update on public.catalog_categories
  for update
  using (public.has_permission(organization_id, 'catalog.manage'))
  with check (public.has_permission(organization_id, 'catalog.manage'));

drop policy if exists catalog_items_insert_commercial on public.catalog_items;
drop policy if exists catalog_items_update_commercial on public.catalog_items;
create policy catalog_items_manage on public.catalog_items
  for insert
  with check (public.has_permission(organization_id, 'catalog.manage'));
create policy catalog_items_manage_update on public.catalog_items
  for update
  using (public.has_permission(organization_id, 'catalog.manage'))
  with check (public.has_permission(organization_id, 'catalog.manage'));

drop policy if exists packages_insert_commercial on public.packages;
drop policy if exists packages_update_commercial on public.packages;
create policy packages_manage on public.packages
  for insert
  with check (public.has_permission(organization_id, 'catalog.manage'));
create policy packages_manage_update on public.packages
  for update
  using (public.has_permission(organization_id, 'catalog.manage'))
  with check (public.has_permission(organization_id, 'catalog.manage'));

drop policy if exists package_items_insert_commercial on public.package_items;
drop policy if exists package_items_update_commercial on public.package_items;
create policy package_items_manage on public.package_items
  for insert
  with check (public.has_permission(organization_id, 'catalog.manage'));
create policy package_items_manage_update on public.package_items
  for update
  using (public.has_permission(organization_id, 'catalog.manage'))
  with check (public.has_permission(organization_id, 'catalog.manage'));

drop policy if exists staff_members_manage on public.staff_members;
create policy staff_members_manage on public.staff_members
  for all
  using (public.has_permission(organization_id, 'staff.manage'))
  with check (public.has_permission(organization_id, 'staff.manage'));

drop policy if exists equipment_capacity_manage on public.equipment_capacity;
create policy equipment_capacity_manage on public.equipment_capacity
  for all
  using (public.has_permission(organization_id, 'warehouse.dispatch'))
  with check (public.has_permission(organization_id, 'warehouse.dispatch'));

-- ============================================================================
-- PART B: operational RPC gates re-pointed from role presets to capabilities.
-- Each function body is identical to the current definition except the
-- authorization gate(s), which now call public.has_permission.
-- ============================================================================
-- Capability gate: create_event -> event.manage
create or replace function public.create_event(p_org_id uuid,p_customer_id uuid,p_title text,p_event_type text,p_start_at timestamptz,p_end_at timestamptz,p_guest_count int,p_venue_name text,p_location_details text default null,p_contact_name text default null,p_contact_phone text default null,p_notes text default null,p_idempotency_key uuid default gen_random_uuid())
returns public.events language plpgsql security definer set search_path='' as $$
declare v public.events; v_number text;
begin
 if auth.uid() is null or not public.has_permission(p_org_id, 'event.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.events where organization_id=p_org_id and idempotency_key=p_idempotency_key; if found then return v; end if;
 if p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
 if p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
 if not exists(select 1 from public.customers where organization_id=p_org_id and id=p_customer_id and is_active) then raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503'; end if;
 v_number:=public.next_document_number(p_org_id,'EVENT','EV');
 insert into public.events(organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,location_details,contact_name,contact_phone,notes,idempotency_key,created_by,updated_by)
 values(p_org_id,p_customer_id,v_number,trim(p_title),coalesce(nullif(trim(p_event_type),''),'OTHER'),p_start_at,p_end_at,p_guest_count,trim(p_venue_name),p_location_details,p_contact_name,p_contact_phone,p_notes,p_idempotency_key,auth.uid(),auth.uid()) returning * into v;
 insert into public.event_status_history(organization_id,event_id,to_status,actor_id,reason) values(p_org_id,v.id,'DRAFT',auth.uid(),'EVENT_CREATED');
 perform public.record_audit(p_org_id,'EVENT_CREATED','event',v.id::text,jsonb_build_object('event_number',v.event_number)); return v;
end$$;

-- Capability gate: transition_event_status -> event.manage
create or replace function public.transition_event_status(
  p_org_id uuid,
  p_event_id uuid,
  p_to public.event_status,
  p_reason text default null,
  p_override_reason text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_allowed boolean;
  v_from public.event_status;
  v_out numeric;
  v_readiness_status text;
begin
  if not public.has_permission(p_org_id, 'event.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  select * into v from public.events where organization_id=p_org_id and id=p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_to='CANCELLED' then raise exception 'USE_CANCEL_EVENT'; end if;

  v_from := v.status;
  v_allowed := (v.status,p_to) in (('CONFIRMED','PREPARING'),('PREPARING','DISPATCHED'),('DISPATCHED','IN_PROGRESS'),('IN_PROGRESS','RETURNING'),('RETURNING','CLOSED'));
  if not v_allowed then raise exception 'INVALID_EVENT_TRANSITION: % -> %', v.status, p_to; end if;

  if p_to = 'CLOSED' then
    v_out := coalesce((public.event_warehouse_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE'; end if;
    v_out := coalesce((public.event_consumable_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE'; end if;
  end if;

  -- Readiness gate: dispatching with missing resources requires an explicit,
  -- audited override. Readiness is derived (staff/equipment), never a status.
  if p_to = 'DISPATCHED' then
    v_readiness_status := coalesce(public.event_readiness(p_org_id, p_event_id)->>'status', 'READY');
    if v_readiness_status <> 'READY' and nullif(trim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'READINESS_OVERRIDE_REQUIRED' using errcode = '23514';
    end if;
  end if;

  update public.events set status=p_to, updated_by=auth.uid() where id=v.id returning * into v;
  insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.id,v_from,p_to,auth.uid(),p_reason);

  if p_to = 'DISPATCHED' and nullif(trim(coalesce(p_override_reason, '')), '') is not null then
    insert into public.event_transition_overrides(organization_id,event_id,from_status,to_status,reason,actor_id)
    values(p_org_id, v.id, v_from, p_to, trim(p_override_reason), auth.uid());
    perform public.record_audit(p_org_id, 'EVENT_TRANSITION_OVERRIDDEN', 'event', v.id::text,
      jsonb_build_object('from', v_from::text, 'to', p_to::text, 'reason', trim(p_override_reason)));
  end if;

  return v;
end;
$$;

-- Capability gate: cancel_event -> event.manage
create or replace function public.cancel_event(
  p_org_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_staff int;
  v_equipment int;
  v_retained int;
begin
  if not public.has_permission(p_org_id, 'event.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  select * into v from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v.status = 'CANCELLED' then
    return v;
  end if;
  if v.status not in ('DRAFT', 'QUOTED', 'CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS', 'RETURNING') then
    raise exception 'EVENT_CANNOT_BE_CANCELLED';
  end if;

  update public.event_staff_assignments
     set status = 'CANCELLED'
   where event_id = p_event_id and status = 'ACTIVE';
  get diagnostics v_staff = row_count;

  -- Release only lines that have no physical recovery obligation NOW.
  update public.event_equipment_reservations r
     set status = 'CANCELLED'
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE'
     and coalesce((
       select sum(
         m.dispatched_quantity
         - m.returned_good_quantity
         - m.damaged_quantity
         - m.lost_quantity
       )
       from public.event_equipment_movements m
       where m.organization_id = r.organization_id
         and m.reservation_id = r.id
     ), 0) = 0;
  get diagnostics v_equipment = row_count;

  select count(*)::int into v_retained
    from public.event_equipment_reservations r
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE';

  insert into public.event_status_history(
    organization_id, event_id, from_status, to_status, actor_id, reason
  ) values (
    p_org_id, p_event_id, v.status, 'CANCELLED', auth.uid(), trim(p_reason)
  );

  update public.events
     set status = 'CANCELLED',
         cancellation_reason = trim(p_reason),
         updated_by = auth.uid()
   where id = p_event_id
  returning * into v;

  perform public.record_audit(
    p_org_id, 'EVENT_CANCELLED', 'event', p_event_id::text,
    jsonb_build_object(
      'reason', trim(p_reason),
      'staff_released', v_staff,
      'equipment_released', v_equipment,
      'equipment_retained_outstanding', v_retained,
      'idempotency_key', p_idempotency_key
    )
  );

  return v;
end;
$$;

-- Capability gate: reserve_event_equipment -> warehouse.dispatch
create or replace function public.reserve_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_capacity_id uuid,
  p_quantity int,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_capacity public.equipment_capacity;
  v_reserved bigint;
  v_unserviceable bigint;
  v_serviceable bigint;
  v_id uuid;
begin
  if not public.has_permission(p_org_id, 'warehouse.dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select id into v_id
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key
     and event_id = p_event_id
     and equipment_capacity_id = p_capacity_id;

  if found then
    select * into v_event
      from public.events
     where id = p_event_id and organization_id = p_org_id;
    select * into v_capacity
      from public.equipment_capacity
     where id = p_capacity_id and organization_id = p_org_id;
  else
    select * into v_event
      from public.events
     where organization_id = p_org_id and id = p_event_id;
    if not found or v_event.status = 'CANCELLED' then
      raise exception 'EVENT_NOT_RESERVABLE';
    end if;

    -- Shared serialization point with damage/loss + dispatch guard.
    select * into v_capacity
      from public.equipment_capacity
     where organization_id = p_org_id
       and id = p_capacity_id
       and is_active
     for update;
    if not found then
      raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
    end if;

    select coalesce(sum(m.damaged_quantity + m.lost_quantity), 0)::bigint
      into v_unserviceable
      from public.event_equipment_movements m
     where m.organization_id = p_org_id
       and m.equipment_capacity_id = p_capacity_id;

    v_serviceable := greatest(v_capacity.total_quantity::bigint - v_unserviceable, 0);

    select coalesce(sum(quantity), 0)
      into v_reserved
      from public.event_equipment_reservations
     where equipment_capacity_id = p_capacity_id
       and status = 'ACTIVE'
       and tstzrange(reserved_from, reserved_until, '[)')
           && tstzrange(v_event.start_at, v_event.end_at, '[)');

    if v_reserved + p_quantity > v_serviceable then
      raise exception 'EQUIPMENT_SHORTAGE'
        using detail = jsonb_build_object(
          'total', v_capacity.total_quantity,
          'unserviceable', v_unserviceable,
          'serviceable', v_serviceable,
          'reserved', v_reserved,
          'available', greatest(v_serviceable - v_reserved, 0),
          'shortage', v_reserved + p_quantity - v_serviceable
        )::text;
    end if;

    insert into public.event_equipment_reservations(
      organization_id, event_id, equipment_capacity_id, quantity,
      reserved_from, reserved_until, idempotency_key, created_by
    ) values (
      p_org_id, p_event_id, p_capacity_id, p_quantity,
      v_event.start_at, v_event.end_at, p_idempotency_key, auth.uid()
    ) returning id into v_id;

    perform public.record_audit(
      p_org_id, 'EQUIPMENT_RESERVED', 'event_equipment_reservation', v_id::text,
      jsonb_build_object('event_id', p_event_id, 'quantity', p_quantity)
    );
  end if;

  select coalesce(sum(m.damaged_quantity + m.lost_quantity), 0)::bigint
    into v_unserviceable
    from public.event_equipment_movements m
   where m.organization_id = p_org_id
     and m.equipment_capacity_id = p_capacity_id;
  v_serviceable := greatest(v_capacity.total_quantity::bigint - v_unserviceable, 0);

  select coalesce(sum(quantity), 0)
    into v_reserved
    from public.event_equipment_reservations
   where equipment_capacity_id = p_capacity_id
     and status = 'ACTIVE'
     and tstzrange(reserved_from, reserved_until, '[)')
         && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object(
    'reservation_id', v_id,
    'total', v_capacity.total_quantity,
    'unserviceable', v_unserviceable,
    'serviceable', v_serviceable,
    'reserved', v_reserved,
    'available', greatest(v_serviceable - v_reserved, 0),
    'shortage', 0
  );
end;
$$;

-- Capability gate: release_equipment_reservation -> warehouse.dispatch
create or replace function public.release_equipment_reservation(
  p_org_id uuid,
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.event_equipment_reservations;
  v_state record;
begin
  if not public.has_permission(p_org_id, 'warehouse.dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;

  if not found or v_reservation.status <> 'ACTIVE' then
    return;
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if coalesce(v_state.outstanding_quantity, 0) > 0 then
    raise exception 'RESERVATION_HAS_OUTSTANDING_EQUIPMENT';
  end if;

  update public.event_equipment_reservations
     set status = 'RELEASED'
   where organization_id = p_org_id
     and id = p_reservation_id
     and status = 'ACTIVE';

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_RELEASED', 'event_equipment_reservation', p_reservation_id::text,
    jsonb_build_object('event_id', v_reservation.event_id)
  );
end;
$$;

-- Capability gate: dispatch_event_equipment -> warehouse.dispatch
create or replace function public.dispatch_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_reservation_id uuid,
  p_quantity int,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_equipment_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.event_equipment_movements;
  v_event public.events;
  v_reservation public.event_equipment_reservations;
  v_state record;
  v_fingerprint text;
  v_capacity_total int;
  v_physically_unavailable bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'warehouse.dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'DISPATCH',
    'event_id', p_event_id,
    'reservation_id', p_reservation_id,
    'quantity', p_quantity,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  -- Fast-path replay before taking locks.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- FIRST shared lock: every movement, reconciliation and cancellation for the
  -- same Event serializes here.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A concurrent identical retry may have committed while we waited.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if v_event.status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
    raise exception 'EVENT_NOT_DISPATCHABLE';
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  -- SECOND lock: per-reservation quantity serialization.
  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '23503';
  end if;

  if v_reservation.event_id <> p_event_id then
    raise exception 'RESERVATION_EVENT_MISMATCH' using errcode = '23503';
  end if;

  if v_reservation.status <> 'ACTIVE' then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if v_state.dispatched_quantity + p_quantity > v_state.reserved_quantity then
    raise exception 'DISPATCH_EXCEEDS_RESERVATION'
      using detail = jsonb_build_object(
        'reserved', v_state.reserved_quantity,
        'already_dispatched', v_state.dispatched_quantity,
        'requested', p_quantity,
        'remaining', greatest(v_state.reserved_quantity - v_state.dispatched_quantity, 0)
      )::text;
  end if;

  -- THIRD shared lock: different Events/reservations drawing from the same
  -- physical capacity serialize here. A unit is serviceable again only when it
  -- returns GOOD; damaged/lost units remain unavailable.
  select c.total_quantity
    into v_capacity_total
    from public.equipment_capacity c
   where c.organization_id = p_org_id
     and c.id = v_reservation.equipment_capacity_id
     and c.is_active
   for update;
  if not found then
    raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
  end if;

  select coalesce(sum(
    m.dispatched_quantity - m.returned_good_quantity
  ), 0)::bigint
    into v_physically_unavailable
    from public.event_equipment_movements m
   where m.organization_id = p_org_id
     and m.equipment_capacity_id = v_reservation.equipment_capacity_id;

  if v_physically_unavailable + p_quantity > v_capacity_total then
    raise exception 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY'
      using detail = jsonb_build_object(
        'total', v_capacity_total,
        'physically_unavailable', v_physically_unavailable,
        'requested', p_quantity,
        'available', greatest(v_capacity_total - v_physically_unavailable, 0)
      )::text;
  end if;

  insert into public.event_equipment_movements (
    organization_id, event_id, reservation_id, equipment_capacity_id,
    movement_kind, dispatched_quantity,
    reference, condition_notes,
    actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_reservation_id, v_reservation.equipment_capacity_id,
    'DISPATCH', p_quantity,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_movement;

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_DISPATCHED', 'event_equipment_movement', v_movement.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reservation_id', p_reservation_id,
      'equipment_capacity_id', v_reservation.equipment_capacity_id,
      'quantity', p_quantity,
      'reference', v_movement.reference,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_movement;
end;
$$;

-- Capability gate: return_event_equipment -> warehouse.dispatch
create or replace function public.return_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_reservation_id uuid,
  p_returned_good_quantity int,
  p_damaged_quantity int,
  p_lost_quantity int,
  p_reference text,
  p_condition_notes text,
  p_idempotency_key uuid
)
returns public.event_equipment_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.event_equipment_movements;
  v_event public.events;
  v_reservation public.event_equipment_reservations;
  v_state record;
  v_fingerprint text;
  v_good int := coalesce(p_returned_good_quantity, 0);
  v_damaged int := coalesce(p_damaged_quantity, 0);
  v_lost int := coalesce(p_lost_quantity, 0);
  v_total int;
  v_unit_cost numeric(12,3);
  v_valuation numeric(14,3);
  v_basis public.warehouse_valuation_basis;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'warehouse.dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RETURN',
    'event_id', p_event_id,
    'reservation_id', p_reservation_id,
    'returned_good', v_good,
    'damaged', v_damaged,
    'lost', v_lost,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'condition_notes', nullif(trim(coalesce(p_condition_notes, '')), '')
  ));

  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if v_good < 0 or v_damaged < 0 or v_lost < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  v_total := v_good + v_damaged + v_lost;
  if v_total < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- FIRST shared lock: serialize with reconciliation/cancellation.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Concurrent retry may have committed while waiting on the Event.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  -- SECOND lock: per-reservation outstanding serialization.
  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '23503';
  end if;

  if v_reservation.event_id <> p_event_id then
    raise exception 'RESERVATION_EVENT_MISMATCH' using errcode = '23503';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if v_total > v_state.outstanding_quantity then
    raise exception 'RETURN_EXCEEDS_OUTSTANDING'
      using detail = jsonb_build_object(
        'dispatched', v_state.dispatched_quantity,
        'already_accounted', v_state.dispatched_quantity - v_state.outstanding_quantity,
        'outstanding', v_state.outstanding_quantity,
        'requested', v_total
      )::text;
  end if;

  if (v_damaged + v_lost) > 0 then
    select ci.cost_price into v_unit_cost
      from public.equipment_capacity ec
      join public.catalog_items ci
        on ci.organization_id = ec.organization_id
       and ci.id = ec.catalog_item_id
     where ec.organization_id = p_org_id
       and ec.id = v_reservation.equipment_capacity_id;

    if v_unit_cost is null then
      raise exception 'VALUATION_BASIS_UNAVAILABLE';
    end if;

    v_basis := 'CATALOG_COST_SNAPSHOT';
    v_valuation := round(v_unit_cost * (v_damaged + v_lost), 3);
  end if;

  insert into public.event_equipment_movements (
    organization_id, event_id, reservation_id, equipment_capacity_id,
    movement_kind,
    returned_good_quantity, damaged_quantity, lost_quantity,
    valuation_basis, unit_valuation_omr, damage_loss_valuation_omr,
    reference, condition_notes,
    actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_reservation_id, v_reservation.equipment_capacity_id,
    'RETURN',
    v_good, v_damaged, v_lost,
    v_basis, v_unit_cost, v_valuation,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_condition_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_movement;

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_RETURNED', 'event_equipment_movement', v_movement.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reservation_id', p_reservation_id,
      'equipment_capacity_id', v_reservation.equipment_capacity_id,
      'returned_good', v_good,
      'damaged', v_damaged,
      'lost', v_lost,
      'reference', v_movement.reference,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_movement;
end;
$$;

-- Capability gate: reconcile_event_warehouse -> warehouse.reconcile
create or replace function public.reconcile_event_warehouse(
  p_org_id uuid,
  p_event_id uuid,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_warehouse_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.event_warehouse_reconciliations;
  v_event public.events;
  v_fingerprint text;
  v_outstanding int;
  v_reserved int;
  v_dispatched int;
  v_good int;
  v_damaged int;
  v_lost int;
  v_valuation numeric(14,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'warehouse.reconcile') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECONCILE',
    'event_id', p_event_id,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  select * into v_rec
    from public.event_warehouse_reconciliations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  -- Shared Event lock with dispatch/return/cancel.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Concurrent identical reconciliation may have committed while waiting.
  select * into v_rec
    from public.event_warehouse_reconciliations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  select
    coalesce(sum(s.reserved_quantity), 0)::int,
    coalesce(sum(s.dispatched_quantity), 0)::int,
    coalesce(sum(s.returned_good_quantity), 0)::int,
    coalesce(sum(s.damaged_quantity), 0)::int,
    coalesce(sum(s.lost_quantity), 0)::int,
    coalesce(sum(s.outstanding_quantity), 0)::int
  into v_reserved, v_dispatched, v_good, v_damaged, v_lost, v_outstanding
  from public.event_equipment_reservations r
  cross join lateral public.warehouse_reservation_state(p_org_id, r.id) s
  where r.organization_id = p_org_id and r.event_id = p_event_id;

  if v_outstanding > 0 then
    raise exception 'WAREHOUSE_OUTSTANDING_QUANTITY'
      using detail = jsonb_build_object('outstanding', v_outstanding)::text;
  end if;

  select coalesce(sum(damage_loss_valuation_omr), 0)::numeric(14,3)
    into v_valuation
    from public.event_equipment_movements
   where organization_id = p_org_id and event_id = p_event_id;

  insert into public.event_warehouse_reconciliations (
    organization_id, event_id,
    total_reserved_quantity, total_dispatched_quantity,
    total_returned_good_quantity, total_damaged_quantity, total_lost_quantity,
    total_damage_loss_valuation_omr,
    notes, actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id,
    v_reserved, v_dispatched, v_good, v_damaged, v_lost,
    v_valuation,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_rec;

  perform public.record_audit(
    p_org_id, 'WAREHOUSE_RECONCILED', 'event_warehouse_reconciliation', v_rec.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reserved', v_reserved,
      'dispatched', v_dispatched,
      'returned_good', v_good,
      'damaged', v_damaged,
      'lost', v_lost,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_rec;
end;
$$;

-- Capability gate: save_consumable_stock_item -> stock.adjust
create or replace function public.save_consumable_stock_item(
  p_org_id uuid,
  p_catalog_item_id uuid,
  p_minimum_stock_quantity numeric,
  p_is_tracking_active boolean
)
returns public.consumable_stock_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.catalog_items;
  v_row public.consumable_stock_items;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'stock.adjust') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_minimum_stock_quantity is null or p_minimum_stock_quantity < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if round(p_minimum_stock_quantity, 3) <> p_minimum_stock_quantity then
    raise exception 'QUANTITY_PRECISION_EXCEEDED';
  end if;

  select * into v_item
    from public.catalog_items
   where organization_id = p_org_id and id = p_catalog_item_id;
  if not found then
    raise exception 'CATALOG_ITEM_NOT_FOUND' using errcode = '23503';
  end if;
  if v_item.item_type <> 'CONSUMABLE' then
    raise exception 'CATALOG_ITEM_NOT_CONSUMABLE' using errcode = '23514';
  end if;
  if v_item.status <> 'ACTIVE' then
    raise exception 'CATALOG_ITEM_NOT_ACTIVE';
  end if;

  insert into public.consumable_stock_items (
    organization_id, catalog_item_id,
    minimum_stock_quantity, is_tracking_active, created_by
  ) values (
    p_org_id, p_catalog_item_id,
    p_minimum_stock_quantity, coalesce(p_is_tracking_active, true), auth.uid()
  )
  on conflict (organization_id, catalog_item_id) do update
    set minimum_stock_quantity = excluded.minimum_stock_quantity,
        is_tracking_active = excluded.is_tracking_active
  returning * into v_row;

  perform public.record_audit(
    p_org_id, 'CONSUMABLE_STOCK_ITEM_SAVED', 'consumable_stock_item', v_row.id::text,
    jsonb_build_object(
      'catalog_item_id', p_catalog_item_id,
      'minimum_stock_quantity', p_minimum_stock_quantity::text,
      'is_tracking_active', v_row.is_tracking_active
    )
  );

  return v_row;
end;
$$;

-- Capability gate: adjust_consumable_stock -> stock.adjust
create or replace function public.adjust_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'stock.adjust') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity, true);

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'ADJUSTMENT', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_ADJUSTMENT',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_ADJUSTED'
  );
end;
$$;

-- Capability gate: reconcile_event_consumables -> stock.adjust
create or replace function public.reconcile_event_consumables(
  p_org_id uuid,
  p_event_id uuid,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_consumable_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.event_consumable_reconciliations;
  v_event public.events;
  v_fingerprint text;
  v_issued numeric;
  v_returned numeric;
  v_consumed numeric;
  v_wasted numeric;
  v_outstanding numeric;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'stock.adjust') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CONSUMABLE_RECONCILE',
    'event_id', p_event_id,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  select * into v_rec
    from public.event_consumable_reconciliations
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  -- The shared Event lock: no concurrent issue/return/consume/waste can land
  -- between the outstanding check and the reconciliation insert.
  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A concurrent identical retry may have committed while we waited.
  select * into v_rec
    from public.event_consumable_reconciliations
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  if exists (
    select 1 from public.event_consumable_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'CONSUMABLES_ALREADY_RECONCILED';
  end if;

  select
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'CONSUME_AT_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'WASTE_AT_EVENT'), 0),
    coalesce(sum(m.event_delta), 0)
  into v_issued, v_returned, v_consumed, v_wasted, v_outstanding
  from public.consumable_movements m
  where m.organization_id = p_org_id and m.event_id = p_event_id;

  if v_outstanding > 0 then
    raise exception 'CONSUMABLE_OUTSTANDING_QUANTITY'
      using detail = jsonb_build_object('outstanding', v_outstanding::text)::text;
  end if;

  insert into public.event_consumable_reconciliations (
    organization_id, event_id,
    total_issued_quantity, total_returned_quantity,
    total_consumed_quantity, total_wasted_quantity,
    notes, actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id,
    v_issued, v_returned, v_consumed, v_wasted,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_rec;

  perform public.record_audit(
    p_org_id, 'CONSUMABLES_RECONCILED', 'event_consumable_reconciliation', v_rec.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'issued', v_issued::text,
      'returned', v_returned::text,
      'consumed', v_consumed::text,
      'wasted', v_wasted::text,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_rec;
end;
$$;

-- Capability gate: receive_consumable_stock -> consumable.manage
create or replace function public.receive_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'RECEIVE', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_RECEIVE',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_RECEIVED'
  );
end;
$$;

-- Capability gate: issue_consumable_to_event -> consumable.manage
create or replace function public.issue_consumable_to_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'ISSUE_TO_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_ISSUE',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_ISSUED'
  );
end;
$$;

-- Capability gate: return_consumable_from_event -> consumable.manage
create or replace function public.return_consumable_from_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'RETURN_FROM_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_RETURN',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_RETURNED'
  );
end;
$$;

-- Capability gate: consume_consumable_at_event -> consumable.manage
create or replace function public.consume_consumable_at_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'CONSUME_AT_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_CONSUME',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_CONSUMED'
  );
end;
$$;

-- Capability gate: waste_consumable_at_event -> consumable.manage
create or replace function public.waste_consumable_at_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'WASTE_AT_EVENT', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_EVENT_WASTE',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_EVENT_WASTED'
  );
end;
$$;

-- Capability gate: waste_consumable_stock -> consumable.manage
create or replace function public.waste_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'consumable.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'WASTE_REASON_REQUIRED';
  end if;

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'WAREHOUSE_WASTE', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_WAREHOUSE_WASTE',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_WAREHOUSE_WASTED'
  );
end;
$$;

-- Capability gate: create_procurement_order -> procurement.manage
create or replace function public.create_procurement_order(
  p_org_id uuid,
  p_supplier_id uuid,
  p_event_id uuid,
  p_order_date date,
  p_expected_delivery_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
  v_number text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_order_date is null then
    raise exception 'PROCUREMENT_ORDER_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_PROCUREMENT_ORDER', 'supplier_id', p_supplier_id,
    'event_id', p_event_id, 'order_date', p_order_date,
    'expected_delivery_at', p_expected_delivery_at,
    'notes', nullif(trim(coalesce(p_notes, '')), ''), 'lines', p_lines
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.procurement_orders, v_replay);
  end if;

  -- Shared serialization point with supplier status changes.
  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id
     and s.id = p_supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e
     where e.organization_id = p_org_id and e.id = p_event_id
       and e.status not in ('CLOSED', 'CANCELLED')
  ) then
    raise exception 'EVENT_NOT_PROCUREABLE' using errcode = '23503';
  end if;

  v_number := public.next_document_number(p_org_id, 'PROCUREMENT_ORDER', 'PO');
  insert into public.procurement_orders (
    organization_id, supplier_id, event_id, order_number, order_date,
    expected_delivery_at, notes, created_by, updated_by
  ) values (
    p_org_id, p_supplier_id, p_event_id, v_number, p_order_date,
    p_expected_delivery_at, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid()
  ) returning * into v_order;

  perform public.replace_procurement_lines_internal(
    p_org_id, v_order.id, coalesce(p_lines, '[]'::jsonb)
  );
  select * into v_order from public.procurement_orders where id = v_order.id;

  perform public.record_audit(
    p_org_id, 'PROCUREMENT_ORDER_CREATED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'order_number', v_order.order_number)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_PROCUREMENT_ORDER', v_fingerprint,
    'procurement_order', v_order.id, to_jsonb(v_order)
  );
  return v_order;
end;
$$;

-- Capability gate: update_procurement_order -> procurement.manage
create or replace function public.update_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_supplier_id uuid,
  p_event_id uuid,
  p_order_date date,
  p_expected_delivery_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_order_date is null then
    raise exception 'PROCUREMENT_ORDER_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'UPDATE_PROCUREMENT_ORDER', 'order_id', p_order_id,
    'supplier_id', p_supplier_id, 'event_id', p_event_id, 'order_date', p_order_date,
    'expected_delivery_at', p_expected_delivery_at,
    'notes', nullif(trim(coalesce(p_notes, '')), ''), 'lines', p_lines
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.procurement_orders, v_replay);
  end if;

  -- Stable aggregate lock first.
  select * into v_order
    from public.procurement_orders o
   where o.organization_id = p_org_id and o.id = p_order_id
   for update;
  if not found then
    raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception 'PROCUREMENT_ORDER_NOT_EDITABLE';
  end if;

  -- Then serialize against target supplier lifecycle changes, matching the
  -- approval lock order (order -> supplier).
  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id
     and s.id = p_supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e
     where e.organization_id = p_org_id and e.id = p_event_id
       and e.status not in ('CLOSED', 'CANCELLED')
  ) then
    raise exception 'EVENT_NOT_PROCUREABLE' using errcode = '23503';
  end if;

  update public.procurement_orders set
    supplier_id = p_supplier_id,
    event_id = p_event_id,
    order_date = p_order_date,
    expected_delivery_at = p_expected_delivery_at,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = p_order_id;

  perform public.replace_procurement_lines_internal(
    p_org_id, p_order_id, coalesce(p_lines, '[]'::jsonb)
  );
  select * into v_order from public.procurement_orders where id = p_order_id;

  perform public.record_audit(
    p_org_id, 'PROCUREMENT_ORDER_UPDATED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'UPDATE_PROCUREMENT_ORDER', v_fingerprint,
    'procurement_order', v_order.id, to_jsonb(v_order)
  );
  return v_order;
end;
$$;

-- Capability gate: approve_procurement_order -> procurement.manage
create or replace function public.approve_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_supplier public.suppliers;
  v_total numeric;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'APPROVE_PROCUREMENT_ORDER', 'order_id', p_order_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders, v_replay); end if;

  select * into v_order from public.procurement_orders o
   where o.organization_id = p_org_id and o.id = p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.status <> 'DRAFT' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;

  -- Shared serialization point with supplier lifecycle changes. If
  -- deactivation commits first, approval observes INACTIVE and rejects; if
  -- approval locks first, it snapshots an active supplier before the later
  -- deactivation. Both outcomes are linearizable.
  select * into v_supplier from public.suppliers s
   where s.organization_id = p_org_id and s.id = v_order.supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE';
  end if;
  if v_order.event_id is not null and not exists (
    select 1 from public.events e where e.organization_id = p_org_id and e.id = v_order.event_id
      and e.status not in ('CLOSED', 'CANCELLED')
  ) then raise exception 'EVENT_NOT_PROCUREABLE'; end if;
  if not exists (
    select 1 from public.procurement_order_lines l
     where l.organization_id = p_org_id and l.order_id = p_order_id
  ) then raise exception 'PROCUREMENT_ORDER_LINES_REQUIRED'; end if;

  select sum(l.agreed_total_cost) into v_total
    from public.procurement_order_lines l
   where l.organization_id = p_org_id and l.order_id = p_order_id;
  perform public.assert_procurement_omr(v_total);

  update public.procurement_orders set
    status = 'APPROVED', agreed_total_cost = v_total,
    supplier_name_snapshot = v_supplier.name,
    supplier_contact_name_snapshot = v_supplier.contact_name,
    supplier_phone_snapshot = v_supplier.phone,
    approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
  where id = p_order_id returning * into v_order;

  perform public.record_audit(p_org_id, 'PROCUREMENT_ORDER_APPROVED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'total_cost', v_total::text));
  perform public.finish_procurement_command(p_org_id, p_idempotency_key, 'APPROVE_PROCUREMENT_ORDER',
    v_fingerprint, 'procurement_order', v_order.id, to_jsonb(v_order));
  return v_order;
end;
$$;

-- Capability gate: send_procurement_order -> procurement.manage
create or replace function public.send_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','SEND_PROCUREMENT_ORDER','order_id',p_order_id));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status<>'APPROVED' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;
  update public.procurement_orders set status='SENT',sent_by=auth.uid(),sent_at=now(),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_SENT','procurement_order',v_order.id::text,jsonb_build_object('idempotency_key',p_idempotency_key));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'SEND_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

-- Capability gate: confirm_procurement_order -> procurement.manage
create or replace function public.confirm_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','CONFIRM_PROCUREMENT_ORDER','order_id',p_order_id));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status<>'SENT' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;
  update public.procurement_orders set status='CONFIRMED',confirmed_by=auth.uid(),confirmed_at=now(),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_CONFIRMED','procurement_order',v_order.id::text,jsonb_build_object('idempotency_key',p_idempotency_key));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'CONFIRM_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

-- Capability gate: receive_procurement_order -> warehouse.dispatch
create or replace function public.receive_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_received_at timestamptz,
  p_reference text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.procurement_receipts;
  v_order public.procurement_orders;
  v_line public.procurement_order_lines;
  v_movement public.consumable_movements;
  v_entry record;
  v_quantity numeric;
  v_already numeric;
  v_fingerprint text;
  v_replay jsonb;
  v_child_key uuid;
  v_is_warehouse boolean;
  v_count integer := 0;
  v_all_received boolean;
  v_reference text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
  if not public.has_permission(p_org_id, 'warehouse.dispatch') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'PROCUREMENT_RECEIPT_LINES_REQUIRED' using errcode='22023';
  end if;

  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object(
    'command','RECEIVE_PROCUREMENT_ORDER','order_id',p_order_id,
    'received_at',p_received_at,'reference',nullif(trim(coalesce(p_reference,'')),''),
    'notes',nullif(trim(coalesce(p_notes,'')),''),'lines',p_lines
  ));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_receipts,v_replay); end if;

  select * into v_order from public.procurement_orders o
   where o.organization_id=p_org_id and o.id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status not in ('CONFIRMED','PARTIALLY_RECEIVED') then
    raise exception 'PROCUREMENT_ORDER_NOT_RECEIVABLE';
  end if;

  -- Reject duplicate line ids before any movement is written.
  begin
    if (select count(*) from jsonb_array_elements(p_lines)) <>
       (select count(distinct (x.value->>'order_line_id')::uuid) from jsonb_array_elements(p_lines) x) then
      raise exception 'DUPLICATE_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
    end if;
  exception when invalid_text_representation then
    raise exception 'INVALID_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
  end;

  -- Domain branch (not authorization): physical line-by-line receipt is the
  -- WAREHOUSE-role workflow; other permitted callers confirm service lines.
  v_is_warehouse:=public.has_org_role(p_org_id,array['WAREHOUSE'::public.app_role]);

  insert into public.procurement_receipts(
    organization_id,order_id,received_at,reference,notes,received_by,
    idempotency_key,request_fingerprint
  ) values(
    p_org_id,p_order_id,coalesce(p_received_at,now()),
    nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),
    auth.uid(),p_idempotency_key,v_fingerprint
  ) returning * into v_receipt;

  -- Deterministic stock lock order. Service rows sort after stock rows by line
  -- id; they acquire no stock lock.
  for v_entry in
    select l.id as line_id, x.value as payload
      from jsonb_array_elements(p_lines) x
      join public.procurement_order_lines l
        on l.organization_id=p_org_id
       and l.order_id=p_order_id
       and l.id=(x.value->>'order_line_id')::uuid
     order by coalesce(l.stock_item_id,l.id),l.id
  loop
    v_count:=v_count+1;
    select * into v_line from public.procurement_order_lines
     where organization_id=p_org_id and order_id=p_order_id and id=v_entry.line_id;
    begin
      v_quantity:=(v_entry.payload->>'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
    end;
    perform public.assert_procurement_quantity(v_quantity);

    select coalesce(sum(rl.quantity),0) into v_already
      from public.procurement_receipt_lines rl
     where rl.organization_id=p_org_id and rl.order_line_id=v_line.id;
    if v_already+v_quantity>v_line.quantity then
      raise exception 'PROCUREMENT_OVER_RECEIPT' using errcode='23514',
        detail=jsonb_build_object('ordered',v_line.quantity::text,'already_received',v_already::text,'requested',v_quantity::text)::text;
    end if;
    if v_is_warehouse and v_line.line_kind<>'CONSUMABLE' then
      raise exception 'WAREHOUSE_PHYSICAL_RECEIPT_ONLY' using errcode='42501';
    end if;

    v_movement:=null;
    if v_line.line_kind='CONSUMABLE' then
      -- One deterministic child key per parent receipt intent + order line.
      v_child_key:=substr(public.warehouse_fingerprint(jsonb_build_object(
        'namespace','PROCUREMENT_RECEIPT_MOVEMENT','receipt_key',p_idempotency_key,'line_id',v_line.id
      )),1,32)::uuid;
      v_reference:=concat_ws(' / ',v_order.order_number,nullif(trim(coalesce(p_reference,'')),''));
      v_movement:=public.record_consumable_movement(
        p_org_id,v_line.stock_item_id,null,'RECEIVE',v_quantity,null,v_reference,
        v_child_key,
        public.warehouse_fingerprint(jsonb_build_object(
          'command','PROCUREMENT_CONSUMABLE_RECEIVE','order_id',p_order_id,
          'order_line_id',v_line.id,'quantity',v_quantity::text,
          'receipt_idempotency_key',p_idempotency_key
        )),
        'CONSUMABLE_RECEIVED'
      );
    end if;

    insert into public.procurement_receipt_lines(
      organization_id,receipt_id,order_id,order_line_id,quantity,consumable_movement_id
    ) values(
      p_org_id,v_receipt.id,p_order_id,v_line.id,v_quantity,
      case when v_line.line_kind='CONSUMABLE' then v_movement.id else null end
    );
  end loop;

  if v_count<>jsonb_array_length(p_lines) then
    raise exception 'PROCUREMENT_ORDER_LINE_NOT_FOUND' using errcode='23503';
  end if;

  select not exists(
    select 1 from public.procurement_order_lines l
     where l.organization_id=p_org_id and l.order_id=p_order_id
       and coalesce((select sum(rl.quantity) from public.procurement_receipt_lines rl
                      where rl.organization_id=p_org_id and rl.order_line_id=l.id),0) < l.quantity
  ) into v_all_received;

  update public.procurement_orders
     set status=case when v_all_received then 'RECEIVED'::public.procurement_order_status
                     else 'PARTIALLY_RECEIVED'::public.procurement_order_status end,
         updated_by=auth.uid()
   where id=p_order_id;

  perform public.record_audit(
    p_org_id,
    case when v_all_received then 'PROCUREMENT_ORDER_RECEIVED' else 'PROCUREMENT_ORDER_PARTIALLY_RECEIVED' end,
    'procurement_receipt',v_receipt.id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key,'order_id',p_order_id,
                       'line_count',v_count,'final_receipt',v_all_received)
  );
  perform public.finish_procurement_command(
    p_org_id,p_idempotency_key,'RECEIVE_PROCUREMENT_ORDER',v_fingerprint,
    'procurement_receipt',v_receipt.id,to_jsonb(v_receipt)
  );
  return v_receipt;
end;
$$;

-- Capability gate: cancel_procurement_order -> procurement.manage
create or replace function public.cancel_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_from public.procurement_order_status; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'PROCUREMENT_CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','CANCEL_PROCUREMENT_ORDER','order_id',p_order_id,'reason',trim(p_reason)));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status in ('RECEIVED','CANCELLED') then raise exception 'PROCUREMENT_ORDER_NOT_CANCELLABLE'; end if;
  v_from:=v_order.status;
  update public.procurement_orders set status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_CANCELLED','procurement_order',v_order.id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key,'from',v_from,'received_facts_preserved',true));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'CANCEL_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

-- Capability gate: create_supplier -> procurement.manage
create or replace function public.create_supplier(
  p_org_id uuid,
  p_name text,
  p_category public.supplier_category,
  p_commercial_registration_number text,
  p_contact_name text,
  p_phone text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'SUPPLIER_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_SUPPLIER',
    'name', trim(p_name),
    'category', coalesce(p_category, 'GENERAL'::public.supplier_category),
    'commercial_registration_number', nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
    'phone', nullif(trim(coalesce(p_phone, '')), ''),
    'whatsapp', nullif(trim(coalesce(p_whatsapp, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  insert into public.suppliers (
    organization_id, name, category, commercial_registration_number,
    contact_name, phone, whatsapp, email, notes, created_by, updated_by
  ) values (
    p_org_id, trim(p_name), coalesce(p_category, 'GENERAL'),
    nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_whatsapp, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid()
  ) returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_CREATED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'category', v_supplier.category)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_SUPPLIER', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

-- Capability gate: update_supplier -> procurement.manage
create or replace function public.update_supplier(
  p_org_id uuid,
  p_supplier_id uuid,
  p_name text,
  p_category public.supplier_category,
  p_commercial_registration_number text,
  p_contact_name text,
  p_phone text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'SUPPLIER_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'UPDATE_SUPPLIER', 'supplier_id', p_supplier_id,
    'name', trim(p_name), 'category', coalesce(p_category, 'GENERAL'::public.supplier_category),
    'commercial_registration_number', nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
    'phone', nullif(trim(coalesce(p_phone, '')), ''),
    'whatsapp', nullif(trim(coalesce(p_whatsapp, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id
   for update;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.suppliers set
    name = trim(p_name),
    category = coalesce(p_category, 'GENERAL'),
    commercial_registration_number = nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    contact_name = nullif(trim(coalesce(p_contact_name, '')), ''),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    whatsapp = nullif(trim(coalesce(p_whatsapp, '')), ''),
    email = nullif(trim(coalesce(p_email, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = p_supplier_id
  returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_UPDATED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'UPDATE_SUPPLIER', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

-- Capability gate: set_supplier_status -> procurement.manage
create or replace function public.set_supplier_status(
  p_org_id uuid,
  p_supplier_id uuid,
  p_status public.supplier_status,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
  v_from public.supplier_status;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'SUPPLIER_STATUS_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'SET_SUPPLIER_STATUS', 'supplier_id', p_supplier_id, 'status', p_status
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id
   for update;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_supplier.status = p_status then
    raise exception 'SUPPLIER_ALREADY_IN_STATUS';
  end if;
  v_from := v_supplier.status;

  update public.suppliers
     set status = p_status, updated_by = auth.uid()
   where id = p_supplier_id
  returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_STATUS_CHANGED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'from', v_from, 'to', p_status)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'SET_SUPPLIER_STATUS', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

-- Capability gate: record_staff_attendance -> attendance.record
create or replace function public.record_staff_attendance(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_assignment_id uuid,
  p_attendance_date date,
  p_shift public.staff_shift,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_break_minutes integer,
  p_status public.attendance_status,
  p_wage_method public.compensation_method,
  p_wage_rate numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_event public.events;
  v_fingerprint text;
  v_replay jsonb;
  v_hours numeric(6,3) := 0;
  v_earned numeric(14,3) := 0;
  v_break integer := coalesce(p_break_minutes, 0);
  v_assignment_id uuid := p_assignment_id;
  v_assignment_count integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_wage_rate(p_wage_rate);
  if v_break < 0 then
    raise exception 'INVALID_BREAK_MINUTES';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_STAFF_ATTENDANCE',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'assignment_id', p_assignment_id,
    'attendance_date', p_attendance_date,
    'shift', p_shift,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'break_minutes', v_break,
    'status', p_status,
    'wage_method', p_wage_method,
    'wage_rate', p_wage_rate::text,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_CANCELLED';
  end if;

  if v_assignment_id is null then
    select count(*)::int
      into v_assignment_count
      from public.event_staff_assignments
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE';
    if v_assignment_count = 0 then
      raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_assignment_count > 1 then
      raise exception 'ASSIGNMENT_REQUIRED' using errcode = '22023';
    end if;
    select id
      into strict v_assignment_id
      from public.event_staff_assignments
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE';
  elsif not exists (
    select 1
      from public.event_staff_assignments
     where organization_id = p_org_id
       and id = v_assignment_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE'
  ) then
    raise exception 'ASSIGNMENT_MISMATCH' using errcode = '23503';
  end if;

  -- Validate request semantics before reporting a business-state conflict.
  if p_status = 'ABSENT' then
    if p_check_in is not null or p_check_out is not null then
      raise exception 'ABSENT_HAS_NO_TIMES';
    end if;
  else
    if p_check_in is null or p_check_out is null then
      raise exception 'ATTENDANCE_REQUIRES_TIMES';
    end if;
    if p_check_out <= p_check_in then
      raise exception 'CHECKOUT_BEFORE_CHECKIN';
    end if;
    if round(extract(epoch from (p_check_out - p_check_in))::numeric, 0) < v_break * 60 then
      raise exception 'BREAK_EXCEEDS_SHIFT' using errcode = '22023';
    end if;
    v_hours := round(
      (round(extract(epoch from (p_check_out - p_check_in))::numeric, 0)
        - v_break * 60) / 3600.0, 3
    );
  end if;

  -- Serialize different request keys targeting the same business slot only
  -- after the request itself is known to be valid.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_org_id::text || ':' || p_event_id::text || ':' || p_staff_member_id::text ||
      ':' || p_attendance_date::text || ':' || p_shift::text,
      3
    )
  );
  if exists (
    select 1
      from public.staff_attendance
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and attendance_date = p_attendance_date
       and shift = p_shift
       and status <> 'VOIDED'
  ) then
    raise exception 'ATTENDANCE_SLOT_ALREADY_RECORDED' using errcode = '23505';
  end if;

  v_earned := public.compute_earned_amount(
    p_wage_method, p_wage_rate, p_check_in, p_check_out, v_break
  );
  if p_status = 'ABSENT' then
    v_earned := 0;
  end if;

  insert into public.staff_attendance (
    organization_id, event_id, staff_member_id, assignment_id, attendance_date,
    shift, check_in, check_out, break_minutes, hours_worked, status,
    wage_method, wage_rate, earned_amount, notes, recorded_by,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, v_assignment_id, p_attendance_date,
    p_shift, p_check_in, p_check_out, v_break, v_hours, p_status,
    p_wage_method, p_wage_rate, v_earned,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ATTENDANCE_RECORDED', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'assignment_id', v_assignment_id,
      'shift', p_shift,
      'status', p_status,
      'hours_worked', v_hours::text,
      'earned_amount', v_earned::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_STAFF_ATTENDANCE', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: void_staff_attendance -> attendance.record
create or replace function public.void_staff_attendance(
  p_org_id uuid,
  p_attendance_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_STAFF_ATTENDANCE',
    'attendance_id', p_attendance_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_row
    from public.staff_attendance
   where organization_id = p_org_id and id = p_attendance_id
   for update;
  if not found then
    raise exception 'ATTENDANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'ATTENDANCE_ALREADY_VOIDED';
  end if;

  update public.staff_attendance
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_attendance_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ATTENDANCE_VOIDED', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', v_row.event_id,
      'staff_member_id', v_row.staff_member_id,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ATTENDANCE', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: clock_staff_in -> attendance.record
create or replace function public.clock_staff_in(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_assignment_id uuid,
  p_shift public.staff_shift,
  p_notes text,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_event public.events;
  v_assignment public.event_staff_assignments;
  v_staff public.staff_members;
  v_fingerprint text;
  v_replay jsonb;
  v_assignment_id uuid := p_assignment_id;
  v_assignment_count integer;
  v_now timestamptz := clock_timestamp();
  v_date date;
  v_shift public.staff_shift;
  v_hour integer;
  v_method public.compensation_method;
  v_rate numeric(12,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
  end if;

  v_date := (v_now at time zone 'Asia/Muscat')::date;
  v_hour := extract(hour from (v_now at time zone 'Asia/Muscat'))::integer;
  v_shift := coalesce(
    p_shift,
    case when v_hour < 16 then 'MORNING'::public.staff_shift
         else 'EVENING'::public.staff_shift end
  );

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_IN',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'assignment_id', p_assignment_id,
    'shift', v_shift,
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'evidence_path', p_evidence_path
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_CANCELLED';
  end if;

  if v_assignment_id is null then
    select count(*)::int, (array_agg(id))[1]
      into v_assignment_count, v_assignment_id
      from public.event_staff_assignments
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE';
    if v_assignment_count = 0 then
      raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_assignment_count > 1 then
      raise exception 'ASSIGNMENT_REQUIRED' using errcode = '22023';
    end if;
  elsif not exists (
    select 1
      from public.event_staff_assignments
     where organization_id = p_org_id
       and id = v_assignment_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE'
  ) then
    raise exception 'ASSIGNMENT_MISMATCH' using errcode = '23503';
  end if;

  select * into v_assignment
    from public.event_staff_assignments
   where organization_id = p_org_id and id = v_assignment_id;
  select * into v_staff
    from public.staff_members
   where organization_id = p_org_id and id = p_staff_member_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_method := coalesce(v_assignment.compensation_method, v_staff.default_compensation_method, 'PER_EVENT'::public.compensation_method);
  v_rate := coalesce(v_assignment.rate, v_staff.default_rate, 0);
  perform public.assert_wage_rate(v_rate);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_org_id::text || ':' || p_event_id::text || ':' || p_staff_member_id::text ||
      ':' || v_date::text || ':' || v_shift::text,
      3
    )
  );
  if exists (
    select 1
      from public.staff_attendance
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and attendance_date = v_date
       and shift = v_shift
       and status <> 'VOIDED'
  ) then
    raise exception 'ATTENDANCE_SLOT_ALREADY_RECORDED' using errcode = '23505';
  end if;

  insert into public.staff_attendance (
    organization_id, event_id, staff_member_id, assignment_id, attendance_date,
    shift, check_in, check_out, break_minutes, hours_worked, status,
    wage_method, wage_rate, earned_amount, notes, recorded_by,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, v_assignment_id, v_date,
    v_shift, v_now, null, 0, 0, 'PRESENT',
    v_method, v_rate, 0,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  -- Link the selfie in the SAME transaction: a missing/failed upload aborts
  -- the whole punch (no verified attendance without evidence).
  perform public.link_evidence(
    p_org_id, 'ATTENDANCE_CHECKIN', 'staff_attendance', v_row.id,
    p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
  );

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_IN', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'shift', v_shift,
      'selfie', p_evidence_path
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_IN', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: clock_staff_out -> attendance.record
create or replace function public.clock_staff_out(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_notes text,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_fingerprint text;
  v_replay jsonb;
  v_now timestamptz := clock_timestamp();
  v_hours numeric(6,3) := 0;
  v_earned numeric(14,3) := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_OUT',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'evidence_path', p_evidence_path
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_row
    from public.staff_attendance
   where organization_id = p_org_id
     and event_id = p_event_id
     and staff_member_id = p_staff_member_id
     and status <> 'VOIDED'
     and status <> 'ABSENT'
     and check_in is not null
     and check_out is null
   order by check_in desc
   limit 1
   for update;
  if not found then
    raise exception 'CLOCK_IN_REQUIRED';
  end if;
  if v_now <= v_row.check_in then
    raise exception 'CHECKOUT_BEFORE_CHECKIN';
  end if;

  v_hours := round(
    (round(extract(epoch from (v_now - v_row.check_in))::numeric, 0)) / 3600.0, 3
  );
  v_earned := public.compute_earned_amount(
    v_row.wage_method, v_row.wage_rate, v_row.check_in, v_now, v_row.break_minutes
  );

  update public.staff_attendance
     set check_out = v_now,
         hours_worked = v_hours,
         earned_amount = v_earned,
         notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes)
   where id = v_row.id
   returning * into v_row;

  perform public.link_evidence(
    p_org_id, 'ATTENDANCE_CHECKOUT', 'staff_attendance', v_row.id,
    p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
  );

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_OUT', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'hours_worked', v_hours::text,
      'earned_amount', v_earned::text,
      'selfie', p_evidence_path
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_OUT', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: record_customer_payment -> payment.record
create or replace function public.record_customer_payment(
  p_org_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_reference text,
  p_notes text,
  p_paid_at timestamptz,
  p_idempotency_key uuid
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_event public.events;
  v_fingerprint text;
  v_replay jsonb;
  v_paid numeric;
  v_revenue numeric;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payment.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_CUSTOMER_PAYMENT',
    'event_id', p_event_id,
    'amount', p_amount::text,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'paid_at', p_paid_at
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_NOT_PAYABLE';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'PAYMENT_REQUIRES_ACCEPTED_QUOTATION';
  end if;

  select total_selling into v_revenue
    from public.quotations
   where organization_id = p_org_id and id = v_event.accepted_quotation_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.customer_payments
   where organization_id = p_org_id and event_id = p_event_id and status = 'RECORDED';
  if v_paid + p_amount > v_revenue then
    raise exception 'OVERPAYMENT_EXCEEDS_ACCEPTED' using errcode = 'P0001';
  end if;

  insert into public.customer_payments (
    organization_id, event_id, amount, payment_method, reference, notes,
    paid_at, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_amount, p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(p_paid_at, now()), auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_payment;

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_RECORDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'amount', p_amount::text,
      'payment_method', p_payment_method
    )
  );

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- Capability gate: void_customer_payment -> payment.void
create or replace function public.void_customer_payment(
  p_org_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payment.void') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'PAYMENT_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_CUSTOMER_PAYMENT',
    'payment_id', p_payment_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_payment
    from public.customer_payments
   where organization_id = p_org_id and id = p_payment_id
   for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'PAYMENT_ALREADY_VOIDED';
  end if;

  update public.customer_payments
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payment_id
   returning * into v_payment;

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_VOIDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', v_payment.event_id,
      'amount', v_payment.amount::text,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- Capability gate: create_event_invoice -> invoice.manage
create or replace function public.create_event_invoice(
  p_org_id uuid,
  p_event_id uuid,
  p_invoice_number text,
  p_due_at timestamptz,
  p_total_amount numeric,
  p_installments jsonb,
  p_note text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_invoice public.invoices;
  v_existing integer;
  v_sum numeric(14,3) := 0;
  v_item jsonb;
  v_kind text;
  v_due date;
  v_prev_due date;
  v_amount numeric(14,3);
  v_len integer;
  v_seq integer;
  v_quote_total numeric(14,3);
  v_pre_vat_total numeric(14,3);
  v_vat_registered boolean;
  v_vat_percent numeric(12,3);
  v_vat_amount numeric(14,3);
  v_vat_reg text;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'invoice.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_total_amount);
  if nullif(trim(coalesce(p_invoice_number, '')), '') is null then
    raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) < 2 then
    raise exception 'INVOICE_INSTALLMENTS_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_EVENT_INVOICE',
    'event_id', p_event_id,
    'invoice_number', trim(p_invoice_number),
    'due_at', p_due_at,
    'total_amount', p_total_amount::text,
    'installments', p_installments,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_event_id::text, 1)
  );

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_CANCELLED';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;

  select q.total_selling::numeric(14,3),
         q.pre_vat_total::numeric(14,3),
         coalesce(q.vat_registered, false),
         coalesce(q.vat_percent, 0),
         coalesce(q.vat_amount, 0),
         q.vat_registration_number
    into v_quote_total, v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg
    from public.quotations q
   where q.organization_id = p_org_id
     and q.id = v_event.accepted_quotation_id
     and q.status in ('ACCEPTED','CONVERTED');
  if not found then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if v_quote_total <> p_total_amount then
    raise exception 'INVOICE_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  select count(*) into v_existing
    from public.invoices
   where organization_id = p_org_id
     and event_id = p_event_id
     and status = 'ISSUED';
  if v_existing > 0 then
    raise exception 'INVOICE_ALREADY_EXISTS' using errcode = '23505';
  end if;

  v_len := jsonb_array_length(p_installments);
  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    if v_item ->> 'seq' is null then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;
    v_seq := (v_item ->> 'seq')::integer;
    if v_seq <> i then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;

    v_kind := v_item ->> 'kind';
    if (i = 0 and v_kind <> 'DEPOSIT')
       or (i = v_len - 1 and v_kind <> 'FINAL')
       or (i > 0 and i < v_len - 1 and v_kind <> 'INSTALLMENT') then
      raise exception 'INVALID_INSTALLMENT_KIND' using errcode = '22023';
    end if;

    if v_item ->> 'due_date' is null then
      raise exception 'INSTALLMENT_DUE_DATE_REQUIRED' using errcode = '22023';
    end if;
    v_due := (v_item ->> 'due_date')::date;
    if v_prev_due is not null and v_due < v_prev_due then
      raise exception 'INSTALLMENT_DATES_OUT_OF_ORDER' using errcode = '22023';
    end if;
    v_prev_due := v_due;

    if v_item ->> 'amount' is null then
      raise exception 'INVALID_INSTALLMENT_AMOUNT' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amount')::numeric;
    perform public.assert_wage_rate(v_amount);
    v_sum := v_sum + v_amount;
  end loop;

  if v_sum <> p_total_amount then
    raise exception 'INSTALLMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.invoices (
    organization_id, event_id, quotation_id, invoice_number, due_at,
    total_amount, pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number,
    note, created_by
  ) values (
    p_org_id, p_event_id, v_event.accepted_quotation_id,
    trim(p_invoice_number), p_due_at, p_total_amount,
    v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  ) returning * into v_invoice;

  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    insert into public.invoice_installments (
      organization_id, invoice_id, seq, kind, due_date, amount
    ) values (
      p_org_id, v_invoice.id, (v_item ->> 'seq')::integer,
      (v_item ->> 'kind')::public.invoice_installment_kind,
      (v_item ->> 'due_date')::date, (v_item ->> 'amount')::numeric(14,3)
    );
  end loop;

  perform public.record_audit(
    p_org_id, 'INVOICE_ISSUED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'invoice_number', trim(p_invoice_number),
      'total_amount', p_total_amount::text,
      'pre_vat_total', v_pre_vat_total::text,
      'vat_amount', v_vat_amount::text
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CREATE_EVENT_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- Capability gate: void_invoice -> invoice.manage
create or replace function public.void_invoice(
  p_org_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'invoice.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_INVOICE',
    'invoice_id', p_invoice_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
  end if;

  select * into v_invoice
    from public.invoices
   where organization_id = p_org_id and id = p_invoice_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'CANCELLED' then
    raise exception 'INVOICE_ALREADY_CANCELLED';
  end if;

  update public.invoice_installments
     set status = 'CANCELLED'
   where organization_id = p_org_id
     and invoice_id = p_invoice_id
     and status = 'PENDING';
  update public.invoices
     set status = 'CANCELLED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_invoice_id
   returning * into v_invoice;

  perform public.record_audit(
    p_org_id, 'INVOICE_CANCELLED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- Capability gate: record_event_expense -> finance.manage
create or replace function public.record_event_expense(
  p_org_id uuid,
  p_event_id uuid,
  p_category public.expense_category,
  p_amount numeric,
  p_expense_date date,
  p_description text,
  p_payment_method public.payment_method default null,
  p_payee text default null,
  p_reference text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.event_expenses;
  v_event public.events;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if length(trim(coalesce(p_description, ''))) = 0 then
    raise exception 'EXPENSE_DESCRIPTION_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_EVENT_EXPENSE',
    'event_id', p_event_id,
    'category', p_category,
    'amount', p_amount::text,
    'expense_date', p_expense_date,
    'description', trim(p_description),
    'payment_method', p_payment_method,
    'payee', nullif(trim(coalesce(p_payee, '')), ''),
    'reference', nullif(trim(coalesce(p_reference, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_expenses, v_replay);
  end if;

  select * into v_event from public.events
   where organization_id = p_org_id and id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_event.status = 'CANCELLED' then raise exception 'EVENT_NOT_EXPENSABLE'; end if;

  insert into public.event_expenses (
    organization_id, event_id, category, amount, expense_date, description,
    payment_method, payee, reference, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_category, p_amount, p_expense_date, trim(p_description),
    p_payment_method, nullif(trim(coalesce(p_payee, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''), auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_expense;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_EVENT_EXPENSE', v_fingerprint,
    'event_expense', v_expense.id, to_jsonb(v_expense)
  );
  perform public.record_audit(p_org_id, 'EVENT_EXPENSE_RECORDED', 'event_expense', v_expense.id::text,
    jsonb_build_object('event_id', p_event_id, 'category', p_category, 'amount', p_amount::text));
  return v_expense;
end;
$$;

-- Capability gate: void_event_expense -> finance.manage
create or replace function public.void_event_expense(
  p_org_id uuid,
  p_expense_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.event_expenses;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'EXPENSE_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_EVENT_EXPENSE', 'expense_id', p_expense_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_expenses, v_replay);
  end if;

  select * into v_expense from public.event_expenses
   where organization_id = p_org_id and id = p_expense_id for update;
  if not found then raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_expense.status = 'VOIDED' then raise exception 'EXPENSE_ALREADY_VOIDED'; end if;

  update public.event_expenses set
    status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_expense_id returning * into v_expense;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_EVENT_EXPENSE', v_fingerprint,
    'event_expense', v_expense.id, to_jsonb(v_expense)
  );
  perform public.record_audit(p_org_id, 'EVENT_EXPENSE_VOIDED', 'event_expense', v_expense.id::text,
    jsonb_build_object('reason', trim(p_reason)));
  return v_expense;
end;
$$;

-- Capability gate: close_event_financially -> finance.manage
create or replace function public.close_event_financially(
  p_org_id uuid,
  p_event_id uuid,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_financial_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.event_financial_closures;
  v_fin public.event_finance_summaries;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOSE_EVENT_FINANCIALLY', 'event_id', p_event_id,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_financial_closures, v_replay);
  end if;

  -- Lock the event and re-verify readiness INSIDE the transaction.
  perform 1 from public.events where organization_id = p_org_id and id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Double-close guard: an active closure already exists.
  if exists (
    select 1 from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null
  ) then
    select * into v_closure from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null;
    return v_closure;
  end if;

  select * into v_fin from public.event_finance_summaries
   where organization_id = p_org_id and event_id = p_event_id;
  if not found or coalesce(v_fin.accepted_revenue, 0) <= 0 then
    raise exception 'FINANCIAL_CLOSE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if coalesce(v_fin.outstanding_balance, 0) > 0 then
    raise exception 'FINANCIAL_CLOSE_OUTSTANDING_BALANCE' using errcode = '23514';
  end if;

  insert into public.event_financial_closures (
    organization_id, event_id, closed_at, closed_by, close_note,
    revenue_at_close, collected_at_close, outstanding_at_close,
    costs_at_close, profit_at_close, margin_at_close
  ) values (
    p_org_id, p_event_id, now(), auth.uid(),
    nullif(trim(coalesce(p_note, '')), ''),
    v_fin.accepted_revenue, v_fin.amount_paid, v_fin.outstanding_balance,
    v_fin.actual_cost, v_fin.actual_profit, v_fin.margin_percent
  ) returning * into v_closure;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CLOSE_EVENT_FINANCIALLY', v_fingerprint,
    'event_financial_closure', v_closure.id, to_jsonb(v_closure)
  );
  perform public.record_audit(p_org_id, 'EVENT_FINANCIALLY_CLOSED', 'event', p_event_id::text,
    jsonb_build_object('closure_id', v_closure.id, 'profit', v_closure.profit_at_close::text,
      'revenue', v_closure.revenue_at_close::text));
  return v_closure;
end;
$$;

-- Capability gate: reopen_event_financially -> finance.manage
create or replace function public.reopen_event_financially(
  p_org_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_financial_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.event_financial_closures;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REOPEN_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'REOPEN_EVENT_FINANCIALLY', 'event_id', p_event_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_financial_closures, v_replay);
  end if;

  select * into v_closure from public.event_financial_closures
   where organization_id = p_org_id and event_id = p_event_id and reopened_at is null
   for update;
  if not found then raise exception 'EVENT_NOT_FINANCIALLY_CLOSED' using errcode = 'P0002'; end if;

  update public.event_financial_closures set
    reopened_at = now(), reopened_by = auth.uid(), reopen_reason = trim(p_reason)
  where id = v_closure.id
  returning * into v_closure;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'REOPEN_EVENT_FINANCIALLY', v_fingerprint,
    'event_financial_closure', v_closure.id, to_jsonb(v_closure)
  );
  perform public.record_audit(p_org_id, 'EVENT_FINANCIALLY_REOPENED', 'event', p_event_id::text,
    jsonb_build_object('closure_id', v_closure.id, 'reason', trim(p_reason)));
  return v_closure;
end;
$$;

-- Capability gate: record_staff_advance -> payroll.pay
create or replace function public.record_staff_advance(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_advance_date is null then
    raise exception 'ADVANCE_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_STAFF_ADVANCE',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'advance_date', p_advance_date,
    'reason', nullif(trim(coalesce(p_reason, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  insert into public.staff_advances (
    organization_id, staff_member_id, amount, advance_date, reason,
    recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_amount, p_advance_date,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_RECORDED', 'staff_advance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: void_staff_advance -> payroll.pay
create or replace function public.void_staff_advance(
  p_org_id uuid,
  p_advance_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_STAFF_ADVANCE',
    'advance_id', p_advance_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  select * into v_row
    from public.staff_advances
   where organization_id = p_org_id and id = p_advance_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'ADVANCE_ALREADY_VOIDED';
  end if;

  update public.staff_advances
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_advance_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_VOIDED', 'staff_advance', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: record_host_payout_multi -> payroll.pay
create or replace function public.record_host_payout_multi(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_payout_date date,
  p_payment_method public.payment_method,
  p_reference text,
  p_reason text,
  p_allocations jsonb,
  p_evidence_path text default null,
  p_evidence_file_name text default null,
  p_evidence_mime_type text default null,
  p_evidence_size_bytes bigint default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.host_payouts;
  v_fingerprint text;
  v_replay jsonb;
  v_len integer;
  v_item jsonb;
  v_event_id uuid;
  v_amount numeric;
  v_sum numeric(12,3) := 0;
  v_alloc_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payout_date is null then
    raise exception 'PAYOUT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'PAYOUT_ALLOCATIONS_INVALID' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_HOST_PAYOUT_MULTI',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'payout_date', p_payout_date,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'allocations', p_allocations,
    'evidence_path', nullif(trim(coalesce(p_evidence_path, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  -- Serialize payouts for the same host so the allocation total can never
  -- race a concurrent payout.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_staff_member_id::text, 2)
  );

  v_len := jsonb_array_length(p_allocations);
  for i in 0..v_len - 1 loop
    v_item := p_allocations -> i;
    v_event_id := nullif(v_item ->> 'event_id', '')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    if v_event_id is null then
      raise exception 'PAYOUT_ALLOCATION_EVENT_REQUIRED' using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'PAYOUT_ALLOCATION_AMOUNT_INVALID' using errcode = '22023';
    end if;
    -- Precision check on the RAW value before it is ever cast to numeric(12,3),
    -- so a 4-decimal JSON amount is rejected rather than silently rounded.
    if round(v_amount, 3) <> v_amount then
      raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
    end if;
    if v_amount > 999999999.999 then
      raise exception 'OMR_AMOUNT_OUT_OF_RANGE' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.events e
       where e.organization_id = p_org_id and e.id = v_event_id
    ) then
      raise exception 'PAYOUT_ALLOCATION_EVENT_NOT_IN_ORG' using errcode = '23503';
    end if;
    v_sum := v_sum + v_amount;
    v_alloc_count := v_alloc_count + 1;
  end loop;

  if v_alloc_count > 0 and round(v_sum, 3) <> round(p_amount, 3) then
    raise exception 'PAYOUT_ALLOCATION_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.host_payouts (
    organization_id, staff_member_id, event_id, amount, payout_date,
    payment_method, reference, reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, null, p_amount, p_payout_date,
    p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  for i in 0..v_len - 1 loop
    v_item := p_allocations -> i;
    insert into public.host_payout_allocations (
      organization_id, payout_id, event_id, amount
    ) values (
      p_org_id, v_row.id,
      nullif(v_item ->> 'event_id', '')::uuid,
      (v_item ->> 'amount')::numeric(12,3)
    );
  end loop;

  -- Receipt is evidence attached to the payout (optional; explicit when absent).
  if nullif(trim(coalesce(p_evidence_path, '')), '') is not null then
    perform public.link_evidence(
      p_org_id, 'HOST_PAYOUT_RECEIPT', 'host_payout', v_row.id,
      p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
    );
  end if;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_RECORDED', 'host_payout', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text,
      'allocations', p_allocations
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_HOST_PAYOUT_MULTI', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: void_host_payout -> payroll.pay
create or replace function public.void_host_payout(
  p_org_id uuid,
  p_payout_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.host_payouts;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_HOST_PAYOUT',
    'payout_id', p_payout_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  select * into v_row
    from public.host_payouts
   where organization_id = p_org_id and id = p_payout_id
   for update;
  if not found then
    raise exception 'PAYOUT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'PAYOUT_ALREADY_VOIDED';
  end if;

  update public.host_payouts
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payout_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_VOIDED', 'host_payout', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_HOST_PAYOUT', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Capability gate: save_organization_settings -> settings.manage
create or replace function public.save_organization_settings(
  p_org_id uuid,
  p_name_en text default null,
  p_logo_url text default null,
  p_primary_color text default null,
  p_accent_color text default null,
  p_phone_primary text default null,
  p_phone_secondary text default null,
  p_whatsapp text default null,
  p_email text default null,
  p_commercial_registration text default null,
  p_postal_code text default null,
  p_po_box text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_region text default null,
  p_country text default null,
  p_document_terms text default null,
  p_document_footer text default null,
  p_quotation_number_prefix text default null,
  p_invoice_number_prefix text default null,
  p_event_number_prefix text default null,
  p_manager_name text default null,
  p_manager_title text default null,
  p_vat_registered boolean default null,
  p_vat_percent numeric default null,
  p_vat_registration_number text default null
)
returns public.organization_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.organization_settings;
  v_prefix_quote text;
  v_prefix_invoice text;
  v_prefix_event text;
begin
  if auth.uid() is null
     or not public.has_permission(p_org_id, 'settings.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_vat_percent is not null and (p_vat_percent < 0 or p_vat_percent > 100) then
    raise exception 'INVALID_VAT_PERCENT' using errcode = '22023';
  end if;

  v_prefix_quote  := nullif(trim(coalesce(p_quotation_number_prefix, '')), '');
  v_prefix_invoice := nullif(trim(coalesce(p_invoice_number_prefix, '')), '');
  v_prefix_event  := nullif(trim(coalesce(p_event_number_prefix, '')), '');

  insert into public.organization_settings (
    organization_id, name_en, logo_url, primary_color, accent_color,
    phone_primary, phone_secondary, whatsapp, email,
    commercial_registration, postal_code, po_box, address_line1, city, region, country,
    document_terms, document_footer,
    quotation_number_prefix, invoice_number_prefix, event_number_prefix,
    manager_name, manager_title,
    vat_registered, vat_percent, vat_registration_number
  ) values (
    p_org_id,
    nullif(trim(p_name_en), ''),
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_primary_color), ''),
    nullif(trim(p_accent_color), ''),
    nullif(trim(p_phone_primary), ''),
    nullif(trim(p_phone_secondary), ''),
    nullif(trim(p_whatsapp), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_commercial_registration), ''),
    nullif(trim(p_postal_code), ''),
    nullif(trim(p_po_box), ''),
    nullif(trim(p_address_line1), ''),
    nullif(trim(p_city), ''),
    nullif(trim(p_region), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_document_terms), ''),
    nullif(trim(p_document_footer), ''),
    coalesce(v_prefix_quote, 'QT'),
    coalesce(v_prefix_invoice, 'INV'),
    coalesce(v_prefix_event, 'EV'),
    nullif(trim(p_manager_name), ''),
    nullif(trim(p_manager_title), ''),
    coalesce(p_vat_registered, false),
    coalesce(p_vat_percent, 5.000),
    nullif(trim(coalesce(p_vat_registration_number, '')), '')
  )
  on conflict (organization_id) do update set
    name_en = excluded.name_en,
    logo_url = excluded.logo_url,
    primary_color = excluded.primary_color,
    accent_color = excluded.accent_color,
    phone_primary = excluded.phone_primary,
    phone_secondary = excluded.phone_secondary,
    whatsapp = excluded.whatsapp,
    email = excluded.email,
    commercial_registration = excluded.commercial_registration,
    postal_code = excluded.postal_code,
    po_box = excluded.po_box,
    address_line1 = excluded.address_line1,
    city = excluded.city,
    region = excluded.region,
    country = excluded.country,
    document_terms = excluded.document_terms,
    document_footer = excluded.document_footer,
    quotation_number_prefix = excluded.quotation_number_prefix,
    invoice_number_prefix = excluded.invoice_number_prefix,
    event_number_prefix = excluded.event_number_prefix,
    manager_name = excluded.manager_name,
    manager_title = excluded.manager_title,
    vat_registered = coalesce(p_vat_registered, public.organization_settings.vat_registered),
    vat_percent = coalesce(p_vat_percent, public.organization_settings.vat_percent),
    vat_registration_number = case
      when p_vat_registration_number is null then public.organization_settings.vat_registration_number
      else nullif(trim(p_vat_registration_number), '')
    end,
    updated_at = now()
  returning * into v_result;

  perform public.record_audit(
    p_org_id,
    'ORGANIZATION_SETTINGS_SAVED',
    'organization_settings',
    p_org_id::text,
    jsonb_build_object(
      'name_en', v_result.name_en,
      'phone_primary', v_result.phone_primary,
      'commercial_registration', v_result.commercial_registration,
      'vat_registered', v_result.vat_registered,
      'vat_percent', v_result.vat_percent::text
    )
  );

  return v_result;
end;
$$;

-- Capability gate: issue_quotation -> quotation.issue
create or replace function public.issue_quotation(
  p_org_id uuid, p_quotation_id uuid, p_terms text default null, p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare
  v public.quotations;
  v_subtotal numeric; v_cost numeric; v_discount numeric; v_grand numeric;
  v_fp text; v_replay jsonb;
  v_vat_registered boolean := false;
  v_vat_percent numeric(12,3) := 0;
  v_vat_amount numeric(14,3) := 0;
  v_vat_reg text;
begin
  if not public.has_permission(p_org_id, 'quotation.issue') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id,'terms',p_terms,'notes',p_notes));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status='ISSUED' then
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id)); return v;
  end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_ISSUE_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id) then raise exception 'EMPTY_QUOTATION'; end if;
  if exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id and pricing_method='PER_GUEST') and v.guest_count_snapshot is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  update public.quotation_lines l set total_selling=public.commercial_total(l.pricing_method,l.unit_selling_price,l.quantity,v.guest_count_snapshot),total_expected_cost=public.commercial_total(l.pricing_method,l.expected_unit_cost,l.quantity,v.guest_count_snapshot) where l.quotation_id=p_quotation_id;
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value) q;

  -- Authoritative VAT snapshot from organization settings. Scalar subqueries
  -- (not SELECT..INTO) so a missing settings row yields the safe defaults.
  v_vat_registered := coalesce((
    select s.vat_registered from public.organization_settings s
     where s.organization_id = p_org_id
  ), false);
  v_vat_percent := coalesce((
    select s.vat_percent from public.organization_settings s
     where s.organization_id = p_org_id
  ), 5.000);
  v_vat_reg := nullif(trim(coalesce((
    select s.vat_registration_number from public.organization_settings s
     where s.organization_id = p_org_id
  ), '')), '');
  v_vat_amount := case when v_vat_registered
    then round(v_grand * v_vat_percent / 100, 3) else 0 end;

  update public.quotations set
    quotation_number=coalesce(v.quotation_number, public.next_document_number(p_org_id,'QUOTATION',null)),
    series_id=coalesce(v.series_id, v.id),
    status='ISSUED', terms=p_terms, notes=coalesce(p_notes,notes),
    subtotal=v_subtotal, discount_amount=v_discount,
    pre_vat_total=v_grand,
    vat_registered=v_vat_registered,
    vat_percent=v_vat_percent,
    vat_amount=v_vat_amount,
    vat_registration_number=v_vat_reg,
    total_selling=v_grand + v_vat_amount,
    total_expected_cost=v_cost,
    total_expected_profit=(v_grand + v_vat_amount)-v_cost,
    issued_by=auth.uid(), issued_at=now()
   where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ISSUED','quotation',v.id::text,jsonb_build_object('total',(v_grand + v_vat_amount),'pre_vat_total',v_grand,'vat_amount',v_vat_amount,'quotation_number',v.quotation_number,'revision',v.revision));
  return v;
end$$;

-- Capability gate: accept_quotation -> quotation.issue
create or replace function public.accept_quotation(p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid default gen_random_uuid())
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.has_permission(p_org_id, 'quotation.issue') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.event_id is not null then raise exception 'USE_ACCEPT_EVENT_QUOTATION'; end if;
  if v.status='ACCEPTED' then
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ACCEPT_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id)); return v;
  end if;
  if v.status<>'ISSUED' then raise exception 'QUOTATION_ACCEPT_NOT_ALLOWED'; end if;
  update public.quotations set status='ACCEPTED',accepted_by=auth.uid(),accepted_at=now() where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ACCEPT_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ACCEPTED','quotation',v.id::text,'{}'::jsonb);
  return v;
end$$;

-- Capability gate: convert_quotation_to_event -> quotation.issue
create or replace function public.convert_quotation_to_event(
  p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid,
  p_start_at timestamptz default null,p_end_at timestamptz default null,
  p_venue_name text default null,p_guest_count int default null,p_event_title text default null
) returns public.events language plpgsql security definer set search_path='' as $$
declare v_q public.quotations; v_customer public.customers; v_event public.events; v_fp text; v_replay jsonb; v_start timestamptz; v_end timestamptz; v_venue text; v_guests int; v_title text; v_matches int:=0;
begin
  if not public.has_permission(p_org_id, 'quotation.issue') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id,'start_at',p_start_at,'end_at',p_end_at,'venue',p_venue_name,'guests',p_guest_count,'title',p_event_title));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v_event from public.events where organization_id=p_org_id and id=(v_replay->>'event_id')::uuid; return v_event; end if;
  select * into v_q from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_q.converted_event_id is not null then
    select * into v_event from public.events where organization_id=p_org_id and id=v_q.converted_event_id;
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'CONVERT_QUOTATION',v_fp,'event',v_event.id,jsonb_build_object('event_id',v_event.id)); return v_event;
  end if;
  if v_q.status<>'ACCEPTED' or v_q.event_id is not null then raise exception 'QUOTATION_NOT_ACCEPTED'; end if;
  if v_q.customer_id is not null then
    select * into v_customer from public.customers where organization_id=p_org_id and id=v_q.customer_id and is_active;
    if not found then raise exception 'CUSTOMER_NOT_IN_ORG'; end if;
  else
    if nullif(trim(coalesce(v_q.customer_phone_snapshot,'')),'') is not null then
      select count(*) into v_matches from public.customers c where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=nullif(trim(v_q.customer_phone_snapshot),'');
    end if;
    if v_matches=1 then
      select * into v_customer from public.customers c where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=nullif(trim(v_q.customer_phone_snapshot),'');
    else
      insert into public.customers(organization_id,name,phone,whatsapp,customer_type,notes)
      values(p_org_id,v_q.customer_name_snapshot,v_q.customer_phone_snapshot,v_q.prospect_whatsapp,case when v_q.prospect_company is null then 'INDIVIDUAL'::public.customer_type else 'COMPANY'::public.customer_type end,v_q.prospect_company) returning * into v_customer;
    end if;
  end if;
  v_start=coalesce(p_start_at,v_q.start_at_snapshot); if v_start is null then raise exception 'EVENT_DATE_REQUIRED'; end if;
  v_end=coalesce(p_end_at,v_q.end_at_snapshot,v_start+interval '4 hours'); if v_end<=v_start then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
  v_venue=coalesce(nullif(trim(coalesce(p_venue_name,'')),''),v_q.venue_snapshot); if v_venue is null then raise exception 'VENUE_REQUIRED'; end if;
  v_guests=coalesce(p_guest_count,v_q.guest_count_snapshot); if v_guests is null or v_guests<1 then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  v_title=coalesce(nullif(trim(coalesce(p_event_title,'')),''),v_q.event_title_snapshot,v_q.customer_name_snapshot);
  insert into public.events(organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,location_details,contact_name,contact_phone,status,accepted_quotation_id,idempotency_key,created_by,updated_by)
  values(p_org_id,v_customer.id,public.next_document_number(p_org_id,'EVENT','EV'),v_title,v_q.event_type_snapshot,v_start,v_end,v_guests,v_venue,v_q.location_snapshot,v_q.customer_name_snapshot,v_q.customer_phone_snapshot,'CONFIRMED',v_q.id,p_idempotency_key,auth.uid(),auth.uid()) returning * into v_event;
  insert into public.event_commercial_lines(organization_id,event_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order)
  select organization_id,v_event.id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order from public.quotation_lines where quotation_id=v_q.id;
  insert into public.event_status_history(organization_id,event_id,to_status,actor_id,reason) values(p_org_id,v_event.id,'CONFIRMED',auth.uid(),'QUOTATION_CONVERTED');
  update public.quotations set status='CONVERTED',customer_id=v_customer.id,converted_event_id=v_event.id,converted_at=now() where id=v_q.id returning * into v_q;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'CONVERT_QUOTATION',v_fp,'event',v_event.id,jsonb_build_object('event_id',v_event.id));
  perform public.record_audit(p_org_id,'QUOTATION_CONVERTED','event',v_event.id::text,jsonb_build_object('quotation_id',v_q.id,'customer_id',v_customer.id,'customer_reused',v_matches=1));
  return v_event;
end$$;

-- Capability gate: reject_quotation -> quotation.issue
create or replace function public.reject_quotation(
  p_org_id uuid,
  p_quotation_id uuid,
  p_reason text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.has_permission(p_org_id, 'quotation.issue') then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_fp := public.quotation_fingerprint(jsonb_build_object('quotation_id', p_quotation_id, 'reason', p_reason));
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id;
    return v;
  end if;
  select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status = 'REJECTED' then
    perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'REJECT_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
    return v;
  end if;
  if v.status <> 'ISSUED' then raise exception 'QUOTATION_REJECT_NOT_ALLOWED'; end if;
  update public.quotations set status = 'REJECTED', rejected_by = auth.uid(), rejected_at = now()
    where id = p_quotation_id returning * into v;
  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'REJECT_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
  perform public.record_audit(p_org_id, 'QUOTATION_REJECTED', 'quotation', v.id::text, jsonb_build_object('reason', p_reason));
  return v;
end;
$$;

-- Capability gate: expire_quotation -> quotation.issue
create or replace function public.expire_quotation(
  p_org_id uuid,
  p_quotation_id uuid,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.has_permission(p_org_id, 'quotation.issue') then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_fp := public.quotation_fingerprint(jsonb_build_object('quotation_id', p_quotation_id));
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id;
    return v;
  end if;
  select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status = 'EXPIRED' then
    perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'EXPIRE_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
    return v;
  end if;
  if v.status <> 'ISSUED' then raise exception 'QUOTATION_EXPIRE_NOT_ALLOWED'; end if;
  update public.quotations set status = 'EXPIRED', expired_by = auth.uid(), expired_at = now()
    where id = p_quotation_id returning * into v;
  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'EXPIRE_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
  perform public.record_audit(p_org_id, 'QUOTATION_EXPIRED', 'quotation', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

-- Capability gate: save_package -> catalog.manage (matches the packages/package_items RLS boundary)
create or replace function public.save_package(
  p_org_id uuid,
  p_package_id uuid,
  p_name text,
  p_name_en text default null,
  p_description text default null,
  p_status package_status default 'ACTIVE',
  p_base_guest_count int default null,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_item jsonb;
  v_catalog_item_id uuid;
  v_quantity numeric(12,3);
  v_seen uuid[];
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_permission(p_org_id, 'catalog.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'PACKAGE_NAME_REQUIRED';
  end if;

  if p_base_guest_count is not null and p_base_guest_count <= 0 then
    raise exception 'INVALID_BASE_GUEST_COUNT';
  end if;

  if p_package_id is null then
    insert into public.packages (organization_id, name, name_en, description, status, base_guest_count)
    values (p_org_id, trim(p_name), p_name_en, p_description, p_status, p_base_guest_count)
    returning id into v_package_id;
  else
    update public.packages
    set name = trim(p_name),
        name_en = p_name_en,
        description = p_description,
        status = p_status,
        base_guest_count = p_base_guest_count,
        updated_at = now()
    where id = p_package_id and organization_id = p_org_id
    returning id into v_package_id;

    if v_package_id is null then
      raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002';
    end if;

    delete from public.package_items where package_id = v_package_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if v_item ->> 'catalog_item_id' is null then
      raise exception 'INVALID_ITEM';
    end if;
    v_catalog_item_id := (v_item ->> 'catalog_item_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'INVALID_QUANTITY';
    end if;

    if v_catalog_item_id = any (v_seen) then
      raise exception 'DUPLICATE_CATALOG_ITEM';
    end if;
    v_seen := array_append(v_seen, v_catalog_item_id);

    if not exists (
      select 1 from public.catalog_items c
      where c.id = v_catalog_item_id and c.organization_id = p_org_id
    ) then
      raise exception 'CATALOG_ITEM_NOT_IN_ORG' using errcode = '23503';
    end if;

    insert into public.package_items (organization_id, package_id, catalog_item_id, quantity)
    values (p_org_id, v_package_id, v_catalog_item_id, v_quantity);
  end loop;

  perform public.record_audit(
    p_org_id,
    case when p_package_id is null then 'package.created' else 'package.updated' end,
    'package',
    v_package_id::text,
    jsonb_build_object('name', trim(p_name))
  );

  return v_package_id;
end;
$$;

-- ============================================================================
-- PART C: payroll read models re-gated from cost visibility to payroll.read.
--
-- The canonical payroll read surface has four models. Two of them
-- (staff_advances_summaries, host_payout_summaries) pre-date the 0048
-- security-advisor hardening, which wrapped every public view as a
-- security_invoker view over a definer _view_*() backing function. For those
-- two, the visibility gate lives inside the backing function, so this part
-- re-defines the backing functions with the payroll.read gate (identical
-- signature and body, only the predicate changes); the view wrappers and
-- their grants are untouched. The other two (host_event_payroll_summaries,
-- host_payout_allocation_summaries) were (re)created by 0076 after the 0048
-- wrap and remain plain views, so the views themselves are re-defined.
--
-- get_host_payroll_summary (the canonical host-wide payroll rollup used by
-- the payroll workspace and the host statement) is re-gated the same way.
-- ============================================================================
create or replace function public.get_host_payroll_summary(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid default null
)
returns table (
  staff_member_id uuid,
  event_id uuid,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  due_total numeric(14,3),
  paid_total numeric(14,3),
  late_total numeric(14,3),
  attendance_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_read_payroll(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  with totals as (
    select
      coalesce(sum(a.earned_amount) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      ), 0)::numeric(14,3) as earned,
      case when p_event_id is null then coalesce((
        select sum(adv.amount)
          from public.staff_advances adv
         where adv.organization_id = p_org_id
           and adv.staff_member_id = p_staff_member_id
           and adv.status = 'RECORDED'
      ), 0) else 0 end::numeric(14,3) as advances,
      coalesce((
        select sum(p.amount)
          from public.host_payouts p
         where p.organization_id = p_org_id
           and p.staff_member_id = p_staff_member_id
           and (p_event_id is null or p.event_id = p_event_id)
           and p.status = 'RECORDED'
      ), 0)::numeric(14,3)
      + coalesce((
        select sum(al.amount)
          from public.host_payout_allocations al
          join public.host_payouts ph
            on ph.organization_id = al.organization_id and ph.id = al.payout_id
         where al.organization_id = p_org_id
           and ph.staff_member_id = p_staff_member_id
           and (p_event_id is null or al.event_id = p_event_id)
           and ph.status = 'RECORDED'
      ), 0)::numeric(14,3) as payouts,
      count(a.id) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      )::int as attendance_count
    from public.staff_attendance a
    where a.organization_id = p_org_id
      and a.staff_member_id = p_staff_member_id
  )
  select
    p_staff_member_id,
    p_event_id,
    t.earned,
    t.advances,
    t.payouts,
    t.earned,
    (t.advances + t.payouts)::numeric(14,3),
    (t.earned - t.advances - t.payouts)::numeric(14,3),
    t.attendance_count
  from totals t;
end;
$$;

-- staff_advances_summaries: re-gate the 0048 backing function (view wrapper unchanged).
create or replace function public._view_staff_advances_summaries()
returns table (advance_id uuid, organization_id uuid, staff_member_id uuid, staff_name text, staff_type public.staff_type, amount numeric, advance_date date, reason text, status public.host_payment_status, recorded_by uuid, voided_by uuid, voided_at timestamptz, void_reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
select
  adv.id as advance_id,
  adv.organization_id,
  adv.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  adv.amount,
  adv.advance_date,
  adv.reason,
  adv.status,
  adv.recorded_by,
  adv.voided_by,
  adv.voided_at,
  adv.void_reason,
  adv.created_at
from public.staff_advances adv
join public.staff_members s
  on s.organization_id = adv.organization_id and s.id = adv.staff_member_id
where public.can_read_payroll(adv.organization_id)
$$;

-- host_payout_summaries: re-gate the 0048 backing function (view wrapper unchanged).
create or replace function public._view_host_payout_summaries()
returns table (payout_id uuid, organization_id uuid, staff_member_id uuid, staff_name text, staff_type public.staff_type, event_id uuid, event_number text, amount numeric, payout_date date, payment_method public.payment_method, reference text, reason text, status public.host_payment_status, recorded_by uuid, voided_by uuid, voided_at timestamptz, void_reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
select
  p.id as payout_id,
  p.organization_id,
  p.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  p.event_id,
  e.event_number,
  p.amount,
  p.payout_date,
  p.payment_method,
  p.reference,
  p.reason,
  p.status,
  p.recorded_by,
  p.voided_by,
  p.voided_at,
  p.void_reason,
  p.created_at
from public.host_payouts p
join public.staff_members s
  on s.organization_id = p.organization_id and s.id = p.staff_member_id
left join public.events e
  on e.organization_id = p.organization_id and e.id = p.event_id
where public.can_read_payroll(p.organization_id)
$$;

-- host_event_payroll_summaries: plain view (0076) re-gated on payroll.read.
create or replace view public.host_event_payroll_summaries as
select
  a.organization_id,
  a.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  a.event_id,
  e.event_number,
  e.title as event_title,
  count(*) filter (where a.status <> 'VOIDED')::int as attendance_count,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as earned_total,
  0::numeric(14,3) as advances_total,
  (
    coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
    + coalesce((
      select sum(al.amount) from public.host_payout_allocations al
       join public.host_payouts ph
         on ph.organization_id = al.organization_id and ph.id = al.payout_id
       where al.organization_id = a.organization_id
         and al.event_id = a.event_id
         and ph.staff_member_id = a.staff_member_id
         and ph.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as payouts_total,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as due_total,
  (
    coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
    + coalesce((
      select sum(al.amount) from public.host_payout_allocations al
       join public.host_payouts ph
         on ph.organization_id = al.organization_id and ph.id = al.payout_id
       where al.organization_id = a.organization_id
         and al.event_id = a.event_id
         and ph.staff_member_id = a.staff_member_id
         and ph.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as paid_total,
  (
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)
    - (
      coalesce((
        select sum(p.amount) from public.host_payouts p
         where p.organization_id = a.organization_id
           and p.staff_member_id = a.staff_member_id
           and p.event_id = a.event_id
           and p.status = 'RECORDED'
      ), 0)
      + coalesce((
        select sum(al.amount) from public.host_payout_allocations al
         join public.host_payouts ph
           on ph.organization_id = al.organization_id and ph.id = al.payout_id
         where al.organization_id = a.organization_id
           and al.event_id = a.event_id
           and ph.staff_member_id = a.staff_member_id
           and ph.status = 'RECORDED'
      ), 0)
    )
  )::numeric(14,3) as late_total
from public.staff_attendance a
join public.staff_members s
  on s.organization_id = a.organization_id and s.id = a.staff_member_id
join public.events e
  on e.organization_id = a.organization_id and e.id = a.event_id
where public.can_read_payroll(a.organization_id)
group by a.organization_id, a.staff_member_id, s.name, s.staff_type,
         a.event_id, e.event_number, e.title;
revoke all on table public.host_event_payroll_summaries from public, anon;
grant select on table public.host_event_payroll_summaries to authenticated;

-- host_payout_allocation_summaries: plain view (0076) re-gated on payroll.read.
create or replace view public.host_payout_allocation_summaries as
select
  al.id as allocation_id,
  al.organization_id,
  al.payout_id,
  p.staff_member_id,
  p.payout_date,
  p.status as payout_status,
  al.event_id,
  e.event_number,
  e.title as event_title,
  al.amount,
  al.created_at
from public.host_payout_allocations al
join public.host_payouts p
  on p.organization_id = al.organization_id and p.id = al.payout_id
left join public.events e
  on e.organization_id = al.organization_id and e.id = al.event_id
where public.can_read_payroll(al.organization_id);
revoke all on table public.host_payout_allocation_summaries from public, anon;
grant select on table public.host_payout_allocation_summaries to authenticated;

