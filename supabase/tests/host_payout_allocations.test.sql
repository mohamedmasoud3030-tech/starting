-- ============================================================================
-- 0076 — Multi-event host payout: allocation integrity + financial consistency
-- ============================================================================
begin;
select plan(15);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98200000-0000-0000-0000-000000000001','authenticated','authenticated','p76-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values ('98300000-0000-0000-0000-0000000000a1','Payout Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('98300000-0000-0000-0000-0000000000a1','98200000-0000-0000-0000-000000000001','OWNER');

insert into public.customers(id,organization_id,name) values
('98300000-0000-0000-0000-0000000000c1','98300000-0000-0000-0000-0000000000a1','Pay Customer');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98300000-0000-0000-0000-0000000000e1','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000c1','EV-P1','Pay Event 1','2026-10-01 14:00+04','2026-10-01 20:00+04',10,'A','CONFIRMED','98300000-0000-0000-0000-0000000000e1','98200000-0000-0000-0000-000000000001','98200000-0000-0000-0000-000000000001'),
('98300000-0000-0000-0000-0000000000e2','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000c1','EV-P2','Pay Event 2','2026-10-02 14:00+04','2026-10-02 20:00+04',10,'A','CONFIRMED','98300000-0000-0000-0000-0000000000e2','98200000-0000-0000-0000-000000000001','98200000-0000-0000-0000-000000000001');
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('98300000-0000-0000-0000-0000000000f1','98300000-0000-0000-0000-0000000000a1','Pay Host','HOST',true,'PER_EVENT',0);

-- Attendance: 10.000 earned on e1 and 20.000 earned on e2.
insert into public.staff_attendance(id,organization_id,event_id,staff_member_id,attendance_date,shift,check_in,check_out,break_minutes,hours_worked,status,wage_method,wage_rate,earned_amount,recorded_by,idempotency_key,request_fingerprint) values
('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e1','98300000-0000-0000-0000-0000000000f1','2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:00+04',0,5,'PRESENT','PER_EVENT',10.000,10.000,'98200000-0000-0000-0000-000000000001','98300000-0000-0000-0000-0000000000a1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
('98300000-0000-0000-0000-0000000000a2','98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000e2','98300000-0000-0000-0000-0000000000f1','2026-10-02','MORNING','2026-10-02 14:00+04','2026-10-02 19:00+04',0,5,'PRESENT','PER_EVENT',20.000,20.000,'98200000-0000-0000-0000-000000000001','98300000-0000-0000-0000-0000000000a2','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"98200000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1. Multi-event payout with explicit allocations (5 to e1, 15 to e2 = 20).
select lives_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',20.000,'2026-10-03','CASH',null,'multi-event',
    '[{"event_id":"98300000-0000-0000-0000-0000000000e1","amount":5.000},{"event_id":"98300000-0000-0000-0000-0000000000e2","amount":15.000}]'::jsonb,
    null,null,null,null,'98300000-0000-0000-0000-000000000001')
$sql$,'multi-event payout is recorded');
select is((select count(*)::int from public.host_payout_allocations where organization_id='98300000-0000-0000-0000-0000000000a1'),2,'two explicit allocations are stored');
select is((select amount::text from public.host_payout_summaries where organization_id='98300000-0000-0000-0000-0000000000a1'),'20.000','payout header amount is 20.000 OMR');

-- 2. Allocation total must equal the payout amount (OMR 0.001 precision).
select throws_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',40.000,'2026-10-03','CASH',null,'bad',
    '[{"event_id":"98300000-0000-0000-0000-0000000000e1","amount":30.000}]'::jsonb,
    null,null,null,null,'98300000-0000-0000-0000-000000000002')
$sql$,'23514','PAYOUT_ALLOCATION_TOTAL_MISMATCH','allocation sum must equal payout amount');

