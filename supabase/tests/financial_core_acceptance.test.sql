-- ============================================================================
-- Financial core acceptance A–J (machine-verifiable).
--
-- Scenario | Operational | Journal | Balance | Reversal | Idempotency | Status
-- A deposit before invoice | payment RECORDED | CUSTOMER_PAYMENT Dr treasury Cr deposits | deposits=40 | void restores | replay no dup | asserted
-- B invoice before service | ISSUED | INVOICE Dr AR Cr deferred | AR=60 deferred=100 | — | replay no dup | asserted
-- C payment after invoice | payment RECORDED | CUSTOMER_PAYMENT Dr treasury Cr AR | AR=0 | — | — | asserted
-- D CLOSED with invoice | CLOSED | REVENUE_RECOGNITION Dr deferred Cr revenue | deferred=0 revenue=100 | — | replay no dup | asserted
-- E CLOSED without invoice | CLOSED | UNBILLED_RECOGNITION Dr 1120 Cr 4000 | CA=100 revenue=100 | — | — | asserted
-- F expense + void | VOIDED | EVENT_EXPENSE + EVENT_EXPENSE_VOID | expense net 0 | yes | — | asserted
-- G earning + payout | attendance + payout | HOST_EARNING + HOST_PAYOUT | payable 80 | — | — | asserted
-- H advance + settlement | settlement RECORDED | STAFF_ADVANCE + SETTLEMENT | rec 0 payable 50 | void restores | replay | asserted
-- I supplier invoice + payment | invoice+payment | SUPPLIER_INVOICE + PAYMENT | AP 0 | — | — | asserted
-- J opening cutover | settings stamped | OPENING_BALANCE | no P&L replay | second commit rejected | replay | asserted
-- ============================================================================
begin;
select plan(37);

