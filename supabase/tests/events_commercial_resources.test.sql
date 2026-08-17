-- pgTAP integration coverage for S1-S3 commands and invariants.
begin;
select plan(42);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','s123-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','s123-super-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003','authenticated','authenticated','s123-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values('10000000-0000-0000-0000-0000000000a1','S123 A'),('10000000-0000-0000-0000-0000000000b1','S123 B');
insert into public.organization_memberships(organization_id,user_id,role) values
('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','OWNER'),
('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002','SUPERVISOR'),
('10000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000003','OWNER');
insert into public.customers(id,organization_id,name) values('10000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000a1','Customer A'),('10000000-0000-0000-0000-0000000000c2','10000000-0000-0000-0000-0000000000b1','Customer B');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('10000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000a1','Hosts','STAFF','person','PER_UNIT',5.125,8.375),
('10000000-0000-0000-0000-0000000000d2','10000000-0000-0000-0000-0000000000a1','Dallah','REUSABLE_EQUIPMENT','piece','PER_UNIT',1.000,2.000),
('10000000-0000-0000-0000-0000000000d3','10000000-0000-0000-0000-0000000000b1','Other','SERVICE','unit','FIXED',1,2);
insert into public.packages(id,organization_id,name) values('10000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000a1','Package A');
insert into public.package_items(organization_id,package_id,catalog_item_id,quantity,sort_order) values('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000d1',2,1),('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000d2',5,2);
insert into public.staff_members(id,organization_id,name,staff_type,default_compensation_method,default_rate) values
('10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000a1','Ali','HOST','PER_EVENT',20.000),
('10000000-0000-0000-0000-0000000000f2','10000000-0000-0000-0000-0000000000a1','Inactive','HOST','PER_EVENT',10.000);
update public.staff_members set is_active=false where id='10000000-0000-0000-0000-0000000000f2';
insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values('10000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d2',5);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c1','Wedding','WEDDING','2026-09-01 10:00+04','2026-09-01 14:00+04',100,'Muscat',null,null,null,null,'11000000-0000-0000-0000-000000000001')$$,'create Event succeeds');
select is((select status::text from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'DRAFT','new Event is DRAFT');
select ok((select event_number from public.events where idempotency_key='11000000-0000-0000-0000-000000000001') like 'EV-2026-%','readable yearly Event number');
select is((select count(*)::int from public.event_status_history h join public.events e on e.id=h.event_id where e.idempotency_key='11000000-0000-0000-0000-000000000001'),1,'creation writes history');
select throws_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c1','Bad','X','2026-09-01 14:00+04','2026-09-01 10:00+04',1,'M',null,null,null,null,'11000000-0000-0000-0000-000000000002')$$,'22007',null,'invalid schedule rejected');
select throws_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c2','Cross','X','2026-09-01 10:00+04','2026-09-01 11:00+04',1,'M',null,null,null,null,'11000000-0000-0000-0000-000000000003')$$,'23503',null,'cross-org customer rejected');
select lives_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c1','Overlapping','X','2026-09-01 13:00+04','2026-09-01 18:00+04',10,'M',null,null,null,null,'11000000-0000-0000-0000-000000000004')$$,'second Event created');
select isnt((select event_number from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),(select event_number from public.events where idempotency_key='11000000-0000-0000-0000-000000000004'),'Event numbers unique');

select is(public.apply_package_to_event('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'10000000-0000-0000-0000-0000000000e1'),2,'package snapshots two lines');
update public.catalog_items set selling_price=99 where id='10000000-0000-0000-0000-0000000000d2';
update public.package_items set quantity=1 where package_id='10000000-0000-0000-0000-0000000000e1' and catalog_item_id='10000000-0000-0000-0000-0000000000d2';
select is((select quantity from public.event_commercial_lines where source_catalog_item_id='10000000-0000-0000-0000-0000000000d2'),5.000::numeric,'package change does not reprice Event quantity');
select is((select unit_selling_price from public.event_commercial_lines where source_catalog_item_id='10000000-0000-0000-0000-0000000000d2'),2.000::numeric,'catalog change does not reprice Event');
select is((select total_selling from public.event_commercial_lines where source_catalog_item_id='10000000-0000-0000-0000-0000000000d1'),16.750::numeric,'OMR arithmetic is exact to 3 decimals');
select lives_ok($$select public.issue_event_quotation('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'terms','note','12000000-0000-0000-0000-000000000001')$$,'quotation revision one issued');
select lives_ok($$select public.save_event_commercial_line('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),null,'Extra','SERVICE','unit','FIXED',1,3.333,1.111,null)$$,'Event pricing can be revised');
select lives_ok($$select public.issue_event_quotation('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'terms2','note2','12000000-0000-0000-0000-000000000002')$$,'quotation revision two issued');
select is((select count(*)::int from public.quotations q join public.events e on e.id=q.event_id where e.idempotency_key='11000000-0000-0000-0000-000000000001'),2,'revision preserves quote history');
select throws_ok($$update public.quotation_lines set description='tamper'$$,'42501',null,'client cannot directly mutate issued quotation lines');
select lives_ok($$select public.accept_event_quotation('10000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='12000000-0000-0000-0000-000000000002'),'13000000-0000-0000-0000-000000000001')$$,'accept latest quote');
select is((select status::text from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'CONFIRMED','quote acceptance confirms Event');
select is((select status::text from public.quotations where idempotency_key='12000000-0000-0000-0000-000000000001'),'SUPERSEDED','older quote is superseded');

select lives_ok($$select public.assign_event_staff('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'10000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',20,20,null,'14000000-0000-0000-0000-000000000001')$$,'staff assigned');
select throws_ok($$select public.assign_event_staff('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000004'),'10000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',20,20,null,'14000000-0000-0000-0000-000000000002')$$,'23P01','STAFF_CONFLICT','staff overlap rejected');
select lives_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c1','Adjacent','X','2026-09-01 14:00+04','2026-09-01 18:00+04',10,'M',null,null,null,null,'11000000-0000-0000-0000-000000000005')$$,'adjacent Event created');
select lives_ok($$select public.assign_event_staff('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000005'),'10000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',22,22,null,'14000000-0000-0000-0000-000000000003')$$,'adjacent half-open assignment accepted');
select throws_ok($$select public.assign_event_staff('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000004'),'10000000-0000-0000-0000-0000000000f2','HOST','PER_EVENT',10,10,null,'14000000-0000-0000-0000-000000000004')$$,'23503',null,'inactive staff rejected');
select is((select rate from public.event_staff_assignments where idempotency_key='14000000-0000-0000-0000-000000000001'),20.000::numeric,'compensation snapshot retained');

select lives_ok($$select public.reserve_event_equipment('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'10000000-0000-0000-0000-0000000000a2',5,'15000000-0000-0000-0000-000000000001')$$,'exact equipment capacity succeeds');
select throws_ok($$select public.reserve_event_equipment('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'10000000-0000-0000-0000-0000000000a2',1,'15000000-0000-0000-0000-000000000002')$$,'P0001',null,'capacity plus one rejected');
select lives_ok($$select public.reserve_event_equipment('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000005'),'10000000-0000-0000-0000-0000000000a2',5,'15000000-0000-0000-0000-000000000003')$$,'non-overlap reuses equipment capacity');
select is((public.event_readiness('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'))->>'status'),'STAFF_MISSING','readiness detects missing staff');
select lives_ok($$select public.cancel_event('10000000-0000-0000-0000-0000000000a1',(select id from public.events where idempotency_key='11000000-0000-0000-0000-000000000001'),'customer cancelled','16000000-0000-0000-0000-000000000001')$$,'cancellation succeeds');
select is((select status::text from public.event_equipment_reservations where idempotency_key='15000000-0000-0000-0000-000000000001'),'CANCELLED','cancellation releases equipment');
select is((select status::text from public.event_staff_assignments where idempotency_key='14000000-0000-0000-0000-000000000001'),'CANCELLED','cancellation releases staff');

set local "request.jwt.claims"='{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.event_commercial_lines),0,'SUPERVISOR cannot read expected costs');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='quotations_customer' and column_name in('total_expected_cost','total_expected_profit')),0,'customer quote projection hides cost and profit');

-- ---------------------------------------------------------------------------
-- Event logistics editing (migration 0057 UPDATE policy)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_event('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000c1','EditTarget','X','2026-10-01 10:00+04','2026-10-01 12:00+04',10,'M',null,null,null,null,'11000000-0000-0000-0000-000000000006')$$,'edit-target Event created');
select lives_ok($$update public.events set title='Renamed', venue_name='NewVenue' where organization_id='10000000-0000-0000-0000-0000000000a1' and idempotency_key='11000000-0000-0000-0000-000000000006'$$,'OWNER edits DRAFT logistics through the policy');
select is((select title from public.events where idempotency_key='11000000-0000-0000-0000-000000000006'),'Renamed','edit persisted');
select throws_ok($$update public.events set status='CLOSED' where organization_id='10000000-0000-0000-0000-0000000000a1' and idempotency_key='11000000-0000-0000-0000-000000000006'$$,'42501',null,'client cannot smuggle a status transition through the edit path');
select throws_ok($$update public.events set title='x' where organization_id='10000000-0000-0000-0000-0000000000a1' and idempotency_key='11000000-0000-0000-0000-000000000001'$$,'42501',null,'CANCELLED event is not editable');
set local "request.jwt.claims"='{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$update public.events set title='hacked' where organization_id='10000000-0000-0000-0000-0000000000a1' and idempotency_key='11000000-0000-0000-0000-000000000006'$$,'cross-org update is a silent no-op');
set local "request.jwt.claims"='{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select title from public.events where idempotency_key='11000000-0000-0000-0000-000000000006'),'Renamed','cross-org edit did not modify the row');

select * from finish();
rollback;
