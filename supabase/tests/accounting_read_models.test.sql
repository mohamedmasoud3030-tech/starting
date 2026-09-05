-- ============================================================================
-- 0094 — operator accounting read models (contract §20 Stage 3) pgTAP.
--
-- Coverage:
--   * trial balance: balanced totals, cross-check vs account_balance (0084),
--     window filtering, invalid window, opening equity visible;
--   * journal history: completeness, reversal linkage (reversed_by),
--     deterministic ordering across repeated calls, stable pagination,
--     limit/offset clamps;
--   * customer positions: §5 line-168 vocabulary, deposit/invoice/CLOSED
--     semantics, §17 outstanding identity, VAT net/gross deposits;
--   * supplier positions: AP wrapper vs 0093, invoice counts, zero rows;
--   * payroll positions: payable/receivable/net/advances vs 0093 STAFF row,
--     payroll.read gating;
--   * cutover status: stamp, opening census, strictly read-only;
--   * security: capability denial (SUPERVISOR / ACCOUNTANT-without-payroll),
--     cross-org denial, direct journal-lines access still revoked,
--     authenticated-role execution, anon denial;
--   * edge cases: empty org, zero balances, reversals/voids, same-day
--     ordering (all fixtures post on one accounting date).
-- ============================================================================
begin;
select plan(80);

-- Helpers -------------------------------------------------------------------
create or replace function public._rm_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;

-- Fixtures: org A (full lifecycle, non-VAT), org B (empty/isolation),
-- org C (VAT deposit + void).
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','dd000000-0000-0000-0000-000000000001','authenticated','authenticated','rm-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','dd000000-0000-0000-0000-000000000002','authenticated','authenticated','rm-super@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','dd000000-0000-0000-0000-000000000003','authenticated','authenticated','rm-accountant@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','dd000000-0000-0000-0000-000000000004','authenticated','authenticated','rm-owner-b@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','dd000000-0000-0000-0000-000000000005','authenticated','authenticated','rm-owner-c@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('dd000000-0000-0000-0000-0000000000a1','RM Org A'),
('dd000000-0000-0000-0000-0000000000b1','RM Org B'),
('dd000000-0000-0000-0000-0000000000c1','RM Org C');
insert into public.organization_memberships(organization_id,user_id,role) values
('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-000000000001','OWNER'),
('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-000000000002','SUPERVISOR'),
('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-000000000003','ACCOUNTANT'),
('dd000000-0000-0000-0000-0000000000b1','dd000000-0000-0000-0000-000000000004','OWNER'),
('dd000000-0000-0000-0000-0000000000c1','dd000000-0000-0000-0000-000000000005','OWNER');

-- ACCOUNTANT keeps cost.visibility but explicitly loses payroll.read.
insert into public.org_member_permissions(organization_id,user_id,capability,allowed,set_by) values
('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-000000000003','payroll.read',false,'dd000000-0000-0000-0000-000000000001');

