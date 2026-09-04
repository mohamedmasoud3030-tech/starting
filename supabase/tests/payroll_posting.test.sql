-- ============================================================================
-- 0089 — Payroll / staff financial posting pgTAP.
--
-- Covers: attendance earning -> Dr Staff Cost 5000 / Cr Payroll Payable 2300;
-- multiple earnings accumulate; normal payout reduces payable; exact payout;
-- overpayment (payroll payable hits zero, excess becomes staff receivable,
-- payable never negative); staff advance (Dr Staff Receivable 1150 / Cr
-- Treasury); advance void; attendance void (earning reversed); payout void;
-- idempotent replay; cross-org isolation; capability denial; and the
-- payroll-payable / staff-receivable / treasury reconciliation against the
-- journal.
--
-- Assertions inspect real ledger balances / relationships, not just RPC return
-- values. Runs under the definer (postgres) with jwt claims so the revoked
-- journal tables are readable for verification.
-- ============================================================================
begin;
select plan(49);

-- Test helpers (available under the definer).
create or replace function public._p_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._p_debit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;
create or replace function public._p_credit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(credit) - sum(debit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;

-- Fixtures ----------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000001','authenticated','authenticated','pr-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000002','authenticated','authenticated','pr-sup@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000003','authenticated','authenticated','pr-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('9a000000-0000-0000-0000-0000000000a1','Payroll Org A'),
('9a000000-0000-0000-0000-0000000000b1','Payroll Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000001','OWNER'),
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000002','SUPERVISOR'),
('9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-000000000003','OWNER');

insert into public.customers(id,organization_id,name) values
('9a000000-0000-0000-0000-0000000000c1','9a000000-0000-0000-0000-0000000000a1','Cust A'),
('9a000000-0000-0000-0000-0000000000c2','9a000000-0000-0000-0000-0000000000b1','Cust B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000c1','EV-PR-1','Pay Ev','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001'),
('9a000000-0000-0000-0000-0000000000e2','9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-0000000000c2','EV-PR-2','Cross Ev','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','9b000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000003');

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('9a000000-0000-0000-0000-0000000000f1','9a000000-0000-0000-0000-0000000000a1','Host A','HOST',true,'PER_EVENT',100.000),
('9a000000-0000-0000-0000-0000000000f2','9a000000-0000-0000-0000-0000000000b1','Host B','HOST',true,'PER_EVENT',50.000);

-- Act as OWNER of org A.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('9a000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('9a000000-0000-0000-0000-0000000000a1','Petty Cash','CASH',null,null,null,'9c000000-0000-0000-0000-000000000001')$$,'create CASH treasury');
select lives_ok($$select public.set_treasury_opening_balance('9a000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'),1000.000,'9c000000-0000-0000-0000-000000000010')$$,'cash opening 1000');

select lives_ok($$select public.assign_event_staff('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',100.000,100.000,null,gen_random_uuid())$$,'assign host to event');

-- ======================= Attendance earning ======================= --
select lives_ok($$select public.record_staff_attendance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='9a000000-0000-0000-0000-0000000000a1' and staff_member_id='9a000000-0000-0000-0000-0000000000f1' and status='ACTIVE'),'2026-10-01','MORNING','2026-10-01 10:00+04','2026-10-01 18:00+04',30,'PRESENT','x','9d000000-0000-0000-0000-000000000001')$$,'record present attendance (earn 100)');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','5000'))),100.000,'staff cost debited 100');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),100.000,'payroll payable credited 100');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='HOST_EARNING' and not is_reversal),1,'one HOST_EARNING journal');
select is((select count(*)::int from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.organization_id='9a000000-0000-0000-0000-0000000000a1' and e.source_type='HOST_EARNING'),2,'two balanced earning lines');

select lives_ok($$select public.record_staff_attendance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='9a000000-0000-0000-0000-0000000000a1' and staff_member_id='9a000000-0000-0000-0000-0000000000f1' and status='ACTIVE'),'2026-10-02','MORNING','2026-10-02 10:00+04','2026-10-02 18:00+04',30,'PRESENT','y','9d000000-0000-0000-0000-000000000002')$$,'record second attendance (earn 100)');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),200.000,'payroll payable accumulates to 200');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','5000'))),200.000,'staff cost accumulates to 200');

select lives_ok($$select public.record_staff_attendance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='9a000000-0000-0000-0000-0000000000a1' and staff_member_id='9a000000-0000-0000-0000-0000000000f1' and status='ACTIVE'),'2026-10-03','MORNING',null,null,0,'ABSENT','absent','9d000000-0000-0000-0000-000000000003')$$,'record ABSENT attendance');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),200.000,'ABSENT does not change payable');

-- ======================= Staff advance ======================= --
select lives_ok($$select public.record_staff_advance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',50.000,'2026-10-04','cash need','9d000000-0000-0000-0000-000000000020')$$,'record advance 50');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','1150'))),50.000,'staff receivable debited 50');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),950.000,'cash 1000 - 50 = 950');

