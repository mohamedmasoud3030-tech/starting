-- ============================================================================
-- 0092 — staff advance settlement pgTAP.
--
-- Scenario H (settlement): Dr 2300 / Cr 1150; never negative payable or
-- receivable; optional advance cap; void restores both; idempotent replay;
-- capability + cross-org isolation.
-- ============================================================================
begin;
select plan(22);

create or replace function public._s_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._s_debit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;
create or replace function public._s_credit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(credit) - sum(debit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-000000000001','authenticated','authenticated','st-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-000000000002','authenticated','authenticated','st-sup@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-000000000003','authenticated','authenticated','st-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('ca000000-0000-0000-0000-0000000000a1','Settle Org A'),
('ca000000-0000-0000-0000-0000000000b1','Settle Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-000000000001','OWNER'),
('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-000000000002','SUPERVISOR'),
('ca000000-0000-0000-0000-0000000000b1','ca000000-0000-0000-0000-000000000003','OWNER');
insert into public.customers(id,organization_id,name) values
('ca000000-0000-0000-0000-0000000000c1','ca000000-0000-0000-0000-0000000000a1','Cust');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('ca000000-0000-0000-0000-0000000000e1','ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000c1','EV-ST-1','Settle Ev','2026-10-01 10:00+04','2026-10-01 20:00+04',20,'Muscat','CONFIRMED','ca100000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001');
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('ca000000-0000-0000-0000-0000000000f1','ca000000-0000-0000-0000-0000000000a1','Host S','HOST',true,'PER_EVENT',100.000);

set local "request.jwt.claims"='{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('ca000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('ca000000-0000-0000-0000-0000000000a1','Cash','CASH',null,null,null,'ca200000-0000-0000-0000-000000000001')$$,'treasury');
select lives_ok($$select public.set_treasury_opening_balance('ca000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='ca000000-0000-0000-0000-0000000000a1'),500.000,'ca200000-0000-0000-0000-000000000010')$$,'opening cash 500');
select lives_ok($$select public.assign_event_staff('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000e1','ca000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',100.000,100.000,null,gen_random_uuid())$$,'assign');
select lives_ok($$select public.record_staff_attendance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000e1','ca000000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='ca000000-0000-0000-0000-0000000000a1' and status='ACTIVE'),'2026-10-01','MORNING','2026-10-01 10:00+04','2026-10-01 18:00+04',0,'PRESENT',null,'ca300000-0000-0000-0000-000000000001')$$,'earn 100');
select lives_ok($$select public.record_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',40.000,'2026-10-02','need','ca300000-0000-0000-0000-000000000002')$$,'advance 40');

select is((select public._s_credit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','2300'))),100.000,'payable 100');
select is((select public._s_debit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','1150'))),40.000,'receivable 40');

select lives_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',40.000,'2026-10-03','apply',(select id from public.staff_advances where organization_id='ca000000-0000-0000-0000-0000000000a1' and status='RECORDED'),'ca300000-0000-0000-0000-000000000003')$$,'settle 40');
select is((select public._s_credit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','2300'))),60.000,'payable 100-40=60');
select is((select public._s_debit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','1150'))),0.000,'receivable 0');
select is((select count(*)::int from public.journal_entries where organization_id='ca000000-0000-0000-0000-0000000000a1' and source_type='STAFF_ADVANCE_SETTLEMENT' and not is_reversal),1,'one settlement journal');

select lives_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',40.000,'2026-10-03','apply',(select id from public.staff_advances where organization_id='ca000000-0000-0000-0000-0000000000a1' and status='RECORDED'),'ca300000-0000-0000-0000-000000000003')$$,'idempotent replay');
select is((select count(*)::int from public.journal_entries where organization_id='ca000000-0000-0000-0000-0000000000a1' and source_type='STAFF_ADVANCE_SETTLEMENT' and not is_reversal),1,'no duplicate journal on replay');

select throws_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',10.000,'2026-10-04','x',null,gen_random_uuid())$$,'23514','STAFF_RECEIVABLE_ZERO','cannot settle when receivable is 0');

select lives_ok($$select public.void_staff_advance_settlement('ca000000-0000-0000-0000-0000000000a1',(select id from public.staff_advance_settlements where organization_id='ca000000-0000-0000-0000-0000000000a1'),'undo settle','ca300000-0000-0000-0000-000000000004')$$,'void settlement');
select is((select public._s_credit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','2300'))),100.000,'payable restored to 100');
select is((select public._s_debit('ca000000-0000-0000-0000-0000000000a1',public._s_chart('ca000000-0000-0000-0000-0000000000a1','1150'))),40.000,'receivable restored to 40');
select throws_ok($$select public.void_staff_advance_settlement('ca000000-0000-0000-0000-0000000000a1',(select id from public.staff_advance_settlements where organization_id='ca000000-0000-0000-0000-0000000000a1'),'again',gen_random_uuid())$$,'P0001','SETTLEMENT_ALREADY_VOIDED','repeat void rejected');

select throws_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',200.000,'2026-10-05','too much',null,gen_random_uuid())$$,'23514','SETTLEMENT_EXCEEDS_PAYABLE','amount > payable rejected');

set local "request.jwt.claims"='{"sub":"ca000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',10.000,'2026-10-05','x',null,gen_random_uuid())$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot settle');
set local "request.jwt.claims"='{"sub":"ca000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.settle_staff_advance('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000f1',10.000,'2026-10-05','x',null,gen_random_uuid())$$,'42501','NOT_AUTHORIZED','cross-org settlement rejected');

select * from finish();
rollback;
