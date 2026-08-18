-- pgTAP for migration 0066: readiness-gated dispatch override.
begin;
select plan(8);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98300000-0000-0000-0000-000000000001','authenticated','authenticated','ov-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values('98300000-0000-0000-0000-0000000000a1','OV Org');
insert into public.organization_memberships(organization_id,user_id,role) values('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-000000000001','OWNER');

insert into public.customers(id,organization_id,name) values('98300000-0000-0000-0000-0000000000c1','98300000-0000-0000-0000-0000000000a1','OV Customer');

-- An event in CONFIRMED with a STAFF requirement of 5 hosts but zero assignments,
-- so readiness is STAFF_MISSING (not READY).
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98300000-0000-0000-0000-0000000000e1','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000c1','EV-1','مناسبة','OTHER','2026-10-01 10:00+04','2026-10-01 14:00+04',50,'نزوى','CONFIRMED','98300000-0000-0000-0000-0000000000ab','98300000-0000-0000-0000-000000000001','98300000-0000-0000-0000-000000000001');

insert into public.event_commercial_lines(id,organization_id,event_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order) values
('98300000-0000-0000-0000-0000000000d1','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','مضيف','STAFF','مضيف','PER_EVENT',5,10,5,50,25,false,0);

-- A second event already in PREPARING (used for the too-short-reason case).
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98300000-0000-0000-0000-0000000000e2','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000c1','EV-2','مناسبة 2','OTHER','2026-10-02 10:00+04','2026-10-02 14:00+04',50,'نزوى','PREPARING','98300000-0000-0000-0000-0000000000ac','98300000-0000-0000-0000-000000000001','98300000-0000-0000-0000-000000000001');
insert into public.event_commercial_lines(id,organization_id,event_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order) values
('98300000-0000-0000-0000-0000000000d2','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e2','مضيف','STAFF','مضيف','PER_EVENT',5,10,5,50,25,false,0);

set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98300000-0000-0000-0000-000000000001"}';

-- 1. CONFIRMED → PREPARING is a normal transition (no readiness gate).
select public.transition_event_status('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','PREPARING');
select is(
  (select status::text from public.events where id='98300000-0000-0000-0000-0000000000e1'),
  'PREPARING', 'CONFIRMED -> PREPARING proceeds'
);

-- 2. PREPARING → DISPATCHED with missing staff and no override is rejected.
select throws_ok(
  $sql$select public.transition_event_status('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','DISPATCHED')$sql$,
  '23514', null, 'dispatch with missing resources requires an override'
);

-- 3. With an explicit override reason, the transition succeeds and is recorded.
select public.transition_event_status('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','DISPATCHED', null, 'العميل أصر على الموعد وسنكمل الفريق ميدانياً');
select is(
  (select status::text from public.events where id='98300000-0000-0000-0000-0000000000e1'),
  'DISPATCHED', 'dispatch proceeds with an explicit override'
);
select is(
  (select count(*)::int from public.event_transition_overrides where event_id='98300000-0000-0000-0000-0000000000e1'),
  1, 'override is recorded in the append-only override table'
);
select is(
  (select reason from public.event_transition_overrides where event_id='98300000-0000-0000-0000-0000000000e1'),
  'العميل أصر على الموعد وسنكمل الفريق ميدانياً', 'override reason is preserved'
);

-- 4. An override with a too-short reason is rejected.
select throws_ok(
  $sql$select public.transition_event_status('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e2','DISPATCHED', null, 'xx')$sql$,
  '23514', null, 'too-short override reason is rejected'
);

-- 5. An unauthorized transition stays blocked (no state machine change).
select throws_ok(
  $sql$select public.transition_event_status('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','PREPARING')$sql$,
  null, null, 'illegal backward transition is still rejected'
);

-- 6. Overrides are audited.
select ok(
  (select count(*)::int from public.audit_events where organization_id='98300000-0000-0000-0000-0000000000a1' and action='EVENT_TRANSITION_OVERRIDDEN') >= 1,
  'override writes an audit event'
);

select * from finish();
rollback;
