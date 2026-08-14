-- ============================================================================
-- pgTAP — RLS, tenant isolation, financial-cost separation, audit isolation
-- Run with: supabase test db   (authoritative acceptance evidence)
--
-- Exercises real Supabase concepts: actual auth.users fixtures, the
-- authenticated role, JWT claims, auth.uid(), organization isolation, inactive
-- membership, inactive organization, restricted cost visibility, and audit
-- isolation. Foreign keys and RLS are NOT disabled.
-- ============================================================================

begin;
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner / postgres, before switching role)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner_a@test.local',      'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'manager_a@test.local',    'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'supervisor_a@test.local','x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'warehouse_a@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'accountant_a@test.local','x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'inactive_a@test.local',  'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'owner_b@test.local',      'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'supervisor_b@test.local','x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'owner_c@test.local',      'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, now());

insert into public.organizations (id, name, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Org B', true),
  ('00000000-0000-0000-0000-0000000000c3', 'Org C (inactive)', false);

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'MANAGER',    'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'SUPERVISOR', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', 'WAREHOUSE',  'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005', 'ACCOUNTANT', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000006', 'MANAGER',    'INACTIVE'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000007', 'OWNER',      'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000008', 'SUPERVISOR', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000009', 'OWNER',      'ACTIVE');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, cost_price, selling_price, internal_notes) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Coffee A', 'SERVICE', 'PER_GUEST', 2.500, 3.000, 'cost note A'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', 'Coffee B', 'SERVICE', 'PER_GUEST', 9.999, 11.000, 'cost note B'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'Coffee C', 'SERVICE', 'PER_GUEST', 5.000, 6.000, 'cost note C');

insert into public.audit_events (organization_id, user_id, action, entity, entity_id)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'x', 'x', 'a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000007', 'x', 'x', 'b2');

-- ---------------------------------------------------------------------------
-- Tenant isolation (OWNER in Org A)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'owner_a reads its own catalog item (with cost)'
);

select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000b2'),
  0, 'owner_a cannot READ Org B catalog'
);

select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
         values ('00000000-0000-0000-0000-0000000000b2', 'sneaky', 'SERVICE', 'FIXED') $sql$,
  '42501', null, 'owner_a cannot INSERT into Org B catalog'
);

-- UPDATE across tenants: RLS USING hides the row -> zero rows changed, no error.
update public.catalog_items
  set name = 'hacked' where id = '00000000-0000-0000-0000-0000000000c2';
set local role postgres;
select is(
  (select name from public.catalog_items where id = '00000000-0000-0000-0000-0000000000c2'),
  'Coffee B', 'owner_a UPDATE of Org B row changes nothing (row still intact)'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- DELETE: no DELETE policy exists on catalog_items -> denied.
select throws_ok(
  $sql$ delete from public.catalog_items where id = '00000000-0000-0000-0000-0000000000c1' $sql$,
  '42501', null, 'no client DELETE policy on master commercial data'
);

-- ---------------------------------------------------------------------------
-- Financial-cost separation
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR
select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'SUPERVISOR cannot read cost-bearing catalog rows (no cost_price exposure)'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; -- WAREHOUSE
select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'WAREHOUSE cannot read cost-bearing catalog rows'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; -- ACCOUNTANT
select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'ACCOUNTANT can read cost-bearing catalog rows'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR
select is(
  (select count(*)::int from public.catalog_items_operational where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'SUPERVISOR reads operational catalog projection (selling price visible)'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'catalog_items_operational'
      and column_name in ('cost_price', 'internal_notes')),
  0, 'operational view does not expose cost_price or internal_notes columns'
);

select is(
  (select count(*)::int from public.catalog_items_operational where organization_id = '00000000-0000-0000-0000-0000000000b2'),
  0, 'SUPERVISOR cannot read Org B operational catalog either'
);

-- ---------------------------------------------------------------------------
-- Commercial write gate (SUPERVISOR cannot change commercial config)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
         values ('00000000-0000-0000-0000-0000000000a1', 'nope', 'SERVICE', 'FIXED') $sql$,
  '42501', null, 'SUPERVISOR cannot insert catalog items'
);

