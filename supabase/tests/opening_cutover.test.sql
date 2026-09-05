-- ============================================================================
-- 0093 — opening cutover (Strategy B) pgTAP.
--
-- Scenario J: owner-provided VAT + treasury (0085) + derived customer /
-- payroll / AP openings from pre-ledger operational facts. Historical P&L
-- is NOT replayed. Repeat commit is rejected. Equity 3000 balances.
-- ============================================================================
begin;
select plan(17);

create or replace function public._o_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._o_raw(p_org uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
   where l.organization_id = p_org
     and l.account_id = (select id from public.chart_of_accounts where organization_id = p_org and code = p_code);
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-000000000001','authenticated','authenticated','cut-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('cb000000-0000-0000-0000-0000000000a1','Cutover Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name) values
('cb000000-0000-0000-0000-0000000000c1','cb000000-0000-0000-0000-0000000000a1','Cust');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('cb000000-0000-0000-0000-0000000000e1','cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000c1','EV-CUT-1','Open Ev','2026-09-01 10:00+04','2026-09-01 20:00+04',10,'Muscat','CONFIRMED','cb100000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001'),
('cb000000-0000-0000-0000-0000000000e2','cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000c1','EV-CUT-2','Closed unbilled','2026-09-01 10:00+04','2026-09-01 20:00+04',10,'Muscat','CLOSED','cb100000-0000-0000-0000-000000000002','cb000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000e1','QT-CUT-1',1,'ACCEPTED','Cust','EV-CUT-1','Open Ev',10,'2026-09-01 10:00+04','2026-09-01 20:00+04','Muscat',100.000,40.000,60.000,100.000,false,0,0,'cb100000-0000-0000-0000-000000000011','cb000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001',now()),
('cb000000-0000-0000-0000-0000000000b2','cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000e2','QT-CUT-2',1,'ACCEPTED','Cust','EV-CUT-2','Closed unbilled',10,'2026-09-01 10:00+04','2026-09-01 20:00+04','Muscat',80.000,30.000,50.000,80.000,false,0,0,'cb100000-0000-0000-0000-000000000012','cb000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='cb000000-0000-0000-0000-0000000000b1' where id='cb000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='cb000000-0000-0000-0000-0000000000b2' where id='cb000000-0000-0000-0000-0000000000e2';

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('cb000000-0000-0000-0000-0000000000f1','cb000000-0000-0000-0000-0000000000a1','Host C','HOST',true,'PER_EVENT',50.000);

-- Pre-ledger operational facts (no journals): deposit 40 on open event,
-- and a raw attendance earning 50 (auth.uid() null so the 0089 trigger skips).
insert into public.customer_payments (
  id, organization_id, event_id, amount, payment_method, reference, paid_at,
  recorded_by, idempotency_key, request_fingerprint
) values (
  'cb000000-0000-0000-0000-0000000000aa','cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000e1',
  40.000,'CASH','PRE-LEDGER',now(),
  'cb000000-0000-0000-0000-000000000001','cb300000-0000-0000-0000-000000000001',
  repeat('a', 64)
);

reset "request.jwt.claims";
insert into public.staff_attendance (
  organization_id, event_id, staff_member_id, attendance_date, shift,
  check_in, check_out, break_minutes, hours_worked, status, wage_method, wage_rate,
  earned_amount, recorded_by, idempotency_key, request_fingerprint
) values (
  'cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000e1','cb000000-0000-0000-0000-0000000000f1',
  '2026-09-01','MORNING','2026-09-01 10:00+04','2026-09-01 18:00+04',0,8,'PRESENT','PER_EVENT',50.000,50.000,
  'cb000000-0000-0000-0000-000000000001','cb300000-0000-0000-0000-000000000002', repeat('b', 64)
);

set local "request.jwt.claims"='{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.ensure_system_chart('cb000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('cb000000-0000-0000-0000-0000000000a1','Main Cash','CASH',null,null,null,'cb200000-0000-0000-0000-000000000001')$$,'treasury');
select lives_ok($$select public.set_treasury_opening_balance('cb000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='cb000000-0000-0000-0000-0000000000a1'),250.000,'cb200000-0000-0000-0000-000000000010')$$,'owner treasury opening 250');

select is((select count(*)::int from public.journal_entries where organization_id='cb000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT'),0,'pre-ledger payment has no journal');
select is((select count(*)::int from public.journal_entries where organization_id='cb000000-0000-0000-0000-0000000000a1' and source_type='HOST_EARNING'),0,'pre-ledger attendance has no journal');

select lives_ok($$select public.commit_opening_cutover('cb000000-0000-0000-0000-0000000000a1',25.000,'cb400000-0000-0000-0000-000000000001')$$,'commit cutover vat 25');

-- Open event: no invoice, not CLOSED → deposits 40, AR 0, deferred 0, CA 0.
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','2000')),-40.000,'opening deposits credit 40');
-- Closed unbilled, P=0, Q=80 → contract asset 80. No revenue replayed.
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','1120')),80.000,'opening contract asset 80');
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','4000')),0.000,'historical P&L not replayed (revenue 0)');
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','5000')),0.000,'historical staff cost not replayed');
-- Payroll N = 50 - 0 - 0 = 50 → opening payable 50.
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','2300')),-50.000,'opening payroll payable 50');
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','2150')),-25.000,'opening VAT payable 25 (owner-provided)');
-- Treasury 250 (debit) already posted by 0085.
select is((select public._o_raw('cb000000-0000-0000-0000-0000000000a1','3000')),
  -(250.000 - 40.000 + 80.000 - 50.000 - 25.000),
  'opening equity balances assets vs liabilities');

select lives_ok($$select public.commit_opening_cutover('cb000000-0000-0000-0000-0000000000a1',25.000,'cb400000-0000-0000-0000-000000000001')$$,'idempotent replay');
select throws_ok($$select public.commit_opening_cutover('cb000000-0000-0000-0000-0000000000a1',25.000,gen_random_uuid())$$,'23514','OPENING_CUTOVER_ALREADY_COMMITTED','second cutover rejected');

select is((select count(*)::int from public.accounting_reconciliation('cb000000-0000-0000-0000-0000000000a1') r where r.status='DIFFERENCE'),0,'reconciliation MATCHED after cutover');
select is((select accounting_cutover_vat_payable from public.organization_settings where organization_id='cb000000-0000-0000-0000-0000000000a1'),25.000,'cutover vat stamped');

select * from finish();
rollback;
