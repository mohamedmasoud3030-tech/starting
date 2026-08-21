-- ============================================================================
-- 0073/0075 — operational clock punch (دخول / خروج) + selfie evidence
-- ============================================================================
begin;
select plan(12);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-0000000000b1','authenticated','authenticated','s73-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-0000000000b2','authenticated','authenticated','s73-warehouse@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('98000000-0000-0000-0000-0000000000a1','S73 Clock Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000b1','OWNER'),
('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000b2','WAREHOUSE');

insert into public.customers(id,organization_id,name) values
('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000a1','Clock Customer');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1','EV-CLK-1','Clock Event','2026-10-01 14:00+04','2026-10-01 20:00+04',80,'Nizwa','CONFIRMED','98100000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000b1');

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1','Host Clock','HOST',true,'PER_HOUR',2.000),
('98000000-0000-0000-0000-0000000000f2','98000000-0000-0000-0000-0000000000a1','Host Spare','HOST',true,'PER_HOUR',2.000);

insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by) values
('98000000-0000-0000-0000-0000000000d1','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1','HOST','2026-10-01 14:00+04','2026-10-01 20:00+04','PER_HOUR',2.000,12.000,'ACTIVE','98100000-0000-0000-0000-0000000000d1','98000000-0000-0000-0000-0000000000b1');

-- Uploaded selfie objects in the private bucket (as the storage API would
-- create them before the punch command runs).
insert into storage.objects(bucket_id, name, owner) values
('attachments','98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/checkin-selfie.jpg','98000000-0000-0000-0000-0000000000b1'),
('attachments','98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKOUT/staff_attendance/checkout-selfie.jpg','98000000-0000-0000-0000-0000000000b1');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select lives_ok($$select public.clock_staff_in('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000d1','MORNING',null,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/checkin-selfie.jpg','checkin-selfie.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000001')$$,'OWNER clocks a host in');
select is((select earned_amount::text from public.staff_attendance_summaries where event_id='98000000-0000-0000-0000-0000000000e1' and attendance_status<>'VOIDED'),'0.000','open punch keeps earned at 0.000 OMR');
select is((select check_out is null from public.staff_attendance_summaries where event_id='98000000-0000-0000-0000-0000000000e1' and attendance_status<>'VOIDED'),true,'open punch has no check-out yet');
select is((select count(*)::int from public.attachment_evidence where entity_type='staff_attendance' and evidence_type='ATTENDANCE_CHECKIN' and organization_id='98000000-0000-0000-0000-0000000000a1'),1,'clock-in selfie is linked as evidence');

select throws_ok($$select public.clock_staff_in('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000d1','MORNING',null,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/checkin-selfie.jpg','checkin-selfie.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000002')$$,'23505','ATTENDANCE_SLOT_ALREADY_RECORDED','double clock-in of the same slot is rejected');

set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.clock_staff_in('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000d1','EVENING',null,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/x.jpg','x.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000003')$$,'42501','NOT_AUTHORIZED','WAREHOUSE cannot punch the clock');

set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.clock_staff_in('98000000-0000-0000-0000-0000000000a1'::uuid,'98000000-0000-0000-0000-0000000000e1'::uuid,'98000000-0000-0000-0000-0000000000f2'::uuid,null::uuid,'MORNING'::public.staff_shift,null::text,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/x.jpg','x.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000004'::uuid)$$,'P0002','ASSIGNMENT_NOT_FOUND','unassigned host cannot clock in');

reset role;
alter table public.staff_attendance disable trigger staff_attendance_guard;
update public.staff_attendance
   set check_in = clock_timestamp() - interval '5 hours 30 minutes'
 where organization_id='98000000-0000-0000-0000-0000000000a1'
   and event_id='98000000-0000-0000-0000-0000000000e1'
   and check_out is null;
alter table public.staff_attendance enable trigger staff_attendance_guard;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select lives_ok($$select public.clock_staff_out('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1',null,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKOUT/staff_attendance/checkout-selfie.jpg','checkout-selfie.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000005')$$,'OWNER clocks the host out');
select is((select earned_amount::text from public.staff_attendance_summaries where event_id='98000000-0000-0000-0000-0000000000e1' and attendance_status<>'VOIDED'),'11.000','closed punch earns 5.5h * 2.000 = 11.000 OMR');
select is((select hours_worked::text from public.staff_attendance_summaries where event_id='98000000-0000-0000-0000-0000000000e1' and attendance_status<>'VOIDED'),'5.500','closed punch stores 5.500 hours');
select is((select count(*)::int from public.attachment_evidence where entity_type='staff_attendance' and evidence_type='ATTENDANCE_CHECKOUT' and organization_id='98000000-0000-0000-0000-0000000000a1'),1,'clock-out selfie is linked as evidence');

select throws_ok($$select public.clock_staff_out('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000f1',null,'98000000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKOUT/staff_attendance/x.jpg','x.jpg','image/jpeg',12345,'98200000-0000-0000-0000-000000000006')$$,'P0001','CLOCK_IN_REQUIRED','checkout without an open punch fails');

select finish();
rollback;
