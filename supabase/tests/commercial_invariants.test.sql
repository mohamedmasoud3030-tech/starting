-- ============================================================================
-- pgTAP — commercial invariants: money bounds, package semantics, commands
-- Run with: supabase test db
-- ============================================================================

begin;
select plan(16);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner_a@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'supervisor_a@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'new_owner@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A');

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'SUPERVISOR', 'ACTIVE');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, cost_price, selling_price) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Coffee',  'SERVICE', 'PER_GUEST', 2.300, 2.800),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Dates',   'CONSUMABLE', 'PER_UNIT', 0.500, 0.800);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Money domain (numeric(12,3)) — the DB is the persisted authority
-- ---------------------------------------------------------------------------
select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method, cost_price)
         values ('00000000-0000-0000-0000-0000000000a1', 'neg', 'SERVICE', 'FIXED', -1.000) $sql$,
  '23514', null, 'negative cost price rejected by CHECK'
);

select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
         values ('00000000-0000-0000-0000-0000000000a1', 'bad', 'SERVICE', 'BOGUS') $sql$,
  '22P02', null, 'invalid pricing method rejected by enum'
);

select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method, cost_price)
         values ('00000000-0000-0000-0000-0000000000a1', 'big', 'SERVICE', 'FIXED', 1000000000.000) $sql$,
  '22003', null, 'money above numeric(12,3) domain rejected (overflow)'
);

-- ---------------------------------------------------------------------------
-- Package semantics enforced in the DB
-- ---------------------------------------------------------------------------
select throws_ok(
  $sql$ insert into public.packages (organization_id, name, base_guest_count)
         values ('00000000-0000-0000-0000-0000000000a1', 'p', 0) $sql$,
  '23514', null, 'base_guest_count = 0 rejected by CHECK'
);

select throws_ok(
  $sql$ insert into public.packages (organization_id, name, base_guest_count)
         values ('00000000-0000-0000-0000-0000000000a1', 'p', -5) $sql$,
  '23514', null, 'negative base_guest_count rejected by CHECK'
);

select throws_ok(
  $sql$ insert into public.packages (id, organization_id, name)
         values ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000a1', 'p9') $sql$
  || $sql$; insert into public.package_items (organization_id, package_id, catalog_item_id, quantity)
         values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000c1', 0) $sql$,
  '23514', null, 'package line quantity = 0 rejected by CHECK'
);

-- ---------------------------------------------------------------------------
-- save_package command authorization + validation
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR
select throws_ok(
  $sql$ select public.save_package(
    '00000000-0000-0000-0000-0000000000a1', null, 'pkg', null, null, 'ACTIVE', null, '[]'::jsonb) $sql$,
  '42501', null, 'save_package denied for SUPERVISOR'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- OWNER
select throws_ok(
  $sql$ select public.save_package(
    '00000000-0000-0000-0000-0000000000a1', null, 'pkg', null, null, 'ACTIVE', null,
    '[{"catalog_item_id":"00000000-0000-0000-0000-0000000000c1","quantity":"0"}]'::jsonb) $sql$,
  'P0001', null, 'save_package rejects zero quantity'
);

select throws_ok(
  $sql$ select public.save_package(
    '00000000-0000-0000-0000-0000000000a1', null, 'pkg', null, null, 'ACTIVE', null,
    '[{"catalog_item_id":"00000000-0000-0000-0000-0000000000c1","quantity":"1"},
      {"catalog_item_id":"00000000-0000-0000-0000-0000000000c1","quantity":"2"}]'::jsonb) $sql$,
  'P0001', null, 'save_package rejects duplicate catalog items'
);

select throws_ok(
  $sql$ select public.save_package(
    '00000000-0000-0000-0000-0000000000a1', null, 'pkg', null, null, 'ACTIVE', 0, '[]'::jsonb) $sql$,
  'P0001', null, 'save_package rejects zero base_guest_count'
);

-- success path + internal audit
select is(
  (public.save_package(
    '00000000-0000-0000-0000-0000000000a1', null, 'Coffee Package', null, null, 'ACTIVE', 100,
    '[{"catalog_item_id":"00000000-0000-0000-0000-0000000000c1","quantity":"3"},
      {"catalog_item_id":"00000000-0000-0000-0000-0000000000c2","quantity":"120"}]'::jsonb)) is not null,
  true, 'save_package succeeds for OWNER'
);

select is(
  (select count(*)::int from public.package_items),
  2, 'package template lines created'
);

select is(
  (select count(*)::int from public.audit_events where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'save_package records an internal audit event'
);

-- ---------------------------------------------------------------------------
-- create_organization command (self-serve onboarding, migration 0061)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}'; -- new user
select lives_ok(
  $sql$ select public.create_organization('New Org') $sql$,
  'self-serve onboarding: authenticated user creates their own organization'
);

set local role postgres;
-- Distinct name: the earlier authenticated call already created 'New Org' with
-- a membership for the caller, and auth.uid() still resolves from the local
-- jwt claims — the privileged-path coverage must not skew the OWNER count
-- for 'New Org' below.
select is(
  (public.create_organization('Privileged New Org') is not null),
  true, 'create_organization still runs for the privileged owner role'
);
select is(
  (select count(*)::int from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where o.name = 'New Org' and m.user_id = '00000000-0000-0000-0000-000000000010' and m.role = 'OWNER'),
  1, 'self-serve onboarding makes the caller OWNER of the new org'
);

select * from finish();
rollback;
