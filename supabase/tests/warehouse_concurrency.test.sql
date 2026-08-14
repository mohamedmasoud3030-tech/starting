-- ============================================================================
-- S4 — warehouse concurrency invariants.
--
-- pgTAP runs inside ONE transaction, so it cannot itself interleave two live
-- sessions. It proves the structural locking contract and the business outcomes
-- that the two-session harness exercises with genuine interleaving.
-- ============================================================================
begin;
select plan(19);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','50000000-0000-0000-0000-000000000001','authenticated','authenticated','s4c-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values('50000000-0000-0000-0000-0000000000a1','S4C Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name) values
('50000000-0000-0000-0000-0000000000c1','50000000-0000-0000-0000-0000000000a1','Customer');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('50000000-0000-0000-0000-0000000000d1','50000000-0000-0000-0000-0000000000a1','Tables','REUSABLE_EQUIPMENT','piece','PER_UNIT',5.000,10.000);
insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values
('50000000-0000-0000-0000-0000000000e1','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000d1',10);
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('50000000-0000-0000-0000-000000000f01','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000c1','EV-S4C-1','Concurrency','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Muscat','PREPARING','51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
('50000000-0000-0000-0000-000000000f02','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000c1','EV-S4C-2','Capacity','2026-10-05 10:00+04','2026-10-05 20:00+04',50,'Muscat','PREPARING','51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
('50000000-0000-0000-0000-000000000f03','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000c1','EV-S4C-3','Future serviceability','2026-10-10 10:00+04','2026-10-10 20:00+04',50,'Muscat','PREPARING','51000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,idempotency_key,created_by) values
('50000000-0000-0000-0000-000000000a01','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f01','50000000-0000-0000-0000-0000000000e1',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','52000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
-- A non-overlapping window, so S3 reservation logic legitimately allows a
-- second full-capacity reservation. Only the PHYSICAL invariant stops the
-- second Event from taking stock that never came back from the first.
('50000000-0000-0000-0000-000000000a02','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f02','50000000-0000-0000-0000-0000000000e1',10,'2026-10-05 10:00+04','2026-10-05 20:00+04','52000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Structural guarantees behind the concurrency claim.
-- ---------------------------------------------------------------------------
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='dispatch_event_equipment')
  like '%for update%',
  'dispatch takes row locks before deciding');
select ok(
  (select position('from public.events' in prosrc) < position('from public.event_equipment_reservations' in prosrc)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='dispatch_event_equipment'),
  'dispatch lock order starts with Event before reservation');
select ok(
  (select position('from public.events' in prosrc) < position('from public.event_equipment_reservations' in prosrc)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='return_event_equipment'),
  'return lock order starts with Event before reservation');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reconcile_event_warehouse')
  like '%for update%',
  'reconciliation locks the Event row before freezing totals');
select is(
  (select count(*)::int from pg_constraint
    where conrelid='public.event_equipment_movements'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) like '%organization_id, idempotency_key%'),
  1, 'a UNIQUE constraint makes a duplicate command row impossible under any race');
select is(
  (select count(*)::int
     from pg_trigger
    where tgrelid='public.event_equipment_movements'::regclass
      and tgname='event_equipment_movements_concurrency_guard'
      and not tgisinternal),
  1, 'movement INSERT has a structural concurrency guard trigger');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='warehouse_ledger_is_append_only')
    like '%event_warehouse_reconciliations%'
  and
  (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='warehouse_ledger_is_append_only')
    like '%dispatched_quantity - m.returned_good_quantity%',
  'movement guard rechecks reconciliation and serviceable physical capacity');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Serialized outcome: whatever the interleaving, the second dispatch that
-- would exceed the reservation is rejected once the first has committed.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.dispatch_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f01','50000000-0000-0000-0000-000000000a01',6,null,null,'53000000-0000-0000-0000-000000000001')$$,
  'first concurrent dispatch of 6/10 succeeds');
select throws_ok(
  $$select public.dispatch_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f01','50000000-0000-0000-0000-000000000a01',6,null,null,'53000000-0000-0000-0000-000000000002')$$,
  'P0001', 'DISPATCH_EXCEEDS_RESERVATION',
  'the competing dispatch is rejected: two requests can never over-dispatch');
select is((select dispatched_quantity from public.event_warehouse_lines
            where reservation_id='50000000-0000-0000-0000-000000000a01'),
  6, 'exactly one of the two competing dispatches took effect');

-- ---------------------------------------------------------------------------
-- Physical capacity: units still in the field cannot be dispatched again to a
-- different Event, even though the S3 time-window reservation permitted it.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.dispatch_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f02','50000000-0000-0000-0000-000000000a02',10,null,null,'53000000-0000-0000-0000-000000000003')$$,
  'P0001', 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY',
  'stock still outstanding in the field cannot be physically dispatched twice');

-- Manual release cannot erase a recovery obligation.
select throws_ok(
  $$select public.release_equipment_reservation('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000a01')$$,
  'P0001', 'RESERVATION_HAS_OUTSTANDING_EQUIPMENT',
  'manual release is blocked while physical equipment is outstanding');

-- Account the six units as damaged. Reconciliation outstanding becomes zero,
-- but the six damaged units must NOT become serviceable stock again.
select lives_ok(
  $$select public.return_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f01','50000000-0000-0000-0000-000000000a01',0,6,0,null,'damaged in field','53000000-0000-0000-0000-000000000004')$$,
  'damage disposition accounts for the six outstanding units');
select is((select outstanding_quantity from public.event_warehouse_lines
            where reservation_id='50000000-0000-0000-0000-000000000a01'),
  0, 'damage resolves Event outstanding quantity');
select throws_ok(
  $$select public.dispatch_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f02','50000000-0000-0000-0000-000000000a02',10,null,null,'53000000-0000-0000-0000-000000000005')$$,
  'P0001', 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY',
  'damaged units do not respawn as dispatchable physical capacity');

select is(
  (select available::int
     from public.equipment_availability(
       '50000000-0000-0000-0000-0000000000a1',
       '50000000-0000-0000-0000-0000000000e1',
       '2026-10-10 10:00+04','2026-10-10 20:00+04',0
     )),
  4, 'future availability exposes only the four serviceable units');

select throws_ok(
  $$select public.reserve_event_equipment('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f03','50000000-0000-0000-0000-0000000000e1',5,'53000000-0000-0000-0000-000000000006')$$,
  'P0001', 'EQUIPMENT_SHORTAGE',
  'future reservation cannot promise damaged/lost equipment');

-- A reservation that once dispatched but is now fully accounted may be released
-- by cancellation; only genuinely outstanding lines must stay ACTIVE.
select lives_ok(
  $$select public.cancel_event('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-000000000f01','cancel after warehouse recovery','53000000-0000-0000-0000-000000000007')$$,
  'cancellation succeeds after warehouse outstanding reaches zero');
select is(
  (select status::text from public.event_equipment_reservations
    where id='50000000-0000-0000-0000-000000000a01'),
  'CANCELLED', 'fully-accounted reservation is released on cancellation');

select * from finish();
rollback;
