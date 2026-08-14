-- ============================================================================
-- S4 — warehouse dispatch / return / damage / loss / reconciliation.
--
-- Authoritative pgTAP coverage for the physical-equipment control layer:
-- tenant isolation, the role authorization matrix, quantity invariants,
-- concurrency-proof over-dispatch prevention, idempotency, audit, valuation
-- immutability, and cancellation interaction.
-- ============================================================================
begin;
select plan(97);

-- ---------------------------------------------------------------------------
-- Fixture: org A (OWNER, MANAGER, SUPERVISOR, WAREHOUSE, ACCOUNTANT) + org B.
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000001','authenticated','authenticated','s4-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000002','authenticated','authenticated','s4-warehouse-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000003','authenticated','authenticated','s4-accountant-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000004','authenticated','authenticated','s4-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000005','authenticated','authenticated','s4-supervisor-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('40000000-0000-0000-0000-0000000000a1','S4 Org A'),
('40000000-0000-0000-0000-0000000000b1','S4 Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000001','OWNER'),
('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000002','WAREHOUSE'),
('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000003','ACCOUNTANT'),
('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000005','SUPERVISOR'),
('40000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-000000000004','OWNER');

insert into public.customers(id,organization_id,name) values
('40000000-0000-0000-0000-0000000000c1','40000000-0000-0000-0000-0000000000a1','Customer A'),
('40000000-0000-0000-0000-0000000000c2','40000000-0000-0000-0000-0000000000b1','Customer B');

-- Chairs cost 4.250 OMR each — the immutable valuation basis under test.
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('40000000-0000-0000-0000-0000000000d1','40000000-0000-0000-0000-0000000000a1','Chairs','REUSABLE_EQUIPMENT','piece','PER_UNIT',4.250,9.000),
('40000000-0000-0000-0000-0000000000d2','40000000-0000-0000-0000-0000000000b1','Chairs B','REUSABLE_EQUIPMENT','piece','PER_UNIT',3.000,7.000);

insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values
('40000000-0000-0000-0000-0000000000e1','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000d1',100),
('40000000-0000-0000-0000-0000000000e2','40000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-0000000000d2',50);

-- Events created directly so the fixture starts from a known lifecycle state.
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000c1','EV-S4-00001','Main Event','2026-10-01 10:00+04','2026-10-01 20:00+04',200,'Muscat','CONFIRMED','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000f02','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000c1','EV-S4-00002','Cancel Undispatched','2026-11-01 10:00+04','2026-11-01 20:00+04',50,'Muscat','CONFIRMED','41000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000f03','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000c1','EV-S4-00003','Cancel Dispatched','2026-12-01 10:00+04','2026-12-01 20:00+04',50,'Muscat','CONFIRMED','41000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000f04','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000c1','EV-S4-00004','Draft Event','2027-01-01 10:00+04','2027-01-01 20:00+04',50,'Muscat','DRAFT','41000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000f05','40000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-0000000000c2','EV-S4-B0001','Org B Event','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Salalah','CONFIRMED','41000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000004');

insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,idempotency_key,created_by) values
('40000000-0000-0000-0000-000000000a01','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-0000000000e1',20,'2026-10-01 10:00+04','2026-10-01 20:00+04','42000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000a02','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f02','40000000-0000-0000-0000-0000000000e1',10,'2026-11-01 10:00+04','2026-11-01 20:00+04','42000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000a03','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03','40000000-0000-0000-0000-0000000000e1',10,'2026-12-01 10:00+04','2026-12-01 20:00+04','42000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000a04','40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f04','40000000-0000-0000-0000-0000000000e1',5,'2027-01-01 10:00+04','2027-01-01 20:00+04','42000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000a05','40000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-000000000f05','40000000-0000-0000-0000-0000000000e2',8,'2026-10-01 10:00+04','2026-10-01 20:00+04','42000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000004');

-- ===========================================================================
-- 1. Structural security: RLS enabled, no client write path, append-only.
-- ===========================================================================
select is(
  (select relrowsecurity from pg_class where oid='public.event_equipment_movements'::regclass),
  true, 'RLS is enabled on event_equipment_movements');
