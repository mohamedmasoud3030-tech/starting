-- ============================================================================
-- 0008 — Row Level Security + operational view + grants
-- Every business table has RLS enabled. Organization scoping is derived from
-- the authenticated user's ACTIVE membership in an ACTIVE organization
-- (never trusted from the client).
--
-- Sensitive financial separation: catalog_items.cost_price / internal_notes
-- are readable only by can_read_cost() roles (OWNER/MANAGER/ACCOUNTANT).
-- Operational members read the non-sensitive projection through the
-- catalog_items_operational view (SECURITY DEFINER, filtered by org).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Operational catalog projection (no cost_price / internal_notes).
-- SECURITY DEFINER (owner privileges) so it is not subject to the base
-- table's cost-gated SELECT policy; row scoping is enforced by the WHERE
-- clause against is_org_member() (which reads the caller's auth.uid()).
-- ---------------------------------------------------------------------------
create view public.catalog_items_operational as
  select
    ci.id,
    ci.organization_id,
    ci.category_id,
    ci.code,
    ci.name,
    ci.name_en,
    ci.description,
    ci.item_type,
    ci.unit,
    ci.pricing_method,
    ci.selling_price,
    ci.status,
    ci.sort_order,
    ci.created_at,
    ci.updated_at
  from public.catalog_items ci
  where public.is_org_member(ci.organization_id);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;

create policy "organizations_select_member" on public.organizations
  for select using (public.is_org_member(id));

-- No direct INSERT (create_organization RPC); no direct DELETE.

create policy "organizations_update_owner" on public.organizations
  for update using (public.has_org_role(id, array['OWNER'::app_role]))
  with check (public.has_org_role(id, array['OWNER'::app_role]));

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------
alter table public.organization_memberships enable row level security;

create policy "memberships_select_org_member" on public.organization_memberships
  for select using (public.is_org_member(organization_id));

create policy "memberships_write_owner" on public.organization_memberships
  for all
  using (public.has_org_role(organization_id, array['OWNER'::app_role]))
  with check (public.has_org_role(organization_id, array['OWNER'::app_role]));

-- ---------------------------------------------------------------------------
-- customers — write roles: OWNER / MANAGER / SUPERVISOR (per 04-security doc)
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;

create policy "customers_select_member" on public.customers
  for select using (public.is_org_member(organization_id));

create policy "customers_write_operational" on public.customers
  for all
  using (public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role, 'SUPERVISOR'::app_role]))
  with check (public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role, 'SUPERVISOR'::app_role]));

-- ---------------------------------------------------------------------------
-- catalog_categories — commercial config; no destructive delete (soft deactivate)
-- ---------------------------------------------------------------------------
alter table public.catalog_categories enable row level security;

create policy "catalog_categories_select_member" on public.catalog_categories
  for select using (public.is_org_member(organization_id));

create policy "catalog_categories_write_commercial" on public.catalog_categories
  for insert with check (public.can_manage_commercial(organization_id));

create policy "catalog_categories_update_commercial" on public.catalog_categories
  for update using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- No DELETE policy: categories use is_active soft-deactivation.

-- ---------------------------------------------------------------------------
-- catalog_items — cost is gated; operational members use the view.
-- ---------------------------------------------------------------------------
alter table public.catalog_items enable row level security;

create policy "catalog_items_select_cost_readers" on public.catalog_items
  for select using (public.can_read_cost(organization_id));

create policy "catalog_items_insert_commercial" on public.catalog_items
  for insert with check (public.can_manage_commercial(organization_id));

create policy "catalog_items_update_commercial" on public.catalog_items
  for update using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- No DELETE policy: items use status ACTIVE/INACTIVE lifecycle.

-- ---------------------------------------------------------------------------
-- packages / package_items — commercial config; template lines are replaced
-- transactionally by save_package(). No destructive client DELETE.
-- ---------------------------------------------------------------------------
alter table public.packages enable row level security;

create policy "packages_select_member" on public.packages
  for select using (public.is_org_member(organization_id));

create policy "packages_insert_commercial" on public.packages
  for insert with check (public.can_manage_commercial(organization_id));

create policy "packages_update_commercial" on public.packages
  for update using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

alter table public.package_items enable row level security;

create policy "package_items_select_member" on public.package_items
  for select using (public.is_org_member(organization_id));

create policy "package_items_insert_commercial" on public.package_items
  for insert with check (public.can_manage_commercial(organization_id));

create policy "package_items_update_commercial" on public.package_items
  for update using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- No DELETE policy on packages/package_items.

-- ---------------------------------------------------------------------------
-- audit_events — append-only (record_audit internal); READ restricted to
-- OWNER/MANAGER.
-- ---------------------------------------------------------------------------
alter table public.audit_events enable row level security;

create policy "audit_events_select_admins" on public.audit_events
  for select using (
    public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role])
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- anon (unauthenticated) gets nothing on business tables.
revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.organization_memberships from anon;
revoke all on table public.customers from anon;
revoke all on table public.catalog_categories from anon;
revoke all on table public.catalog_items from anon;
revoke all on table public.catalog_items_operational from anon;
revoke all on table public.packages from anon;
revoke all on table public.package_items from anon;
revoke all on table public.audit_events from anon;

grant select, update on table public.organizations to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.organization_memberships to authenticated;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update on table public.catalog_categories to authenticated;
grant select, insert, update on table public.catalog_items to authenticated;
grant select on table public.catalog_items_operational to authenticated;
grant select, insert, update on table public.packages to authenticated;
grant select, insert, update on table public.package_items to authenticated;
grant select on table public.audit_events to authenticated;
