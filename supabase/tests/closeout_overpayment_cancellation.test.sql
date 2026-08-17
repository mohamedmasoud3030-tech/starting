-- pgTAP for migration 0058: close-out guard, overpayment guard, and
-- mid-execution cancellation (defects D32/D33/D34).
begin;
select plan(12);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-000000000001','authenticated','authenticated','r58-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values('97000000-0000-0000-0000-0000000000a1','R58 A');
insert into public.organization_memberships(organization_id,user_id,role) values('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name) values('97000000-0000-0000-0000-0000000000c1','97000000-0000-0000-0000-0000000000a1','C1');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('97000000-0000-0000-0000-0000000000d1','97000000-0000-0000-0000-0000000000a1','Dallah','REUSABLE_EQUIPMENT','piece','PER_UNIT',1.000,2.000),
('97000000-0000-0000-0000-0000000000d2','97000000-0000-0000-0000-0000000000a1','Coffee','CONSUMABLE','kg','PER_UNIT',3.000,5.000);
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-R58-A','CleanClose','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M','RETURNING','97100000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001'),
('97000000-0000-0000-0000-0000000000e2','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-R58-B','EquipOut','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M','IN_PROGRESS','97100000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001'),
('97000000-0000-0000-0000-0000000000e3','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-R58-C','ConsumOut','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M','IN_PROGRESS','97100000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001'),
('97000000-0000-0000-0000-0000000000e4','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-R58-D','MidCancel','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M','DISPATCHED','97100000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001'),
('97000000-0000-0000-0000-0000000000e5','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-R58-E','Payable','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M','CONFIRMED','97100000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('97000000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e5','QT-R58-A',1,'ACCEPTED','C1','EV-R58-E','Payable',5,'2026-10-01 10:00+04','2026-10-01 12:00+04','M',100.000,60.000,40.000,'97200000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='97000000-0000-0000-0000-0000000000f1' where id='97000000-0000-0000-0000-0000000000e5';
insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values('97000000-0000-0000-0000-0000000000a2','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000d1',10);
insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,status,idempotency_key,created_by) values
('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e2','97000000-0000-0000-0000-0000000000a2',2,'2026-10-01 09:00+04','2026-10-01 13:00+04','ACTIVE','97300000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001'),
('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e4','97000000-0000-0000-0000-0000000000a2',2,'2026-10-01 09:00+04','2026-10-01 13:00+04','ACTIVE','97300000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001');
insert into public.event_equipment_movements(organization_id,event_id,reservation_id,equipment_capacity_id,movement_kind,dispatched_quantity,actor_id,idempotency_key,request_fingerprint) values
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e2','97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000a2','DISPATCH',2,'97000000-0000-0000-0000-000000000001','97400000-0000-0000-0000-000000000001','x'),
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e4','97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-0000000000a2','DISPATCH',2,'97000000-0000-0000-0000-000000000001','97400000-0000-0000-0000-000000000002','x');
insert into public.consumable_stock_items(id,organization_id,catalog_item_id,is_tracking_active,created_by) values('97000000-0000-0000-0000-0000000000a3','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000d2',true,'97000000-0000-0000-0000-000000000001');
insert into public.consumable_movements(organization_id,stock_item_id,event_id,movement_kind,quantity,actor_id,idempotency_key,request_fingerprint) values
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a3',null,'RECEIVE',5.000,'97000000-0000-0000-0000-000000000001','97500000-0000-0000-0000-000000000000','x'),
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a3','97000000-0000-0000-0000-0000000000e3','ISSUE_TO_EVENT',1.500,'97000000-0000-0000-0000-000000000001','97500000-0000-0000-0000-000000000001','x');

-- Move the outstanding fixtures to RETURNING (movement guards only accept
-- dispatch/issue while the event is CONFIRMED..IN_PROGRESS).
update public.events set status = 'RETURNING' where id in ('97000000-0000-0000-0000-0000000000e2','97000000-0000-0000-0000-0000000000e3');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.transition_event_status('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','CLOSED')$$,'clean event closes');
select is((select status::text from public.events where id='97000000-0000-0000-0000-0000000000e1'),'CLOSED','close persisted');
select throws_ok($$select public.transition_event_status('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e2','CLOSED')$$,'P0001','WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE','equipment outstanding blocks close');
select throws_ok($$select public.transition_event_status('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e3','CLOSED')$$,'P0001','CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE','consumable custody blocks close');

select lives_ok($$select public.record_customer_payment('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e5',80.000,'CASH',null,null,now(),'97600000-0000-0000-0000-000000000001')$$,'payment within accepted revenue succeeds');
select lives_ok($$select public.record_customer_payment('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e5',20.000,'CASH',null,null,now(),'97600000-0000-0000-0000-000000000002')$$,'payment up to accepted revenue succeeds');
select throws_ok($$select public.record_customer_payment('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e5',0.001,'CASH',null,null,now(),'97600000-0000-0000-0000-000000000003')$$,'P0001','OVERPAYMENT_EXCEEDS_ACCEPTED','overpayment rejected');

select lives_ok($$select public.cancel_event('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e4','client aborted on site','97700000-0000-0000-0000-000000000001')$$,'mid-execution cancellation succeeds');
select is((select status::text from public.events where id='97000000-0000-0000-0000-0000000000e4'),'CANCELLED','mid-execution event cancelled');
select is((select status::text from public.event_equipment_reservations where id='97000000-0000-0000-0000-0000000000b2'),'ACTIVE','dispatched reservation stays ACTIVE for recovery');
select throws_ok($$select public.cancel_event('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','try again','97700000-0000-0000-0000-000000000002')$$,'P0001','EVENT_CANNOT_BE_CANCELLED','CLOSED event cannot be cancelled');
select is((select status::text from public.events where id='97000000-0000-0000-0000-0000000000e1'),'CLOSED','closed event untouched');

select * from finish();
rollback;