select is(
  (select relrowsecurity from pg_class where oid='public.event_warehouse_reconciliations'::regclass),
  true, 'RLS is enabled on event_warehouse_reconciliations');
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='event_equipment_movements' and cmd<>'SELECT'),
  0, 'movement ledger has no client INSERT/UPDATE/DELETE policy');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='event_equipment_movements'
      and grantee in ('anon','authenticated') and privilege_type<>'SELECT'),
  0, 'movement ledger grants SELECT only to client roles');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='event_equipment_movements' and grantee='anon'),
  0, 'anon has no access to the movement ledger');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('dispatch_event_equipment','return_event_equipment',
                        'reconcile_event_warehouse','warehouse_reservation_state',
                        'event_warehouse_summary','warehouse_fingerprint')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c where c like 'search_path=%')),
  0, 'every SECURITY DEFINER warehouse function pins a safe search_path');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public'
      and routine_name in ('dispatch_event_equipment','return_event_equipment','reconcile_event_warehouse')
      and grantee in ('anon','PUBLIC')),
  0, 'warehouse commands are not executable by anon or PUBLIC');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='event_warehouse_lines'
      and column_name like '%valuation%'),
  0, 'the operational read model exposes no valuation column');

-- ===========================================================================
-- 2. Authorization matrix.
-- ===========================================================================
set local role authenticated;

-- ACCOUNTANT owns no physical warehouse action.
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',1,null,null,'43000000-0000-0000-0000-000000000090')$$,
  '42501', null, 'ACCOUNTANT cannot dispatch');
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',1,0,0,null,null,'43000000-0000-0000-0000-000000000091')$$,
  '42501', null, 'ACCOUNTANT cannot record returns');

-- Cross-organization: org B OWNER may not touch org A.
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',1,null,null,'43000000-0000-0000-0000-000000000092')$$,
  '42501', null, 'cross-organization dispatch is rejected');
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01',null,'43000000-0000-0000-0000-000000000093')$$,
  '42501', null, 'cross-organization reconciliation is rejected');
select is((select count(*)::int from public.event_warehouse_lines
            where organization_id='40000000-0000-0000-0000-0000000000a1'),
  0, 'org B cannot read org A warehouse lines (tenant isolation)');
select throws_ok(
  $$select public.event_warehouse_summary('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01')$$,
  '42501', null, 'cross-organization warehouse summary is rejected');

-- WAREHOUSE owns the physical operations.
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ===========================================================================
-- 3. Dispatch validation.
-- ===========================================================================
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',0,null,null,'43000000-0000-0000-0000-000000000001')$$,
  'P0001', 'INVALID_QUANTITY', 'zero dispatch quantity is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',-5,null,null,'43000000-0000-0000-0000-000000000002')$$,
  'P0001', 'INVALID_QUANTITY', 'negative dispatch quantity is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-0000000000ff',1,null,null,'43000000-0000-0000-0000-000000000003')$$,
  '23503', null, 'non-existent reservation is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a05',1,null,null,'43000000-0000-0000-0000-000000000004')$$,
  '23503', null, 'cross-organization reservation reference is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f02','40000000-0000-0000-0000-000000000a01',1,null,null,'43000000-0000-0000-0000-000000000005')$$,
  '23503', 'RESERVATION_EVENT_MISMATCH', 'reservation belonging to another Event is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f04','40000000-0000-0000-0000-000000000a04',1,null,null,'43000000-0000-0000-0000-000000000006')$$,
  'P0001', 'EVENT_NOT_DISPATCHABLE', 'dispatch from a DRAFT Event is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',21,null,null,'43000000-0000-0000-0000-000000000007')$$,
  'P0001', 'DISPATCH_EXCEEDS_RESERVATION', 'dispatch above the reservation is rejected');

-- Valid partial dispatch.
select lives_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',12,'TRUCK-1','first load','43000000-0000-0000-0000-000000000010')$$,
  'valid partial dispatch succeeds');
select is((select dispatched_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  12, 'dispatched quantity is derived from the ledger');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  12, 'all dispatched stock is outstanding before any return');
select is((select reserved_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  20, 'reserved quantity is exposed on the warehouse line');

-- Remaining reservation is respected across multiple dispatches.
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',9,null,null,'43000000-0000-0000-0000-000000000011')$$,
  'P0001', 'DISPATCH_EXCEEDS_RESERVATION', 'cumulative dispatch above the reservation is rejected');
select lives_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',8,'TRUCK-2','second load','43000000-0000-0000-0000-000000000012')$$,
  'second dispatch up to the exact reservation succeeds');