-- ---------------------------------------------------------------------------
-- Inactive membership
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}'; -- MANAGER but INACTIVE
select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
         values ('00000000-0000-0000-0000-0000000000a1', 'inactive', 'SERVICE', 'FIXED') $sql$,
  '42501', null, 'INACTIVE membership cannot write'
);

-- ---------------------------------------------------------------------------
-- Inactive organization (active membership, but org inactive)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}'; -- OWNER of inactive Org C
select is(
  (select count(*)::int from public.catalog_items where organization_id = '00000000-0000-0000-0000-0000000000c3'),
  0, 'OWNER of an inactive org cannot read its catalog'
);

select throws_ok(
  $sql$ insert into public.catalog_items (organization_id, name, item_type, pricing_method)
         values ('00000000-0000-0000-0000-0000000000c3', 'write', 'SERVICE', 'FIXED') $sql$,
  '42501', null, 'OWNER of an inactive org cannot write'
);

-- ---------------------------------------------------------------------------
-- Customers write roles (OWNER / MANAGER / SUPERVISOR)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; -- WAREHOUSE
select throws_ok(
  $sql$ insert into public.customers (organization_id, name)
         values ('00000000-0000-0000-0000-0000000000a1', 'c') $sql$,
  '42501', null, 'WAREHOUSE cannot create customers'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; -- ACCOUNTANT
select throws_ok(
  $sql$ insert into public.customers (organization_id, name)
         values ('00000000-0000-0000-0000-0000000000a1', 'c') $sql$,
  '42501', null, 'ACCOUNTANT cannot create customers'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR in Org A
insert into public.customers (organization_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'cust a');
select is(
  (select count(*)::int from public.customers where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'SUPERVISOR can create customers in its own org'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}'; -- SUPERVISOR in Org B
select throws_ok(
  $sql$ insert into public.customers (organization_id, name)
         values ('00000000-0000-0000-0000-0000000000a1', 'c2') $sql$,
  '42501', null, 'SUPERVISOR of Org B cannot create customers in Org A'
);

-- Customer master records must not be hard-deleted (no DELETE policy/grant);
-- deactivation (update) remains allowed.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR A
select throws_ok(
  $sql$ delete from public.customers where name = 'cust a' $sql$,
  '42501', null, 'SUPERVISOR cannot hard-delete a customer'
);

update public.customers set is_active = false where name = 'cust a';
set local role postgres;
select is(
  (select is_active from public.customers where name = 'cust a'),
  false, 'SUPERVISOR can deactivate a customer (update remains allowed)'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Audit isolation
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- OWNER A
select is(
  (select count(*)::int from public.audit_events where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'OWNER can read its own org audit events'
);

select is(
  (select count(*)::int from public.audit_events where organization_id = '00000000-0000-0000-0000-0000000000b2'),
  0, 'OWNER A cannot read Org B audit events'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; -- SUPERVISOR A
select is(
  (select count(*)::int from public.audit_events where organization_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'SUPERVISOR cannot read audit events'
);

select throws_ok(
  $sql$ select public.record_audit('00000000-0000-0000-0000-0000000000a1', 'x', 'x') $sql$,
  '42501', null, 'record_audit is not client-callable (internal only)'
);

-- ---------------------------------------------------------------------------
-- Cross-organization package/catalog reference rejected structurally
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- OWNER A
insert into public.packages (id, organization_id, name)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Package A');

select throws_ok(
  $sql$ insert into public.package_items (organization_id, package_id, catalog_item_id, quantity)
         values ('00000000-0000-0000-0000-0000000000a1',
                 '00000000-0000-0000-0000-0000000000d1',
                 '00000000-0000-0000-0000-0000000000c2',
                 1) $sql$,
  '23503', null, 'cross-organization package/catalog reference rejected by FK'
);

select * from finish();
rollback;