insert into public.customers(id,organization_id,name) values
('dd000000-0000-0000-0000-0000000000c1','dd000000-0000-0000-0000-0000000000a1','Customer RM-A'),
('dd000000-0000-0000-0000-0000000000c2','dd000000-0000-0000-0000-0000000000b1','Customer RM-B'),
('dd000000-0000-0000-0000-0000000000c3','dd000000-0000-0000-0000-0000000000c1','Customer RM-C');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('dd000000-0000-0000-0000-0000000000e1','dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000c1','EV-RM-1','Invoiced','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','dd100000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001'),
('dd000000-0000-0000-0000-0000000000e2','dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000c1','EV-RM-2','Unbilled','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','dd100000-0000-0000-0000-000000000002','dd000000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001'),
('dd000000-0000-0000-0000-0000000000e3','dd000000-0000-0000-0000-0000000000b1','dd000000-0000-0000-0000-0000000000c2','EV-RM-B','Empty','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Salalah','CONFIRMED','dd100000-0000-0000-0000-000000000003','dd000000-0000-0000-0000-000000000004','dd000000-0000-0000-0000-000000000004'),
('dd000000-0000-0000-0000-0000000000e4','dd000000-0000-0000-0000-0000000000c1','dd000000-0000-0000-0000-0000000000c3','EV-RM-C','Vat','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','CONFIRMED','dd100000-0000-0000-0000-000000000004','dd000000-0000-0000-0000-000000000005','dd000000-0000-0000-0000-000000000005');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('dd000000-0000-0000-0000-0000000000f1','dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','QT-RM-1',1,'ACCEPTED','Customer RM-A','EV-RM-1','Invoiced',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',500.000,200.000,300.000,500.000,false,0,0.000,'dd100000-0000-0000-0000-000000000011','dd000000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001',now()),
('dd000000-0000-0000-0000-0000000000f2','dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e2','QT-RM-2',1,'ACCEPTED','Customer RM-A','EV-RM-2','Unbilled',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,40.000,60.000,100.000,false,0,0.000,'dd100000-0000-0000-0000-000000000012','dd000000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001',now()),
('dd000000-0000-0000-0000-0000000000f3','dd000000-0000-0000-0000-0000000000b1','dd000000-0000-0000-0000-0000000000e3','QT-RM-B',1,'ACCEPTED','Customer RM-B','EV-RM-B','Empty',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Salalah',400.000,100.000,300.000,400.000,false,0,0.000,'dd100000-0000-0000-0000-000000000013','dd000000-0000-0000-0000-000000000004','dd000000-0000-0000-0000-000000000004',now()),
('dd000000-0000-0000-0000-0000000000f4','dd000000-0000-0000-0000-0000000000c1','dd000000-0000-0000-0000-0000000000e4','QT-RM-C',1,'ACCEPTED','Customer RM-C','EV-RM-C','Vat',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',2100.000,1200.000,900.000,2000.000,true,5.000,100.000,'dd100000-0000-0000-0000-000000000014','dd000000-0000-0000-0000-000000000005','dd000000-0000-0000-0000-000000000005',now());
update public.events set accepted_quotation_id='dd000000-0000-0000-0000-0000000000f1' where id='dd000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='dd000000-0000-0000-0000-0000000000f2' where id='dd000000-0000-0000-0000-0000000000e2';
update public.events set accepted_quotation_id='dd000000-0000-0000-0000-0000000000f3' where id='dd000000-0000-0000-0000-0000000000e3';
update public.events set accepted_quotation_id='dd000000-0000-0000-0000-0000000000f4' where id='dd000000-0000-0000-0000-0000000000e4';

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('dd000000-0000-0000-0000-0000000000aa','dd000000-0000-0000-0000-0000000000a1','Host RM','HOST',true,'PER_EVENT',100.000);
insert into public.suppliers(id,organization_id,name,category,status,created_by,updated_by) values
('dd000000-0000-0000-0000-0000000000bb','dd000000-0000-0000-0000-0000000000a1','RM Supplier','GENERAL','ACTIVE','dd000000-0000-0000-0000-000000000001','dd000000-0000-0000-0000-000000000001');

-- Supplier order lifecycle helper (order -> approve -> send -> confirm -> invoice).
create or replace function public._rm_order()
returns uuid language plpgsql as $$
declare v public.procurement_orders; v_line uuid;
begin
  v := public.create_procurement_order(
    'dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000bb',null,'2026-10-01',null,'svc',
    '[{"line_kind":"CATERING_SERVICE","description":"خدمة","unit":"وحدة","quantity":"1.000","agreed_unit_cost":"15.000"}]'::jsonb,
    gen_random_uuid());
  perform public.approve_procurement_order('dd000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  perform public.send_procurement_order('dd000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  perform public.confirm_procurement_order('dd000000-0000-0000-0000-0000000000a1', v.id, gen_random_uuid());
  select id into v_line from public.procurement_order_lines where order_id=v.id limit 1;
  perform public.record_supplier_invoice(
    'dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000bb', v.id, null,
    'RM-INV','2026-10-02',null,
    jsonb_build_array(jsonb_build_object('order_line_id', v_line, 'quantity','1.000','unit_cost','15.000')));
  return v.id;
end;
$$;

-- Full lifecycle as OWNER of org A -----------------------------------------
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.ensure_system_chart('dd000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('dd000000-0000-0000-0000-0000000000a1','Cash','CASH',null,null,null,'dd200000-0000-0000-0000-000000000001')$$,'treasury');
select lives_ok($$select public.set_treasury_opening_balance('dd000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='dd000000-0000-0000-0000-0000000000a1'),1000.000,'dd200000-0000-0000-0000-000000000010')$$,'cash 1000');

select lives_ok($$select public.record_customer_payment('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1',150.000,'CASH','RM-DEP',null,now(),'dd300000-0000-0000-0000-000000000001')$$,'deposit 150');                                                                          -- [1]
select lives_ok($$select public.create_event_invoice('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','INV-RM',null,500.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"150.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"350.000"}]'::jsonb,null,'dd300000-0000-0000-0000-000000000002')$$,'invoice 500');   -- [2]
select lives_ok($$select public.record_customer_payment('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1',350.000,'CASH','RM-PAY',null,now(),'dd300000-0000-0000-0000-000000000003')$$,'pay remaining 350');                                                                        -- [3]
select lives_ok($$select public.record_event_expense('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','TRANSPORT',10.000,'2026-10-02','نقل','CASH',null,'RM-X-1','dd300000-0000-0000-0000-000000000010')$$,'expense 10');                                                            -- [4]
select lives_ok($$select public.void_event_expense('dd000000-0000-0000-0000-0000000000a1',(select id from public.event_expenses where organization_id='dd000000-0000-0000-0000-0000000000a1' and reference='RM-X-1'),'entered in error','dd300000-0000-0000-0000-000000000011')$$,'void expense');                                            -- [5]
select lives_ok($$select public.assign_event_staff('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','dd000000-0000-0000-0000-0000000000aa','HOST','PER_EVENT',100.000,100.000,null,gen_random_uuid())$$,'assign host');                                                                 -- [6]
select lives_ok($$select public.record_staff_attendance('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','dd000000-0000-0000-0000-0000000000aa',(select id from public.event_staff_assignments where organization_id='dd000000-0000-0000-0000-0000000000a1' and status='ACTIVE'),'2026-10-01','MORNING','2026-10-01 10:00+04','2026-10-01 18:00+04',0,'PRESENT',null,'dd300000-0000-0000-0000-000000000020')$$,'earn 100');   -- [7]
select lives_ok($$select public.record_host_payout_multi('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000aa',20.000,'2026-10-03','CASH',null,'partial','[{"event_id":"dd000000-0000-0000-0000-0000000000e1","amount":20.000}]'::jsonb,null,null,null,null,'dd300000-0000-0000-0000-000000000021')$$,'payout 20');   -- [8]
select lives_ok($$select public.record_staff_advance('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000aa',30.000,'2026-10-04','need','dd300000-0000-0000-0000-000000000022')$$,'advance 30');                                                                                                             -- [9]
select lives_ok($$select public.settle_staff_advance('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000aa',30.000,'2026-10-05','apply',(select id from public.staff_advances where organization_id='dd000000-0000-0000-0000-0000000000a1' and amount=30.000 and status='RECORDED' order by created_at limit 1),'dd300000-0000-0000-0000-000000000023')$$,'settle 30 against the advance');                                                                                                        -- [10]
select lives_ok($$select public.record_staff_advance('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000aa',10.000,'2026-10-06','need2','dd300000-0000-0000-0000-000000000024')$$,'advance 10');                                                                                                           -- [11]
select lives_ok($$select public._rm_order()$$,'supplier invoice 15');                                                                                                                                                                                                                                                       -- [12]
select lives_ok($$select public.record_supplier_payment('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000bb',15.000,'2026-10-06','CASH',null,'pay',null,'dd300000-0000-0000-0000-000000000030')$$,'supplier payment');                                                                    -- [13]
select lives_ok($$select public.transition_event_status('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e1','CLOSED')$$,'close invoiced');                                                                                                                                                        -- [14]
select lives_ok($$select public.transition_event_status('dd000000-0000-0000-0000-0000000000a1','dd000000-0000-0000-0000-0000000000e2','CLOSED')$$,'close unbilled');                                                                                                                                                       -- [15]
select lives_ok($$select public.commit_opening_cutover('dd000000-0000-0000-0000-0000000000a1',0,'dd300000-0000-0000-0000-000000000040')$$,'cutover (zero gaps)');                                                                                                                                                          -- [16]

-- Trial balance --------------------------------------------------------------
select is(
  (select sum(debit_total) from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')),
  (select sum(credit_total) from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')),
  'trial balance: total debits = total credits (§21)');                                                                                                                                                                                                                                                                     -- [17]
select is(
  (select raw_balance from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')
    where account_id = (select chart_account_id from public.treasury_accounts where organization_id = 'dd000000-0000-0000-0000-0000000000a1')),
  (select raw_balance from public.account_balance('dd000000-0000-0000-0000-0000000000a1',
    (select chart_account_id from public.treasury_accounts where organization_id = 'dd000000-0000-0000-0000-0000000000a1'))),
  'trial balance treasury row matches account_balance (0084 authority)');                                                                                                                                                                                                                                                   -- [18]
select is(
  (select count(*)::int from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1', '2030-01-01'::date, null)),
  0, 'trial balance: window beyond the last posting is empty (inclusive bounds)');                                                                                                                                                                                                                                          -- [19]
select throws_ok($$select * from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1', current_date + 5, current_date)$$,'22023','ACCOUNTING_PERIOD_INVALID','trial balance rejects inverted window');                                                                                                   -- [20]

-- Journal history --------------------------------------------------------------
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1') where source_type = 'INVOICE'),
  2, 'history: INVOICE journal has 2 lines (Dr AR / Cr deferred)');                                                                                                                                                                                                                                                         -- [21]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1') where source_type = 'CUSTOMER_DEPOSIT_APPLIED'),
  2, 'history: deposit application is its own 2-line journal');                                                                                                                                                                                                                                                             -- [21b]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1') where source_type = 'EVENT_EXPENSE' and reversed_by is not null),
  2, 'history: voided expense lines carry reversed_by');                                                                                                                                                                                                                                                                    -- [22]
select is(
  (select string_agg(s, '|' order by ord) from (select t::text as s, row_number() over () as ord from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 20, 0) t) x),
  (select string_agg(s, '|' order by ord) from (select t::text as s, row_number() over () as ord from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 20, 0) t) x),
  'history: ordering is stable across repeated calls (same-day entries)');                                                                                                                                                                                                                                                  -- [23]
select is(
  (select count(*)::int from (
    select entry_id::text || ':' || account_id::text as k from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 5, 0)
    intersect
    select entry_id::text || ':' || account_id::text from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 5, 5)
  ) z),
  0, 'history: pagination pages do not overlap');                                                                                                                                                                                                                                                                           -- [24]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 5, 0)),
  5, 'history: first page respects limit');                                                                                                                                                                                                                                                                                 -- [25]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 0, 0)),
  1, 'history: limit clamps to 1');                                                                                                                                                                                                                                                                                          -- [26]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000a1', null, null, null, null, 100, 100000)),
  0, 'history: offset beyond end returns no rows');                                                                                                                                                                                                                                                                          -- [27]