-- 3. Allocation to an event outside the org is rejected.
select throws_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',20.000,'2026-10-03','CASH',null,'bad',
    '[{"event_id":"98300000-0000-0000-0000-0000000000ff","amount":20.000}]'::jsonb,
    null,null,null,null,'98300000-0000-0000-0000-000000000003')
$sql$,'23503','PAYOUT_ALLOCATION_EVENT_NOT_IN_ORG','foreign event allocation rejected');

-- 4/5. Invalid allocation amounts.
select throws_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',20.000,'2026-10-03','CASH',null,'bad',
    '[{"event_id":"98300000-0000-0000-0000-0000000000e1","amount":0}]'::jsonb,
    null,null,null,null,'98300000-0000-0000-0000-000000000004')
$sql$,'22023','PAYOUT_ALLOCATION_AMOUNT_INVALID','zero allocation amount rejected');
select throws_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',20.000,'2026-10-03','CASH',null,'bad',
    '[{"event_id":"98300000-0000-0000-0000-0000000000e1","amount":20.0001}]'::jsonb,
    null,null,null,null,'98300000-0000-0000-0000-000000000005')
$sql$,'22023','OMR_PRECISION_EXCEEDED','4-decimal allocation rejected (OMR 3dp)');

-- 6. Per-event paid totals are derived from allocations.
select is((select payouts_total::text from public.host_event_payroll_summaries where organization_id='98300000-0000-0000-0000-0000000000a1' and event_id='98300000-0000-0000-0000-0000000000e1'),'5.000','event 1 paid total reflects its allocation');
select is((select payouts_total::text from public.host_event_payroll_summaries where organization_id='98300000-0000-0000-0000-0000000000a1' and event_id='98300000-0000-0000-0000-0000000000e2'),'15.000','event 2 paid total reflects its allocation');
select is((select payouts_total::text from public.get_host_payroll_summary('98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1','98300000-0000-0000-0000-0000000000e1')),'5.000','authoritative rollup includes event allocation');

-- 7. Allocations are append-only.
select throws_ok($sql$update public.host_payout_allocations set amount = 999 where organization_id='98300000-0000-0000-0000-0000000000a1'$sql$,'42501',null,'allocations are append-only');

-- 8. Voiding the payout removes its allocations from derived totals.
select lives_ok($sql$select public.void_host_payout('98300000-0000-0000-0000-0000000000a1',(select payout_id from public.host_payout_summaries where organization_id='98300000-0000-0000-0000-0000000000a1' and amount = 20.000),'mistake','98300000-0000-0000-0000-000000000006')$sql$,'payout is voided');
select is((select payouts_total::text from public.host_event_payroll_summaries where organization_id='98300000-0000-0000-0000-0000000000a1' and event_id='98300000-0000-0000-0000-0000000000e1'),'0.000','voided payout no longer counts against event paid total');

-- 9. Receipt evidence is attached to the payout (and explicit when absent).
insert into storage.objects(bucket_id, name, owner) values
('attachments','98300000-0000-0000-0000-0000000000a1/HOST_PAYOUT_RECEIPT/host_payout/receipt.jpg','98200000-0000-0000-0000-000000000001');
select lives_ok($sql$
  select public.record_host_payout_multi(
    '98300000-0000-0000-0000-0000000000a1','98300000-0000-0000-0000-0000000000f1',5.000,'2026-10-03','BANK_TRANSFER','TRX-1','receipt',
    '[{"event_id":"98300000-0000-0000-0000-0000000000e1","amount":5.000}]'::jsonb,
    '98300000-0000-0000-0000-0000000000a1/HOST_PAYOUT_RECEIPT/host_payout/receipt.jpg','receipt.jpg','image/jpeg',100,
    '98300000-0000-0000-0000-000000000007')
$sql$,'payout with receipt evidence is recorded');
select is((select count(*)::int from public.attachment_evidence where organization_id='98300000-0000-0000-0000-0000000000a1' and evidence_type='HOST_PAYOUT_RECEIPT'),1,'receipt is stored as payout evidence');

select finish();
rollback;
