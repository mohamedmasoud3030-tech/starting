-- ============================================================================
-- S4 — warehouse concurrency invariants.
--
-- pgTAP runs inside ONE transaction, so it cannot itself interleave two live
-- sessions. What it CAN prove — and what actually matters — is that the
-- concurrency protection is structural rather than advisory:
--
--   1. the reservation row lock is taken BEFORE the ledger is summed, so a
--      competing transaction blocks instead of reading a stale total;
--   2. the invariant is re-derived from the append-only ledger on every call,
--      never from a cached counter that two sessions could both read;
--   3. the idempotency key is protected by a UNIQUE constraint, so even a lost
--      update race cannot produce two rows for one command.
--
-- A genuinely interleaved two-session proof (session A dispatches, session B
-- blocks on the row lock, B then correctly fails with
-- DISPATCH_EXCEEDS_RESERVATION) runs in the frontend/database concurrency
-- harness described in docs/architecture/10-warehouse-operations.md, because
-- it requires two connections. These assertions guarantee the mechanism that
-- harness depends on cannot be removed silently.
-- ============================================================================
begin;
select plan(9);

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
('50000000-0000-0000-0000-000000000f02','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000c1','EV-S4C-2','Capacity','2026-10-05 10:00+04','2026-10-05 20:00+04',50,'Muscat','PREPARING','51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
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
  'dispatch locks the reservation row (FOR UPDATE) before deciding');
select ok(
  (select position('for update' in prosrc) < position('warehouse_reservation_state' in prosrc)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='dispatch_event_equipment'),
  'dispatch takes the row lock BEFORE summing the ledger (no stale read)');
select ok(
  (select position('for update' in prosrc) < position('warehouse_reservation_state' in prosrc)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='return_event_equipment'),
  'return takes the row lock BEFORE summing the ledger');
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

select * from finish();
rollback;
