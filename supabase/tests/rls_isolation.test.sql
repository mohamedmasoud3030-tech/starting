-- ============================================================================
-- pgTAP — RLS & tenant isolation tests
-- Run with: supabase test db (requires local Supabase stack)
--
-- Proves the security invariants required by the foundation:
--   1. A member of Org A cannot READ Org B data.
--   2. A member of Org A cannot INSERT into Org B.
--   3. A member of Org A cannot UPDATE Org B data.
--   4. A member of Org A cannot DELETE Org B data.
--   5. Inactive membership cannot act on its organization.
--   6. SUPERVISOR cannot change commercial configuration.
--   7. Cross-organization package/catalog reference is rejected (FK).
-- ============================================================================

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A'),
  ('00000000-0000-0000-0000-0000000000b2', 'Org B');

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'OWNER',    'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'SUPERVISOR','ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'MANAGER',   'INACTIVE'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000004', 'OWNER',     'ACTIVE');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, selling_price)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Coffee A', 'SERVICE', 'PER_GUEST', 2.500);

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, selling_price)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', 'Coffee B', 'SERVICE', 'PER_GUEST', 9.999);

-- ---------------------------------------------------------------------------
-- 1. Org A member cannot READ Org B catalog item
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';

select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'Org A member reads zero Org B catalog items'
);

-- ---------------------------------------------------------------------------
-- 2. Org A member cannot INSERT into Org B catalog
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
     values ('00000000-0000-0000-0000-0000000000b2', 'Sneaky', 'SERVICE', 'FIXED') $$,
  '42501',
  'Org A member cannot insert into Org B catalog'
);

-- ---------------------------------------------------------------------------
-- 3. Org A member cannot UPDATE Org B catalog
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.catalog_items set name = 'hacked' where id = '00000000-0000-0000-0000-0000000000c2' $$,
  '42501',
  'Org A member cannot update Org B catalog'
);

-- ---------------------------------------------------------------------------
-- 4. Org A member cannot DELETE Org B catalog
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.catalog_items where id = '00000000-0000-0000-0000-0000000000c2' $$,
  '42501',
  'Org A member cannot delete Org B catalog'
);

-- ---------------------------------------------------------------------------
-- 5. Inactive membership cannot act on its organization
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003'; -- MANAGER, INACTIVE

select throws_ok(
  $$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
     values ('00000000-0000-0000-0000-0000000000a1', 'From inactive', 'SERVICE', 'FIXED') $$,
  '42501',
  'Inactive membership cannot insert catalog items'
);

-- ---------------------------------------------------------------------------
-- 6. SUPERVISOR cannot change commercial configuration
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'; -- SUPERVISOR, ACTIVE

select throws_ok(
  $$ update public.catalog_items set selling_price = 1.000 where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501',
  'SUPERVISOR cannot update catalog pricing'
);

-- ---------------------------------------------------------------------------
-- 7. Cross-organization package/catalog reference is rejected structurally
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; -- OWNER Org A

insert into public.packages (id, organization_id, name)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Package A');

-- Inserting a package line referencing Org B's catalog item (c2) from Org A's
-- package must fail the composite FK regardless of RLS.
select throws_ok(
  $$ insert into public.package_items (organization_id, package_id, catalog_item_id, quantity)
     values ('00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000c2',
             1) $$,
  '23503',
  'Cross-organization package/catalog reference is rejected by FK'
);

-- ---------------------------------------------------------------------------
-- 8. Negative monetary value is rejected by CHECK constraint
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.catalog_items (organization_id, name, item_type, pricing_method, cost_price)
     values ('00000000-0000-0000-0000-0000000000a1', 'Negative', 'SERVICE', 'FIXED', -1.000) $$,
  '23514',
  'Negative cost price is rejected by CHECK constraint'
);

-- ---------------------------------------------------------------------------
-- 9. Invalid pricing method is rejected by enum
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
     values ('00000000-0000-0000-0000-0000000000a1', 'Bad method', 'SERVICE', 'BOGUS') $$,
  '22P02',
  'Invalid pricing method is rejected by enum'
);

select * from finish();
rollback;
