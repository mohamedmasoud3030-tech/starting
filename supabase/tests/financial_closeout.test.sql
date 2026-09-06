-- ============================================================================
-- 0097 — financial close-out (contract §17/§18/§19/§21) pgTAP.
--
--   §19  ledger-backed close snapshot: is_ledger_backed + frozen customer
--        state + treasury + payroll liability captured at close time.
--   §18  revenue-recognition gate: an invoiced, settled, but not-yet-CLOSED
--        event cannot be financially closed (Deferred != 0).
--   §18  post-close cost creation guard: a customer invoice on a
--        financially-closed event is rejected.
--   §17  the four remaining reconciliation dimensions (CUSTOMER_PAYMENTS,
--        INVOICES, CLOSURE_SNAPSHOTS, VAT_PAYABLE) reconcile with zero
--        DIFFERENCE rows.
--   §21  no-negative-balance invariant: a balanced journal that drives AR
--        negative is rejected at constraint-check time.
-- ============================================================================
begin;
select plan(37);

create or replace function public._fc_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._fc_event_raw(p_org uuid, p_event uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
    join public.journal_entries e on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org and e.event_id = p_event
     and l.account_id = (select id from public.chart_of_accounts where organization_id = p_org and code = p_code);
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','99e00000-0000-0000-0000-000000000001','authenticated','authenticated','fc97-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('99e00000-0000-0000-0000-0000000000a1','FC97 Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name,phone) values
('99e00000-0000-0000-0000-0000000000c1','99e00000-0000-0000-0000-0000000000a1','FC97 Customer','91234567');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('99e00000-0000-0000-0000-0000000000e1','99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000c1','EV-FC97-1','Invoiced','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','99e10000-0000-0000-0000-000000000001','99e00000-0000-0000-0000-000000000001','99e00000-0000-0000-0000-000000000001'),
('99e00000-0000-0000-0000-0000000000e2','99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000c1','EV-FC97-2','Unrecognized','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','RETURNING','99e10000-0000-0000-0000-000000000002','99e00000-0000-0000-0000-000000000001','99e00000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('99e00000-0000-0000-0000-0000000000b1','99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','QT-FC97-1',1,'ACCEPTED','FC97 Customer','EV-FC97-1','Invoiced',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',400.000,0,400.000,400.000,false,0,0,'99e10000-0000-0000-0000-000000000011','99e00000-0000-0000-0000-000000000001','99e00000-0000-0000-0000-000000000001',now()),
('99e00000-0000-0000-0000-0000000000b2','99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2','QT-FC97-2',1,'ACCEPTED','FC97 Customer','EV-FC97-2','Unrecognized',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',400.000,0,400.000,400.000,false,0,0,'99e10000-0000-0000-0000-000000000012','99e00000-0000-0000-0000-000000000001','99e00000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='99e00000-0000-0000-0000-0000000000b1' where id='99e00000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='99e00000-0000-0000-0000-0000000000b2' where id='99e00000-0000-0000-0000-0000000000e2';
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('99e00000-0000-0000-0000-0000000000f1','99e00000-0000-0000-0000-0000000000a1','Host FC97','HOST',true,'PER_EVENT',100.000);

set local "request.jwt.claims"='{"sub":"99e00000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('99e00000-0000-0000-0000-0000000000a1')$$,'seed chart');                                              -- 1
select lives_ok($$select public.create_treasury_account('99e00000-0000-0000-0000-0000000000a1','Main Cash','CASH',null,null,null,'99e20000-0000-0000-0000-000000000001')$$,'treasury account');  -- 2
select lives_ok($$select public.set_treasury_opening_balance('99e00000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='99e00000-0000-0000-0000-0000000000a1'),1000.000,'99e20000-0000-0000-0000-000000000010')$$,'cash opening 1000');  -- 3

-- ---------------------------------------------------------------------------
-- §19 — event e1: deposit + invoice + settle + payroll liability, then
-- operational CLOSED (revenue recognized), then financial close.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.assign_event_staff('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','99e00000-0000-0000-0000-0000000000f1','HOST','PER_EVENT',100.000,100.000,null,gen_random_uuid())$$,'assign host');  -- 4
select lives_ok($$select public.record_staff_attendance('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','99e00000-0000-0000-0000-0000000000f1',(select id from public.event_staff_assignments where organization_id='99e00000-0000-0000-0000-0000000000a1' and status='ACTIVE'),'2026-10-01','MORNING','2026-10-01 10:00+04','2026-10-01 18:00+04',0,'PRESENT',null,'99e30000-0000-0000-0000-000000000020')$$,'earning 100');  -- 5
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','2300')),-100.000,'payroll payable 100');  -- 6

select lives_ok($$select public.record_customer_payment('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1',100.000,'CASH','FC97-D1',null,now(),'99e30000-0000-0000-0000-000000000001')$$,'e1 deposit 100');  -- 7
select lives_ok($$select public.create_event_invoice('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','INV-FC97-1',null,400.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-20","amount":"100.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"300.000"}]'::jsonb,null,'99e30000-0000-0000-0000-000000000011')$$,'e1 invoice 400');  -- 8
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','1100')),300.000,'AR 300 after deposit allocation');  -- 9
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','2100')),-400.000,'deferred 400');  -- 10
select lives_ok($$select public.record_customer_payment('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1',300.000,'CASH','FC97-D2',null,now(),'99e30000-0000-0000-0000-000000000002')$$,'e1 settle 300');  -- 11
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','1100')),0.000,'AR 0 settled');  -- 12

select lives_ok($$select public.transition_event_status('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','CLOSED')$$,'operational CLOSED');  -- 13
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','2100')),0.000,'deferred 0 after recognition');  -- 14

select lives_ok($$select public.close_event_financially('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','إغلاق')$$,'financial close');  -- 15

select is((select is_ledger_backed from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),true,'snapshot is ledger-backed');  -- 16
select is((select deferred_revenue_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),0.000,'snapshot deferred 0');  -- 17
select is((select accounts_receivable_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),0.000,'snapshot AR 0');  -- 18
select is((select customer_deposits_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),0.000,'snapshot deposits 0');  -- 19
select is((select contract_asset_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),0.000,'snapshot contract asset 0');  -- 20
select is((select vat_payable_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),0.000,'snapshot vat 0');  -- 21
select is((select payroll_payable_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),100.000,'snapshot payroll payable 100 (liability captured, does not block)');  -- 22
select is((select treasury_balance_at_close from public.event_financial_closures where event_id='99e00000-0000-0000-0000-0000000000e1' and reopened_at is null),1400.000,'snapshot treasury 1400');  -- 23

-- ---------------------------------------------------------------------------
-- §18 — post-close cost creation is blocked (customer invoice guard).
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.invoices(organization_id, event_id, invoice_number, total_amount, created_by)
values ('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e1','INV-FC97-GUARD',1.000,'99e00000-0000-0000-0000-000000000001')$$,'42501','FINANCIAL_CLOSURE_BLOCKS_MUTATION','invoice on financially-closed event is rejected');  -- 24

-- ---------------------------------------------------------------------------
-- §18 — revenue-recognition gate: e2 invoiced + settled but NOT CLOSED.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2',200.000,'CASH','FC97-D3',null,now(),'99e30000-0000-0000-0000-000000000003')$$,'e2 deposit 200');  -- 25
select lives_ok($$select public.create_event_invoice('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2','INV-FC97-2',null,400.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-20","amount":"200.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"200.000"}]'::jsonb,null,'99e30000-0000-0000-0000-000000000012')$$,'e2 invoice 400');  -- 26
select lives_ok($$select public.record_customer_payment('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2',200.000,'CASH','FC97-D4',null,now(),'99e30000-0000-0000-0000-000000000004')$$,'e2 settle 200');  -- 27
select is((select public._fc_event_raw('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2','2100')),-400.000,'e2 deferred 400 (not recognized)');  -- 28
select throws_ok($$select public.close_event_financially('99e00000-0000-0000-0000-0000000000a1','99e00000-0000-0000-0000-0000000000e2')$$,'23514','FINANCIAL_CLOSE_REVENUE_NOT_RECOGNIZED','close blocked while deferred revenue outstanding');  -- 29

-- ---------------------------------------------------------------------------
-- §17 — the four remaining reconciliation dimensions reconcile exactly.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where status='DIFFERENCE'),0,'reconciliation: zero DIFFERENCE rows');  -- 30
select is((select count(*)::int from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER_PAYMENTS' and status='MATCHED'),2,'CUSTOMER_PAYMENTS: both events MATCHED');  -- 31
select is((select ledger_balance from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER_PAYMENTS' and entity_label='EV-FC97-1'),400.000,'CUSTOMER_PAYMENTS: e1 ledger total 400');  -- 32
select is((select count(*)::int from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where dimension='INVOICES' and status='MATCHED'),2,'INVOICES: both invoices MATCHED');  -- 33
select is((select count(*)::int from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where dimension='CLOSURE_SNAPSHOTS' and status='MATCHED'),4,'CLOSURE_SNAPSHOTS: 4 metrics MATCHED');  -- 34
select is((select status from public.accounting_reconciliation('99e00000-0000-0000-0000-0000000000a1') where dimension='VAT_PAYABLE'),'MATCHED','VAT_PAYABLE: MATCHED');  -- 35

-- ---------------------------------------------------------------------------
-- §21 — no-negative-balance invariant (AR must never invert sign).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.internal_post_journal('99e00000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','99e00000-0000-0000-0000-000000000aa1',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='99e00000-0000-0000-0000-0000000000a1' and code='3000'),'debit',50.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='99e00000-0000-0000-0000-0000000000a1' and code='1100'),'debit',0,'credit',50.000)),'99e40000-0000-0000-0000-000000000001',null)$$,'post journal drawing AR negative (deferred)');  -- 36
select throws_ok($$set constraints all immediate$$,'23514',null,'negative AR balance is rejected at constraint check');  -- 37

select * from finish();
rollback;