select is((select dispatched_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  20, 'multiple dispatch loads accumulate exactly');

-- ===========================================================================
-- 4. Idempotency.
-- ===========================================================================
select lives_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',12,'TRUCK-1','first load','43000000-0000-0000-0000-000000000010')$$,
  'idempotent dispatch replay is accepted');
select is((select dispatched_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  20, 'idempotent replay creates no second physical movement');
select is((select count(*)::int from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  1, 'a reservation resolves to exactly one warehouse line');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',3,'TRUCK-1','first load','43000000-0000-0000-0000-000000000010')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'same key with a different quantity is rejected');
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',12,'TRUCK-9','first load','43000000-0000-0000-0000-000000000010')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'same key with a different reference is rejected');

-- ===========================================================================
-- 5. Returns: partial, multiple, damage, loss, mixed, over-return.
-- ===========================================================================
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',0,0,0,null,null,'43000000-0000-0000-0000-000000000020')$$,
  'P0001', 'INVALID_QUANTITY', 'an empty return is rejected');
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',-1,0,0,null,null,'43000000-0000-0000-0000-000000000021')$$,
  'P0001', 'INVALID_QUANTITY', 'a negative return quantity is rejected');
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',21,0,0,null,null,'43000000-0000-0000-0000-000000000022')$$,
  'P0001', 'RETURN_EXCEEDS_OUTSTANDING', 'returning more than was dispatched is rejected');

select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',9,0,0,'RET-1','clean','43000000-0000-0000-0000-000000000030')$$,
  'partial return of good stock succeeds');
select is((select returned_good_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  9, 'partial return is recorded');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  11, 'outstanding drops by the returned quantity');

select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',4,0,0,'RET-2','clean','43000000-0000-0000-0000-000000000031')$$,
  'a second return operation succeeds');
select is((select returned_good_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  13, 'multiple returns accumulate');

-- Damage only.
select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',0,2,0,'RET-3','broken legs','43000000-0000-0000-0000-000000000032')$$,
  'damage is recorded as a first-class quantity');
select is((select damaged_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  2, 'damaged quantity is derived from the ledger');

-- Loss only.
select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',0,0,1,'RET-4','not returned by venue','43000000-0000-0000-0000-000000000033')$$,
  'loss is recorded as a first-class quantity');
select is((select lost_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  1, 'lost quantity is derived from the ledger');

-- Mixed disposition in a single return.
select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',2,1,1,'RET-5','mixed','43000000-0000-0000-0000-000000000034')$$,
  'a mixed returned/damaged/lost return succeeds');
select is((select returned_good_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  15, 'mixed return adds to returned-good');
select is((select damaged_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  3, 'mixed return adds to damaged');
select is((select lost_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  2, 'mixed return adds to lost');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  0, 'outstanding reaches zero once everything is explained');

-- A retry of a return must not double-return stock.
select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',2,1,1,'RET-5','mixed','43000000-0000-0000-0000-000000000034')$$,
  'idempotent return replay is accepted');
select is((select returned_good_quantity + damaged_quantity + lost_quantity
             from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  20, 'return retry does not double-return stock');
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',3,0,0,'RET-5','mixed','43000000-0000-0000-0000-000000000034')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'return key reuse with a different payload is rejected');

-- ===========================================================================
-- 6. Valuation: exact OMR, immutable against later catalog change.
--
-- Read as OWNER: the valuation columns live on the cost-gated base table, and
-- the fact that WAREHOUSE cannot read them at all is asserted further below.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select unit_valuation_omr from public.event_equipment_movements
    where idempotency_key='43000000-0000-0000-0000-000000000032'),
  4.250::numeric, 'damage snapshots the catalog cost as its valuation basis');
select is(
  (select damage_loss_valuation_omr from public.event_equipment_movements
    where idempotency_key='43000000-0000-0000-0000-000000000032'),
  8.500::numeric, 'damage valuation is exact to 3 OMR decimals (2 x 4.250)');
select is(
  (select valuation_basis::text from public.event_equipment_movements
    where idempotency_key='43000000-0000-0000-0000-000000000033'),
  'CATALOG_COST_SNAPSHOT', 'the valuation basis is recorded explicitly');
select is(
  (select unit_valuation_omr from public.event_equipment_movements
    where idempotency_key='43000000-0000-0000-0000-000000000030'),
  null, 'a good-only return records no valuation');

-- Change the catalog cost AFTER the fact; history must not move.
update public.catalog_items set cost_price=99.000
  where id='40000000-0000-0000-0000-0000000000d1';