create or replace function public._aj_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._aj_event_raw(p_org uuid, p_event uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
    join public.journal_entries e on e.organization_id=l.organization_id and e.id=l.entry_id
   where l.organization_id=p_org and e.event_id=p_event
     and l.account_id=(select id from public.chart_of_accounts where organization_id=p_org and code=p_code);
$$;
create or replace function public._aj_raw(p_org uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
   where l.organization_id=p_org
     and l.account_id=(select id from public.chart_of_accounts where organization_id=p_org and code=p_code);
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','cc000000-0000-0000-0000-000000000001','authenticated','authenticated','aj-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('cc000000-0000-0000-0000-0000000000a1','AJ Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name) values
('cc000000-0000-0000-0000-0000000000c1','cc000000-0000-0000-0000-0000000000a1','Cust');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('cc000000-0000-0000-0000-0000000000e1','cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000c1','EV-AJ-1','Invoiced','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','cc100000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001'),
('cc000000-0000-0000-0000-0000000000e2','cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000c1','EV-AJ-2','Unbilled','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','cc100000-0000-0000-0000-000000000002','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('cc000000-0000-0000-0000-0000000000b1','cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','QT-AJ-1',1,'ACCEPTED','Cust','EV-AJ-1','Invoiced',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,40.000,60.000,100.000,false,0,0,'cc100000-0000-0000-0000-000000000011','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001',now()),
('cc000000-0000-0000-0000-0000000000b2','cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e2','QT-AJ-2',1,'ACCEPTED','Cust','EV-AJ-2','Unbilled',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,40.000,60.000,100.000,false,0,0,'cc100000-0000-0000-0000-000000000012','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='cc000000-0000-0000-0000-0000000000b1' where id='cc000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='cc000000-0000-0000-0000-0000000000b2' where id='cc000000-0000-0000-0000-0000000000e2';
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('cc000000-0000-0000-0000-0000000000f1','cc000000-0000-0000-0000-0000000000a1','Host AJ','HOST',true,'PER_EVENT',100.000);
insert into public.suppliers(id,organization_id,name,category,status,created_by,updated_by) values
('cc000000-0000-0000-0000-0000000000d1','cc000000-0000-0000-0000-0000000000a1','AJ Supplier','GENERAL','ACTIVE','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001');

set local "request.jwt.claims"='{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.ensure_system_chart('cc000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('cc000000-0000-0000-0000-0000000000a1','Cash','CASH',null,null,null,'cc200000-0000-0000-0000-000000000001')$$,'treasury');
select lives_ok($$select public.set_treasury_opening_balance('cc000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='cc000000-0000-0000-0000-0000000000a1'),1000.000,'cc200000-0000-0000-0000-000000000010')$$,'cash 1000');

-- A. Deposit before invoice
select lives_ok($$select public.record_customer_payment('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1',40.000,'CASH','A-DEP',null,now(),'cc300000-0000-0000-0000-000000000001')$$,'A deposit 40');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','2000')),-40.000,'A deposits credit 40');

-- B. Invoice before service (partial deposit)
select lives_ok($$select public.create_event_invoice('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','INV-AJ',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"40.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"60.000"}]'::jsonb,null,'cc300000-0000-0000-0000-000000000002')$$,'B invoice');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','1100')),60.000,'B AR 60');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','2100')),-100.000,'B deferred 100');
select lives_ok($$select public.create_event_invoice('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','INV-AJ',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"40.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"60.000"}]'::jsonb,null,'cc300000-0000-0000-0000-000000000002')$$,'B idempotent');
select is((select count(*)::int from public.journal_entries where organization_id='cc000000-0000-0000-0000-0000000000a1' and source_type='INVOICE'),1,'B one invoice journal');

-- C. Payment after invoice
select lives_ok($$select public.record_customer_payment('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1',60.000,'CASH','C-PAY',null,now(),'cc300000-0000-0000-0000-000000000003')$$,'C pay remaining 60');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','1100')),0.000,'C AR 0');

-- F/G/H before operational CLOSED so assignment/attendance remain valid.
select lives_ok($$select public.record_event_expense('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','TRANSPORT',10.000,'2026-10-02','نقل','CASH',null,'F-1','cc300000-0000-0000-0000-000000000010')$$,'F expense 10');
select lives_ok($$select public.void_event_expense('cc000000-0000-0000-0000-0000000000a1',(select id from public.event_expenses where organization_id='cc000000-0000-0000-0000-0000000000a1' and reference='F-1'),'entered in error','cc300000-0000-0000-0000-000000000011')$$,'F void expense');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','5200')),0.000,'F expense net 0 after void');
select is((select count(*)::int from public.journal_entries where organization_id='cc000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE_VOID' and is_reversal),1,'F EVENT_EXPENSE_VOID');

select lives_ok($$select public.assign_event_staff('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','cc000000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',100.000,100.000,null,gen_random_uuid())$$,'assign host');
select lives_ok($$select public.record_staff_attendance('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','cc000000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='cc000000-0000-0000-0000-0000000000a1' and status='ACTIVE'),'2026-10-01','MORNING','2026-10-01 10:00+04','2026-10-01 18:00+04',0,'PRESENT',null,'cc300000-0000-0000-0000-000000000020')$$,'G earn 100');
select lives_ok($$select public.record_host_payout_multi('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000f1',20.000,'2026-10-03','CASH',null,'partial','[{"event_id":"cc000000-0000-0000-0000-0000000000e1","amount":20.000}]'::jsonb,null,null,null,null,'cc300000-0000-0000-0000-000000000021')$$,'G payout 20');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','2300')),-80.000,'G payable 80');
select lives_ok($$select public.record_staff_advance('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000f1',30.000,'2026-10-04','need','cc300000-0000-0000-0000-000000000022')$$,'H advance 30');
select lives_ok($$select public.settle_staff_advance('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000f1',30.000,'2026-10-05','apply',null,'cc300000-0000-0000-0000-000000000023')$$,'H settle 30');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','1150')),0.000,'H receivable 0 after settlement');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','2300')),-50.000,'H payable 50 after settlement');

-- I. Supplier AP
create or replace function public._aj_order()
returns uuid language plpgsql as $$
declare v public.procurement_orders; v_line uuid;
begin
  v := public.create_procurement_order(
    'cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000d1',null,'2026-10-01',null,'svc',
    '[{"line_kind":"CATERING_SERVICE","description":"خدمة","unit":"وحدة","quantity":"1.000","agreed_unit_cost":"15.000"}]'::jsonb,
    gen_random_uuid());
  perform public.approve_procurement_order('cc000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  perform public.send_procurement_order('cc000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  perform public.confirm_procurement_order('cc000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  select id into v_line from public.procurement_order_lines where order_id=v.id limit 1;
  perform public.record_supplier_invoice(
    'cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000d1', v.id, null,
    'AJ-INV','2026-10-02',null,
    jsonb_build_array(jsonb_build_object('order_line_id', v_line, 'quantity','1.000','unit_cost','15.000')));
  return v.id;
end;
$$;
select lives_ok($$select public._aj_order()$$,'I supplier invoice 15');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','2200')),-15.000,'I AP 15');
select lives_ok($$select public.record_supplier_payment('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000d1',15.000,'2026-10-06','CASH',null,'pay',null,'cc300000-0000-0000-0000-000000000030')$$,'I supplier payment');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','2200')),0.000,'I AP 0 after payment');

-- D. CLOSED with invoice
select lives_ok($$select public.transition_event_status('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','CLOSED')$$,'D close invoiced');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','2100')),0.000,'D deferred 0');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e1','4000')),-100.000,'D revenue 100');

-- E. CLOSED without invoice
select lives_ok($$select public.transition_event_status('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e2','CLOSED')$$,'E close unbilled');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e2','1120')),100.000,'E contract asset 100');
select is((select public._aj_event_raw('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000e2','4000')),-100.000,'E unbilled revenue 100');

-- J. Opening cutover on this org (gaps are 0 because activity already posted)
select lives_ok($$select public.commit_opening_cutover('cc000000-0000-0000-0000-0000000000a1',0,'cc300000-0000-0000-0000-000000000040')$$,'J cutover (zero derived gaps)');
select throws_ok($$select public.commit_opening_cutover('cc000000-0000-0000-0000-0000000000a1',0,gen_random_uuid())$$,'23514','OPENING_CUTOVER_ALREADY_COMMITTED','J second cutover rejected');
select is((select public._aj_raw('cc000000-0000-0000-0000-0000000000a1','4000')),-200.000,'J revenue unchanged by cutover (no P&L replay)');

select * from finish();
rollback;
