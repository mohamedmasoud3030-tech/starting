-- ============================================================================
-- S9 — staff attendance & host payroll
-- ============================================================================
begin;
select plan(22);

-- Fixture: org A has every application role; org B proves tenant boundaries.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000a1','authenticated','authenticated','s9-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000a2','authenticated','authenticated','s9-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000a3','authenticated','authenticated','s9-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000a4','authenticated','authenticated','s9-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000a5','authenticated','authenticated','s9-accountant-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-0000000000b1','authenticated','authenticated','s9-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('96000000-0000-0000-0000-0000000000a1','S9 Org A'),
('96000000-0000-0000-0000-0000000000b1','S9 Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a1','OWNER'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a2','MANAGER'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a3','SUPERVISOR'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a4','WAREHOUSE'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a5','ACCOUNTANT'),
('96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000b1','OWNER');

insert into public.customers(id,organization_id,name) values
('96000000-0000-0000-0000-0000000000c1','96000000-0000-0000-0000-0000000000a1','Customer A'),
('96000000-0000-0000-0000-0000000000c2','96000000-0000-0000-0000-0000000000b1','Customer B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000c1','EV-S9-A','Event A','2026-10-01 14:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','96100000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a1'),
('96000000-0000-0000-0000-0000000000e2','96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000c2','EV-S9-B','Event B','2026-10-01 14:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','96100000-0000-0000-0000-0000000000e2','96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000b1');

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000a1','Host A','HOST',true,'PER_HOUR',2.000),
('96000000-0000-0000-0000-0000000000f2','96000000-0000-0000-0000-0000000000b1','Host B','HOST',true,'PER_HOUR',2.000);

insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by) values
('96000000-0000-0000-0000-0000000000d1','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','HOST','2026-10-01 14:00+04','2026-10-01 20:00+04','PER_HOUR',2.000,12.000,'ACTIVE','96100000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- PER_HOUR: 5.5h @ 2.000 OMR/h = 11.000 OMR.
select lives_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:30+04',0,'PRESENT','PER_HOUR',2.000,'first shift','96200000-0000-0000-0000-0000000000a1')$$,'OWNER records PER_HOUR attendance');
select is((select earned_amount::text from public.staff_attendance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'11.000','earned is 5.5h * 2.000 = 11.000 OMR');

-- Idempotency: same key+exact payload replays; different payload hard-rejects.
select lives_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:30+04',0,'PRESENT','PER_HOUR',2.000,'first shift','96200000-0000-0000-0000-0000000000a1')$$,'same key replays');
select is((select count(*)::int from public.staff_attendance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),1,'replay creates exactly one attendance row');
select throws_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:30+04',0,'PRESENT','PER_HOUR',2.500,'first shift','96200000-0000-0000-0000-0000000000a1')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same key, different payload hard-rejects');

-- ABSENT has no times and zero earned.
select lives_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1',null,'2026-10-01','EVENING',null,null,0,'ABSENT','PER_EVENT',5.000,'no show',gen_random_uuid())$$,'OWNER records ABSENT');
select is((select earned_amount::text from public.staff_attendance_summaries where shift='EVENING' and event_id='96000000-0000-0000-0000-0000000000e1'),'0.000','ABSENT earned is zero');
select throws_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1',null,'2026-10-01','EVENING','2026-10-01 14:00+04',null,0,'ABSENT','PER_EVENT',5.000,'bad',gen_random_uuid())$$,'P0001','ABSENT_HAS_NO_TIMES','ABSENT with times is rejected');

-- Cross-org event reference is rejected.
select throws_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e2','96000000-0000-0000-0000-0000000000f1',null,'2026-10-01','MORNING',null,null,0,'ABSENT','PER_EVENT',5.000,'x',gen_random_uuid())$$,'P0002','EVENT_NOT_FOUND','cross-org event reference is rejected');

-- Role matrix: SUPERVISOR may record attendance; WAREHOUSE cannot.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-02','MORNING','2026-10-02 14:00+04','2026-10-02 20:00+04',0,'PRESENT','PER_HOUR',2.000,'sup',gen_random_uuid())$$,'SUPERVISOR records attendance');
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-02','MORNING','2026-10-02 14:00+04','2026-10-02 20:00+04',0,'PRESENT','PER_HOUR',2.000,'wh',gen_random_uuid())$$,'42501','NOT_AUTHORIZED','WAREHOUSE cannot record attendance');

-- ACCOUNTANT cannot record attendance but CAN record an advance.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.record_staff_attendance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000d1','2026-10-02','MORNING','2026-10-02 14:00+04','2026-10-02 20:00+04',0,'PRESENT','PER_HOUR',2.000,'acc',gen_random_uuid())$$,'42501','NOT_AUTHORIZED','ACCOUNTANT cannot record attendance');
select lives_ok($$select public.record_staff_advance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1',50.000,'2026-10-01','cash need',gen_random_uuid())$$,'ACCOUNTANT records an advance');
select throws_ok($$select public.record_staff_advance('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1',-5.000,'2026-10-01','bad',gen_random_uuid())$$,'P0001','INVALID_PAYMENT_AMOUNT','negative advance is rejected');

-- Host payout + payroll rollup. Event-scoped totals exclude staff-global advances because they cannot be attributed to one event.
select lives_ok($$select public.record_host_payout('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000e1',30.000,'2026-10-02','CASH',null,'partial',gen_random_uuid())$$,'OWNER records a payout');
select is((select due_total::text from public.get_host_payroll_summary('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000e1')),'23.000','due totals both live PER_HOUR rows (11.000 + 12.000)');
select is((select advances_total::text from public.get_host_payroll_summary('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000e1')),'0.000','event-scoped payroll does not allocate the global advance');
select is((select paid_total::text from public.get_host_payroll_summary('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000e1')),'30.000','event-scoped paid total includes only the event payout');
select is((select late_total::text from public.get_host_payroll_summary('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000e1')),'-7.000','event balance = due 23 - event payout 30');

-- Void transitions.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.void_staff_attendance('96000000-0000-0000-0000-0000000000a1',(select attendance_id from public.staff_attendance_summaries where shift='MORNING' and attendance_date='2026-10-01' limit 1),'mistake',gen_random_uuid())$$,'OWNER voids an attendance');
select is((select count(*)::int from public.staff_attendance_summaries where event_id='96000000-0000-0000-0000-0000000000e1' and record_status='VOIDED'),1,'one attendance is now voided');
select throws_ok($$select public.void_staff_attendance('96000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'unknown row',gen_random_uuid())$$,'P0002','ATTENDANCE_NOT_FOUND','voiding unknown attendance fails');

select finish();
rollback;