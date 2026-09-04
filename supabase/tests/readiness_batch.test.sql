-- pgTAP for migration 0060: batched readiness equals per-event semantics and
-- is membership-guarded (defect D19).
begin;
select plan(9);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000001','authenticated','authenticated','r60-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000002','authenticated','authenticated','r60-outsider@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values('99000000-0000-0000-0000-0000000000a1','R60 A'),('99000000-0000-0000-0000-0000000000b1','R60 B');
insert into public.organization_memberships(organization_id,user_id,role) values
('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-000000000001','OWNER'),
('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-000000000002','OWNER');
insert into public.customers(id,organization_id,name) values('99000000-0000-0000-0000-0000000000c1','99000000-0000-0000-0000-0000000000a1','C1');
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-R60-A','Understaffed','X','2026-10-01 10:00+04','2026-10-01 12:00+04',100,'M','CONFIRMED','99100000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e2','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-R60-B','Clean','X','2026-10-01 10:00+04','2026-10-01 12:00+04',10,'M','CONFIRMED','99100000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('99000000-0000-0000-0000-0000000000d1','99000000-0000-0000-0000-0000000000a1','Hosts','STAFF','person','PER_UNIT',5,8),
('99000000-0000-0000-0000-0000000000d2','99000000-0000-0000-0000-0000000000a1','Dallah','REUSABLE_EQUIPMENT','piece','PER_UNIT',1,2);
insert into public.event_commercial_lines(organization_id,event_id,source_catalog_item_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost) values
('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000d1','Hosts','STAFF','person','PER_UNIT',10,8,5,80,50),
('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000d2','Dallah','REUSABLE_EQUIPMENT','piece','PER_UNIT',5,2,1,10,5);
insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values('99000000-0000-0000-0000-0000000000a2','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000d2',10);
insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,status,idempotency_key,created_by) values
('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000a2',5,'2026-10-01 09:00+04','2026-10-01 13:00+04','ACTIVE','99200000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"99000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select status from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  'NOT_READY', 'batch detects the staff shortage (canonical 0082 vocabulary)');
select is(
  (select staff_missing from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  10, 'batch staff count is exact');
select is(
  (select status from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e2']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e2'),
  'READY', 'batch reports READY when nothing is short');
select is(
  (select count(*)::int from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000e2']::uuid[])),
  2, 'batch returns one row per requested event');

select is(
  (select reasons from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  array['STAFF_SHORTAGE'], 'reason codes enumerate the operational gap (equipment fully reserved → not listed)');
select is(
  (select staff_required from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  10, 'batch reports the required staff count alongside the gap');
select is(
  (select consumables_shortage from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  0, 'no consumables line means no consumables blocker');
select is(
  (select procurement_pending from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])
    where event_id='99000000-0000-0000-0000-0000000000e1'),
  0, 'no procurement order means no procurement blocker');

set local "request.jwt.claims"='{"sub":"99000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.event_readiness_batch('99000000-0000-0000-0000-0000000000a1', array['99000000-0000-0000-0000-0000000000e1']::uuid[])),
  0, 'batch is membership-guarded for non-members');

select * from finish();
rollback;