select is(
  (select damage_loss_valuation_omr from public.event_equipment_movements
    where idempotency_key='43000000-0000-0000-0000-000000000032'),
  8.500::numeric, 'a later catalog cost change never restates historical damage valuation');
select is(
  (select damage_loss_valuation_omr from public.event_warehouse_lines_valued
    where reservation_id='40000000-0000-0000-0000-000000000a01'),
  21.250::numeric, 'valued read model sums immutable snapshots (5 units x 4.250)');

-- Commercial separation: WAREHOUSE must never see valuation.
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.event_warehouse_lines_valued),
  0, 'WAREHOUSE cannot read the valued warehouse read model');
select is((select count(*)::int from public.event_equipment_movements),
  0, 'WAREHOUSE cannot read the valuation-bearing movement base table');
select ok((select count(*) from public.event_warehouse_lines) > 0,
  'WAREHOUSE can read the operational warehouse read model');

-- ===========================================================================
-- 7. Append-only enforcement.
-- ===========================================================================
select throws_ok(
  $$update public.event_equipment_movements set dispatched_quantity=1$$,
  '42501', null, 'the movement ledger cannot be mutated by a client');
select throws_ok(
  $$delete from public.event_equipment_movements$$,
  '42501', null, 'the movement ledger cannot be deleted by a client');
select throws_ok(
  $$insert into public.event_equipment_movements(organization_id,event_id,reservation_id,equipment_capacity_id,movement_kind,dispatched_quantity,actor_id,idempotency_key,request_fingerprint)
    values('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01','40000000-0000-0000-0000-0000000000e1','DISPATCH',1,'40000000-0000-0000-0000-000000000002','43000000-0000-0000-0000-0000000000ff','x')$$,
  '42501', null, 'a client cannot insert directly into the movement ledger');

-- ===========================================================================
-- 8. Reconciliation.
-- ===========================================================================
-- Event f03 has outstanding stock, so it cannot be reconciled.
select lives_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03','40000000-0000-0000-0000-000000000a03',6,'TRUCK-3',null,'43000000-0000-0000-0000-000000000040')$$,
  'dispatch on the cancellation-test Event succeeds');

set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01',null,'43000000-0000-0000-0000-000000000050')$$,
  '42501', null, 'WAREHOUSE cannot finalize reconciliation');
set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01',null,'43000000-0000-0000-0000-000000000051')$$,
  '42501', null, 'SUPERVISOR cannot finalize reconciliation');

set local "request.jwt.claims"='{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03',null,'43000000-0000-0000-0000-000000000052')$$,
  'P0001', 'WAREHOUSE_OUTSTANDING_QUANTITY', 'reconciliation with outstanding quantity is rejected');

select lives_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','all accounted for','43000000-0000-0000-0000-000000000053')$$,
  'reconciliation succeeds once nothing is outstanding');
select is(
  (select total_damage_loss_valuation_omr from public.event_warehouse_reconciliations
    where event_id='40000000-0000-0000-0000-000000000f01'),
  21.250::numeric, 'reconciliation freezes the immutable damage/loss valuation total');
select is(
  (select total_dispatched_quantity from public.event_warehouse_reconciliations
    where event_id='40000000-0000-0000-0000-000000000f01'),
  20, 'reconciliation freezes the dispatched total');
select is((select is_reconciled from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a01'),
  true, 'the warehouse line reports the reconciled state');

-- A finalized reconciliation freezes further physical mutation.
select throws_ok(
  $$select public.dispatch_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',1,null,null,'43000000-0000-0000-0000-000000000054')$$,
  'P0001', 'WAREHOUSE_ALREADY_RECONCILED', 'dispatch after reconciliation is rejected');
select throws_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','40000000-0000-0000-0000-000000000a01',1,0,0,null,null,'43000000-0000-0000-0000-000000000055')$$,
  'P0001', 'WAREHOUSE_ALREADY_RECONCILED', 'return after reconciliation is rejected');
select lives_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','all accounted for','43000000-0000-0000-0000-000000000053')$$,
  'idempotent reconciliation replay is accepted');
select is((select count(*)::int from public.event_warehouse_reconciliations
            where event_id='40000000-0000-0000-0000-000000000f01'),
  1, 'reconciliation replay creates no duplicate closure');
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01','different note','43000000-0000-0000-0000-000000000053')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'reconciliation key reuse with a different payload is rejected');
select throws_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01',null,'43000000-0000-0000-0000-000000000056')$$,
  'P0001', 'WAREHOUSE_ALREADY_RECONCILED', 'a second distinct reconciliation attempt is rejected');