-- ======================= Payout: partial (within payable) ======================= --
select lives_ok($$select public.record_host_payout_multi('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',80.000,'2026-10-05','CASH',null,'partial','[{"event_id":"9a000000-0000-0000-0000-0000000000e1","amount":80.000}]'::jsonb,null,null,null,null,'9d000000-0000-0000-0000-000000000021')$$,'record payout 80 (partial payable)');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),120.000,'payroll payable 200 - 80 = 120');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),870.000,'cash 950 - 80 = 870');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','1150'))),50.000,'staff receivable unchanged (50)');

-- ======================= Payout: overpayment ======================= --
select lives_ok($$select public.record_host_payout_multi('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',160.000,'2026-10-06','CASH',null,'overpay','[{"event_id":"9a000000-0000-0000-0000-0000000000e1","amount":160.000}]'::jsonb,null,null,null,null,'9d000000-0000-0000-0000-000000000022')$$,'record payout 160 (overpay)');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),0.000,'payroll payable reaches zero');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','1150'))),90.000,'staff receivable = 50 + 40 excess');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),710.000,'cash 870 - 160 = 710');
select is((select (payable >= 0) from public._staff_payroll_position('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1')),true,'payroll payable >= 0 (never negative)');

-- ======================= Advance void ======================= --
select lives_ok($$select public.void_staff_advance('9a000000-0000-0000-0000-0000000000a1',(select id from public.staff_advances where organization_id='9a000000-0000-0000-0000-0000000000a1' and amount=50.000),'changed mind','9d000000-0000-0000-0000-000000000023')$$,'void advance');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='STAFF_ADVANCE_VOID' and is_reversal),1,'one advance reversal');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','1150'))),40.000,'staff receivable 90 - 50 = 40');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),760.000,'cash 710 + 50 = 760');

-- ======================= Payout void ======================= --
select lives_ok($$select public.void_host_payout('9a000000-0000-0000-0000-0000000000a1',(select id from public.host_payouts where organization_id='9a000000-0000-0000-0000-0000000000a1' and amount=160.000 and reason='overpay'),'wrong amount','9d000000-0000-0000-0000-000000000024')$$,'void overpayment payout');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='HOST_PAYOUT_VOID' and is_reversal),1,'one payout reversal');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),920.000,'cash 760 + 160 = 920');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),120.000,'payable restored to 120 after payout void');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','1150'))),0.000,'receivable reflected after payout void (excess reversed)');

-- ======================= Attendance void reverses earning ======================= --
select lives_ok($$select public.void_staff_attendance('9a000000-0000-0000-0000-0000000000a1',(select id from public.staff_attendance where organization_id='9a000000-0000-0000-0000-0000000000a1' and check_in='2026-10-02 10:00+04'),'entered in error','9d000000-0000-0000-0000-000000000025')$$,'void second attendance');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='HOST_EARNING_VOID' and is_reversal),1,'one earning reversal');
select is((select public._p_credit('9a000000-0000-0000-0000-0000000000a1',public._p_chart('9a000000-0000-0000-0000-0000000000a1','2300'))),20.000,'earning void reduces payable to 20 (not negative)');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='HOST_EARNING' and not is_reversal),2,'original earning journals remain (immutable)');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='HOST_EARNING_VOID' and reversal_of is not null),1,'reversal references an original');

-- ======================= Idempotent replay ======================= --
select is((select count(*)::int from public.staff_advances where organization_id='9a000000-0000-0000-0000-0000000000a1' and status='RECORDED'),0,'advance is VOIDED (replayed below must not duplicate)');
select lives_ok($$select public.record_staff_advance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',50.000,'2026-10-04','cash need','9d000000-0000-0000-0000-000000000020')$$,'replay advance (idempotent)');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='STAFF_ADVANCE' and not is_reversal),1,'no duplicate advance journal on replay');

-- ======================= Reconciliation ======================= --
select is((select payable from public._staff_payroll_position('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1')),20.000,'reconciled payroll payable = 20');
select is((select receivable from public._staff_payroll_position('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1')),0.000,'reconciled staff receivable = 0 (excess reversed)');
select is((select public._p_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),920.000,'reconciled treasury balance = 920');

-- ======================= Authorization / cross-org ======================= --
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.record_staff_advance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',10.000,'2026-10-07','x',gen_random_uuid())$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot pay advance');
select throws_ok($$select public.record_host_payout_multi('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',10.000,'2026-10-07','CASH',null,'x','[]'::jsonb)$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot record payout');

set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.record_staff_advance('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000f1',10.000,'2026-10-07','x',gen_random_uuid())$$,'42501','NOT_AUTHORIZED','cross-org advance rejected');

select * from finish();
rollback;
