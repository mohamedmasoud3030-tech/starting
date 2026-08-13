-- ============================================================================
-- 0008 — Row Level Security
-- Every business table has RLS enabled. Organization scoping is derived from
-- the authenticated user's ACTIVE membership (never trusted from the client).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;

create policy "organizations_select_member" on public.organizations
  for select using (public.is_org_member(id));

-- No direct INSERT: organizations are created via create_organization().
-- No direct DELETE: organization removal is a future, controlled operation.

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
-- customers
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;

create policy "customers_select_org_member" on public.customers
  for select using (public.is_org_member(organization_id));

create policy "customers_insert_member" on public.customers
  for insert with check (public.is_org_member(organization_id));

create policy "customers_update_member" on public.customers
  for update
  using (public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role, 'SUPERVISOR'::app_role]))
  with check (public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role, 'SUPERVISOR'::app_role]));

create policy "customers_delete_member" on public.customers
  for delete
  using (public.has_org_role(organization_id, array['OWNER'::app_role, 'MANAGER'::app_role]));

-- ---------------------------------------------------------------------------
-- catalog_categories
-- ---------------------------------------------------------------------------
alter table public.catalog_categories enable row level security;

create policy "catalog_categories_select_member" on public.catalog_categories
  for select using (public.is_org_member(organization_id));

create policy "catalog_categories_write_commercial" on public.catalog_categories
  for all
  using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- ---------------------------------------------------------------------------
-- catalog_items
-- ---------------------------------------------------------------------------
alter table public.catalog_items enable row level security;

create policy "catalog_items_select_member" on public.catalog_items
  for select using (public.is_org_member(organization_id));

create policy "catalog_items_write_commercial" on public.catalog_items
  for all
  using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- ---------------------------------------------------------------------------
-- packages
-- ---------------------------------------------------------------------------
alter table public.packages enable row level security;

create policy "packages_select_member" on public.packages
  for select using (public.is_org_member(organization_id));

create policy "packages_write_commercial" on public.packages
  for all
  using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- ---------------------------------------------------------------------------
-- package_items
-- ---------------------------------------------------------------------------
alter table public.package_items enable row level security;

create policy "package_items_select_member" on public.package_items
  for select using (public.is_org_member(organization_id));

create policy "package_items_write_commercial" on public.package_items
  for all
  using (public.can_manage_commercial(organization_id))
  with check (public.can_manage_commercial(organization_id));

-- ---------------------------------------------------------------------------
-- audit_events (append-only; written via record_audit RPC)
-- ---------------------------------------------------------------------------
alter table public.audit_events enable row level security;

create policy "audit_events_select_member" on public.audit_events
  for select using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Revoke broad table access from anon (unauthenticated) entirely.
revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.organization_memberships from anon;
revoke all on table public.customers from anon;
revoke all on table public.catalog_categories from anon;
revoke all on table public.catalog_items from anon;
revoke all on table public.packages from anon;
revoke all on table public.package_items from anon;
revoke all on table public.audit_events from anon;

-- Authenticated users get table access; RLS narrows to their organization.
grant select, insert, update, delete on table public.organizations to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.organization_memberships to authenticated;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.catalog_categories to authenticated;
grant select, insert, update, delete on table public.catalog_items to authenticated;
grant select, insert, update, delete on table public.packages to authenticated;
grant select, insert, update, delete on table public.package_items to authenticated;
grant select on table public.audit_events to authenticated;