-- ===========================================================================
-- 9. Cancellation interaction.
-- ===========================================================================
-- Undispatched reservations follow the existing release semantics.
select lives_ok(
  $$select public.cancel_event('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f02','customer cancelled','43000000-0000-0000-0000-000000000060')$$,
  'cancelling an Event with only undispatched reservations succeeds');
select is((select status::text from public.event_equipment_reservations
            where id='40000000-0000-0000-0000-000000000a02'),
  'CANCELLED', 'cancellation releases an undispatched reservation');

-- Already-dispatched equipment is NEVER released by cancellation.
select lives_ok(
  $$select public.cancel_event('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03','customer cancelled','43000000-0000-0000-0000-000000000061')$$,
  'cancelling an Event with dispatched equipment succeeds');
select is((select status::text from public.event_equipment_reservations
            where id='40000000-0000-0000-0000-000000000a03'),
  'ACTIVE', 'cancellation does NOT release physically dispatched equipment');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a03'),
  6, 'dispatched stock stays outstanding after cancellation');

-- The outstanding stock can still be brought back through the authoritative command.
select lives_ok(
  $$select public.return_event_equipment('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03','40000000-0000-0000-0000-000000000a03',6,0,0,'RET-C','returned after cancellation','43000000-0000-0000-0000-000000000062')$$,
  'equipment can still be returned after the Event was cancelled');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='40000000-0000-0000-0000-000000000a03'),
  0, 'a cancelled Event can be brought back to zero outstanding');
select lives_ok(
  $$select public.reconcile_event_warehouse('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f03','closed after cancellation','43000000-0000-0000-0000-000000000063')$$,
  'a cancelled Event can be reconciled once nothing is outstanding');

-- ===========================================================================
-- 10. Audit.
-- ===========================================================================
select is(
  (select count(*)::int from public.audit_events
    where organization_id='40000000-0000-0000-0000-0000000000a1'
      and action='EQUIPMENT_DISPATCHED'),
  3, 'every dispatch emits exactly one audit event');
select is(
  (select count(*)::int from public.audit_events
    where organization_id='40000000-0000-0000-0000-0000000000a1'
      and action='EQUIPMENT_DISPATCHED'
      and metadata->>'idempotency_key'='43000000-0000-0000-0000-000000000010'),
  1, 'an idempotent dispatch replay emits no duplicate audit event');
select is(
  (select count(*)::int from public.audit_events
    where organization_id='40000000-0000-0000-0000-0000000000a1'
      and action='EQUIPMENT_RETURNED'
      and metadata->>'idempotency_key'='43000000-0000-0000-0000-000000000034'),
  1, 'an idempotent return replay emits no duplicate audit event');
select is(
  (select (metadata->>'damaged')::int from public.audit_events
    where organization_id='40000000-0000-0000-0000-0000000000a1'
      and metadata->>'idempotency_key'='43000000-0000-0000-0000-000000000032'),
  2, 'the audit payload records the damaged quantity');
select is(
  (select user_id from public.audit_events
    where metadata->>'idempotency_key'='43000000-0000-0000-0000-000000000010'),
  '40000000-0000-0000-0000-000000000002'::uuid,
  'the audited actor is the authenticated warehouse user, not a client-supplied id');
select is(
  (select count(*)::int from public.audit_events
    where organization_id='40000000-0000-0000-0000-0000000000a1'
      and action='WAREHOUSE_RECONCILED'),
  2, 'each reconciliation emits exactly one audit event');
select is(
  (select count(*)::int from public.audit_events
    where action in ('EQUIPMENT_DISPATCHED','EQUIPMENT_RETURNED','WAREHOUSE_RECONCILED')
      and metadata ? 'valuation'),
  0, 'no commercial valuation leaks into the audit payload');

-- ===========================================================================
-- 11. Event-level summary.
-- ===========================================================================
select is(
  (public.event_warehouse_summary('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01')->>'status'),
  'RECONCILED', 'the summary reports the reconciled state');
select is(
  (public.event_warehouse_summary('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f01')->>'outstanding')::int,
  0, 'the summary reports zero outstanding after reconciliation');
select is(
  (public.event_warehouse_summary('40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000f04')->>'status'),
  'AWAITING_DISPATCH', 'the summary reports an Event still awaiting dispatch');

select * from finish();
rollback;