-- Customer positions -----------------------------------------------------------
select is(
  (select count(*)::int from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1')),
  2, 'customer positions: one row per event');                                                                                                                                                                                                                                                                              -- [28]
select is(
  (select commercial_value from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-1'),
  500.000, 'customer positions: commercial_value from accepted quotation');                                                                                                                                                                                                                                                 -- [29]
select is(
  (select collected_amount_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-1'),
  500.000, 'customer positions: collected gross = 150 deposit + 350 settlement');                                                                                                                                                                                                                                           -- [30]
select is(
  (select recognized_revenue from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-1'),
  500.000, 'customer positions: recognized revenue at CLOSED (net)');                                                                                                                                                                                                                                                       -- [31]
select is(
  (select invoiced_amount_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-1'),
  500.000, 'customer positions: invoiced gross from ISSUED invoice');                                                                                                                                                                                                                                                       -- [32]
select is(
  (select outstanding_ar from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-1'),
  0.000, 'customer positions: fully settled event outstanding = 0');                                                                                                                                                                                                                                                        -- [33]
select is(
  (select unbilled_receivable_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-2'),
  100.000, 'customer positions: CLOSED unbilled event carries contract asset');                                                                                                                                                                                                                                             -- [34]
select is(
  (select outstanding_ar from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1') where event_number = 'EV-RM-2'),
  100.000, 'customer positions: §17 identity (AR + CA − deposits)');                                                                                                                                                                                                                                                        -- [35]
select is(
  (select count(*)::int from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000e1')),
  1, 'customer positions: single-event filter');                                                                                                                                                                                                                                                                             -- [36]

-- Supplier positions -------------------------------------------------------------
select is(
  (select count(*)::int from public.accounting_supplier_positions('dd000000-0000-0000-0000-0000000000a1')),
  1, 'supplier positions: settled supplier kept as a row');                                                                                                                                                                                                                                                                 -- [37]
select is(
  (select ap_balance from public.accounting_supplier_positions('dd000000-0000-0000-0000-0000000000a1')),
  0.000, 'supplier positions: AP back to 0 after payment');                                                                                                                                                                                                                                                                 -- [38]
select is(
  (select open_invoice_count from public.accounting_supplier_positions('dd000000-0000-0000-0000-0000000000a1')),
  1::bigint, 'supplier positions: one non-voided invoice');                                                                                                                                                                                                                                                                 -- [39]
select ok(
  (select last_posting_date from public.accounting_supplier_positions('dd000000-0000-0000-0000-0000000000a1')) is not null,
  'supplier positions: last posting date present');                                                                                                                                                                                                                                                                          -- [40]

-- Payroll positions ----------------------------------------------------------------
select is(
  (select count(*)::int from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  1, 'payroll positions: roster row present');                                                                                                                                                                                                                                                                              -- [41]
select is(
  (select payable from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  50.000, 'payroll positions: payable 100 − 20 payout − 30 settlement');                                                                                                                                                                                                                                                    -- [42]
select is(
  (select receivable from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  10.000, 'payroll positions: receivable = unsettled advance 10');                                                                                                                                                                                                                                                          -- [43]
select is(
  (select net_position from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  40.000, 'payroll positions: net = payable − receivable');                                                                                                                                                                                                                                                                 -- [44]
select is(
  (select advances_outstanding from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  10.000, 'payroll positions: advances outstanding 10');                                                                                                                                                                                                                                                                    -- [45]
select is(
  (select net_position from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')),
  (select ledger_balance from public.accounting_reconciliation('dd000000-0000-0000-0000-0000000000a1') where dimension = 'STAFF'),
  'payroll positions: net matches 0093 STAFF reconciliation ledger side');                                                                                                                                                                                                                                                  -- [46]

-- Cutover status ---------------------------------------------------------------------
select is(
  (select committed from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000a1')),
  true, 'cutover status: committed');                                                                                                                                                                                                                                                                                       -- [47]
select is(
  (select vat_payable from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000a1')),
  0.000, 'cutover status: vat stamp');                                                                                                                                                                                                                                                                                      -- [48]
select is(
  (select opening_journal_count from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000a1')),
  1::bigint, 'cutover status: exactly the treasury opening journal');                                                                                                                                                                                                                                                       -- [49]
select is(
  (select opening_entities ? 'TREASURY' from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000a1')),
  true, 'cutover status: TREASURY entity kind present');                                                                                                                                                                                                                                                                    -- [50]
select is(
  (select opening_entities ? 'CUSTOMER' from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000a1')),
  false, 'cutover status: no CUSTOMER opening (zero gaps)');                                                                                                                                                                                                                                                                -- [51]

-- Security: capability gates -----------------------------------------------------------
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select * from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot read trial balance');                                                                                                                                             -- [52]
select throws_ok($$select * from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot read payroll positions');                                                                                                                                      -- [53]

set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select count(*) from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')$$,'ACCOUNTANT with cost.visibility reads trial balance');                                                                                                                                                    -- [54]
select throws_ok($$select * from public.accounting_payroll_positions('dd000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','ACCOUNTANT without payroll.read is refused payroll');                                                                                                                              -- [55]

-- Security: tenant isolation -----------------------------------------------------------
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$select * from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','org-B owner cannot read org-A trial balance');                                                                                                                                        -- [56]
select throws_ok($$select * from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','org-B owner cannot read org-A customer positions');                                                                                                                             -- [57]

-- Security: direct ledger access stays revoked; gated functions work under authenticated
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.journal_lines limit 1$$,'42501',null,'direct journal_lines read stays revoked from authenticated');                                                                                                                -- [58]
select lives_ok($$select count(*) from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')$$,'authenticated role can call the gated read model');                                                                                       -- [59]
set local role anon;
select throws_ok($$select * from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000a1')$$,'42501',null,'anon has no EXECUTE on the read models');                                                                                         -- [60]
reset role;

-- Org C: VAT deposit semantics + void/reversal history --------------------------------
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$select public.record_customer_payment('dd000000-0000-0000-0000-0000000000c1','dd000000-0000-0000-0000-0000000000e4',1050.000,'CASH','RM-VAT',null,now(),'dd300000-0000-0000-0000-000000000050')$$,'VAT deposit 1050');                                                                                   -- [61]
select is(
  (select customer_deposits_net from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  1000.000, 'VAT deposit: net liability 1000');                                                                                                                                                                                                                                                                             -- [62]
select is(
  (select customer_deposits_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  1050.000, 'VAT deposit: gross = net + deposit VAT');                                                                                                                                                                                                                                                                      -- [63]
select is(
  (select vat_amount from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  50.000, 'VAT deposit: event VAT liability 50');                                                                                                                                                                                                                                                                           -- [64]
select is(
  (select collected_amount_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  1050.000, 'VAT deposit: collected gross 1050');                                                                                                                                                                                                                                                                           -- [65]
select is(
  (select outstanding_ar from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  -1000.000, 'VAT deposit: net prepayment shows as negative outstanding');                                                                                                                                                                                                                                                -- [66]
select lives_ok($$select public.void_customer_payment('dd000000-0000-0000-0000-0000000000c1',(select id from public.customer_payments where reference='RM-VAT'),'entered in error','dd300000-0000-0000-0000-000000000051')$$,'void VAT deposit');                                                                        -- [67]
select is(
  (select collected_amount_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  0.000, 'voided payment removed from collected');                                                                                                                                                                                                                                                                          -- [68]
select is(
  (select customer_deposits_net from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000c1') where event_number = 'EV-RM-C'),
  0.000, 'void restores deposit liability to 0');                                                                                                                                                                                                                                                                           -- [69]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000c1') where source_type = 'CUSTOMER_PAYMENT' and reversed_by is not null),
  3, 'history: voided 3-line VAT payment lines carry reversed_by');                                                                                                                                                                                                                                                         -- [70]
select is(
  (select count(*)::int from public.accounting_journal_history('dd000000-0000-0000-0000-0000000000c1') where source_type = 'CUSTOMER_PAYMENT_VOID' and is_reversal),
  3, 'history: reversal journal lines marked is_reversal');                                                                                                                                                                                                                                                                 -- [71]

-- Org B: empty dataset ------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"dd000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.accounting_trial_balance('dd000000-0000-0000-0000-0000000000b1')),
  0, 'empty org: trial balance has no rows');                                                                                                                                                                                                                                                                               -- [72]
select is(
  (select committed from public.accounting_cutover_status('dd000000-0000-0000-0000-0000000000b1')),
  false, 'empty org: cutover not committed');                                                                                                                                                                                                                                                                               -- [73]
select is(
  (select commercial_value from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000b1')),
  400.000, 'empty org: commercial value still reported');                                                                                                                                                                                                                                                                   -- [74]
select is(
  (select collected_amount_gross from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000b1')),
  0.000, 'empty org: zero collected');                                                                                                                                                                                                                                                                                      -- [75]
select is(
  (select outstanding_ar from public.accounting_customer_positions('dd000000-0000-0000-0000-0000000000b1')),
  0.000, 'empty org: zero outstanding');                                                                                                                                                                                                                                                                                    -- [76]

select * from finish();
rollback;
