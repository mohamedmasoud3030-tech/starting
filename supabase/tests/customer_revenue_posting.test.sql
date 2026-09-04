-- ============================================================================
-- 0087 — customer / invoice / revenue posting lifecycle pgTAP.
--
-- Covers: invoice creation (no/partial/full deposit, VAT & non-VAT), deposit
-- allocation (single + multiple, remaining VAT, no duplicate VAT), CLOSED
-- revenue recognition (invoiced Deferred→Revenue; unbilled Contract Asset
-- Option B), post-CLOSED invoice reclassification (AR / Unbilled, no second
-- recognition), invoice void (restore deposit, reverse VAT, reverse reclass),
-- payment-void allocation guard, security (cross-org, capability, journal
-- immutability), and the reconciliation equation
--     outstanding = AR + ContractAsset − Deposits.
--
-- Assertions inspect real ledger balances / journal relationships, not just RPC
-- return values. Runs under the definer so journal tables are readable.
-- ============================================================================
begin;
select plan(72);

-- Helpers available under the definer (postgres).
create or replace function public._test_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._test_acct_credit_balance(p_org uuid, p_event uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(l.credit) - sum(l.debit), 0)
    from public.journal_lines l
    join public.journal_entries e on e.organization_id=l.organization_id and e.id=l.entry_id
   where l.organization_id=p_org and l.account_id=p_acc
     and e.organization_id=p_org and e.event_id=p_event;
$$;
-- Asset (debit-normal) balance: debit - credit.
create or replace function public._test_acct_debit_balance(p_org uuid, p_event uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
    join public.journal_entries e on e.organization_id=l.organization_id and e.id=l.entry_id
   where l.organization_id=p_org and l.account_id=p_acc
     and e.organization_id=p_org and e.event_id=p_event;
$$;

-- Fixtures ----------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000001','authenticated','authenticated','cr-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000002','authenticated','authenticated','cr-owner-b@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000003','authenticated','authenticated','cr-sup@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('99000000-0000-0000-0000-0000000000a1','CR Org A'),
('99000000-0000-0000-0000-0000000000b1','CR Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-000000000001','OWNER'),
('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-000000000003','SUPERVISOR'),
('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-000000000002','OWNER');
insert into public.customers(id,organization_id,name) values
('99000000-0000-0000-0000-0000000000c1','99000000-0000-0000-0000-0000000000a1','Cust A'),
('99000000-0000-0000-0000-0000000000c2','99000000-0000-0000-0000-0000000000b1','Cust B');

-- Non-VAT org A events (000/100/100) and VAT events (2100 gross / 2000 net / 100 VAT).
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('99000000-0000-0000-0000-0000000000e1','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-1','NoDeposit','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','99100000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e2','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-2','Partial','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','99100000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e3','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-3','Full','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','99100000-0000-0000-0000-000000000003','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e4','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-VAT','VatPartial','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','99100000-0000-0000-0000-000000000004','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e5','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-CLOSED','CloseInvoiced','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','RETURNING','99100000-0000-0000-0000-000000000005','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e6','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-UNBILLED','CloseUnbilled','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','RETURNING','99100000-0000-0000-0000-000000000006','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e7','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000c1','EV-CR-POST','PostClose','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CLOSED','99100000-0000-0000-0000-000000000007','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
('99000000-0000-0000-0000-0000000000e8','99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000c2','EV-CR-B','Cross','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','99100000-0000-0000-0000-000000000008','99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000002');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('99000000-0000-0000-0000-0000000000f1','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','QT-CR-1',1,'ACCEPTED','Cust A','EV-CR-1','NoDeposit',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000011','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f2','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2','QT-CR-2',1,'ACCEPTED','Cust A','EV-CR-2','Partial',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000012','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f3','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3','QT-CR-3',1,'ACCEPTED','Cust A','EV-CR-3','Full',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000013','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f4','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4','QT-CR-VAT',1,'ACCEPTED','Cust A','EV-CR-VAT','VatPartial',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',2100.000,1100.000,1000.000,2000.000,true,5.000,100.000,'99100000-0000-0000-0000-000000000014','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f5','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5','QT-CR-5',1,'ACCEPTED','Cust A','EV-CR-CLOSED','CloseInvoiced',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000015','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f6','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e6','QT-CR-6',1,'ACCEPTED','Cust A','EV-CR-UNBILLED','CloseUnbilled',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000016','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f7','99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7','QT-CR-7',1,'ACCEPTED','Cust A','EV-CR-POST','PostClose',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000017','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',now()),
('99000000-0000-0000-0000-0000000000f8','99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000e8','QT-CR-B',1,'ACCEPTED','Cust B','EV-CR-B','Cross',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Salalah',100.000,50.000,50.000,100.000,false,0,0.000,'99100000-0000-0000-0000-000000000018','99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000002',now());
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f1' where id='99000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f2' where id='99000000-0000-0000-0000-0000000000e2';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f3' where id='99000000-0000-0000-0000-0000000000e3';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f4' where id='99000000-0000-0000-0000-0000000000e4';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f5' where id='99000000-0000-0000-0000-0000000000e5';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f6' where id='99000000-0000-0000-0000-0000000000e6';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f7' where id='99000000-0000-0000-0000-0000000000e7';
update public.events set accepted_quotation_id='99000000-0000-0000-0000-0000000000f8' where id='99000000-0000-0000-0000-0000000000e8';

-- Act as OWNER of org A.
set local "request.jwt.claims"='{"sub":"99000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('99000000-0000-0000-0000-0000000000a1')$$,'seed org A chart');

-- ======================= INVOICE: no deposit ======================= --
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','INV-1',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000001')$$,'no-dependency invoice created');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),100.000,'AR = 100 (no deposit, non-VAT)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),100.000,'Deferred = 100');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','2150'))),0.000,'VAT = 0 (non-VAT org)');
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','INV-1',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000001')$$,'idempotent replay');
select is((select count(*)::int from public.invoices where organization_id='99000000-0000-0000-0000-0000000000a1' and status='ISSUED'),1,'only one issued invoice after replay');
select is((select count(*)::int from public.journal_entries where organization_id='99000000-0000-0000-0000-0000000000a1' and source_type='INVOICE'),1,'one INVOICE journal after replay');

-- ======================= INVOICE: partial deposit ======================= --
-- Event e2 total 100, pay 40 deposit, invoice 100.
select lives_ok($$select public.record_customer_payment('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',40.000,'CASH','P-PART',null,now(),'99200000-0000-0000-0000-000000000010')$$,'40 deposit recorded');
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2','INV-2',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"40.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"60.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000002')$$,'invoice with partial deposit');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),0.000,'deposits fully consumed (credit rebate)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),0.000,'no residual deposit liability');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),60.000,'AR = 60 (100 invoice - 40 deposit)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),100.000,'Deferred = 100 (full net)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2150'))),0.000,'VAT = 0 (non-VAT)');
select is((select count(*)::int from public.customer_payment_allocations where organization_id='99000000-0000-0000-0000-0000000000a1' and event_id='99000000-0000-0000-0000-0000000000e2'),1,'one allocation row for the 40 deposit');

-- ======================= INVOICE: full deposit ======================= --
-- Event e3 total 100, pay 100 deposit, invoice 100.
select lives_ok($$select public.record_customer_payment('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3',100.000,'CASH','P-FULL',null,now(),'99200000-0000-0000-0000-000000000011')$$,'100 deposit recorded');
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3','INV-3',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"100.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"0.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000003')$$,'invoice fully covered by deposit');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),0.000,'AR = 0 (fully covered)');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),0.000,'deposits zero');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e3',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),100.000,'Deferred = 100');

-- ======================= VAT invoice: partial deposit ======================= --
-- Event e4 gross 2100 (net 2000, VAT 100). Deposit 1050 (net 1000, VAT 50).
select lives_ok($$select public.record_customer_payment('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',1050.000,'BANK_TRANSFER','P-VAT',null,now(),'99200000-0000-0000-0000-000000000012')$$,'VAT deposit 1050');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',public._test_chart('99000000-0000-0000-0000-0000000000a1','2150'))),50.000,'VAT recognized on deposit = 50');
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4','INV-VAT',null,2100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"1050.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"1050.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000004')$$,'VAT invoice with partial deposit');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),1050.000,'AR = 1050 (net 2000 + rem VAT 50 - deposit 1000)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),2000.000,'Deferred = 2000 (full net)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',public._test_chart('99000000-0000-0000-0000-0000000000a1','2150'))),100.000,'VAT Payable total = 100 (50 deposit + 50 invoice, no duplicate)');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e4',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),0.000,'deposits net fully consumed (1000 debited)');

-- ======================= CLOSED: invoiced ======================= --
-- Event e5 has no invoice yet; create one, then close.
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5','INV-CL',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000005')$$,'invoice created for close event');
select lives_ok($$select public.transition_event_status('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5','CLOSED')$$,'invoiced event closes');
select is((select status::text from public.events where id='99000000-0000-0000-0000-0000000000e5'),'CLOSED','close persisted');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),0.000,'Deferred = 0 after CLOSED');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5',public._test_chart('99000000-0000-0000-0000-0000000000a1','4000'))),100.000,'Revenue = 100 (net)');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),100.000,'AR unchanged at 100 (not settled, no payment)');
-- Duplicate close recognition replay must not double-post (idempotent at the
-- journal layer via the deterministic recognition key).
select lives_ok($$select public._post_close_revenue('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5')$$,'replay close recognition');
select is((select count(*)::int from public.journal_entries where organization_id='99000000-0000-0000-0000-0000000000a1' and source_type='REVENUE_RECOGNITION'),1,'one revenue recognition journal');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e5',public._test_chart('99000000-0000-0000-0000-0000000000a1','4000'))),100.000,'Revenue still 100 after replay');

-- ======================= CLOSED: unbilled (Option B) ======================= --
-- Event e6 has NO invoice; close it => Contract Asset + Revenue + VAT(0).
select lives_ok($$select public.transition_event_status('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e6','CLOSED')$$,'unbilled event closes');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e6',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))),100.000,'Contract Asset = 100');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e6',public._test_chart('99000000-0000-0000-0000-0000000000a1','4000'))),100.000,'Revenue = 100 (net)');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e6',public._test_chart('99000000-0000-0000-0000-0000000000a1','2150'))),0.000,'VAT = 0 (non-VAT, no VAT in revenue)');
select is((select count(*)::int from public.journal_entries where organization_id='99000000-0000-0000-0000-0000000000a1' and source_type='UNBILLED_RECOGNITION'),1,'one UNBILLED_RECOGNITION journal');

-- ======================= POST-CLOSED invoice ======================= --
-- Event e7 is CLOSED (fixture). Run close recognition once via the same helper
-- the transition uses, then issue a post-CLOSED invoice => reclassification.
select lives_ok($$select public._post_close_revenue('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7')$$,'recognize unbilled revenue for post-close event');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))),100.000,'Contract Asset = 100 after recognition');
select lives_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7','INV-POST',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000007')$$,'post-CLOSED invoice issued');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),100.000,'AR = 100 (reclassified)');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))),0.000,'Contract Asset back to 0');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','4000'))),100.000,'Revenue unchanged (no second recognition)');
select is((select count(*)::int from public.journal_entries where organization_id='99000000-0000-0000-0000-0000000000a1' and source_type='CONTRACT_ASSET_RECLASSIFICATION'),1,'one reclassification journal');

-- ======================= VOID ordinary invoice ======================= --
-- Void INV-1 (no deposit, pre-CLOSED, non-VAT): reverse AR / Deferred.
select lives_ok($$select public.void_invoice('99000000-0000-0000-0000-0000000000a1',(select id from public.invoices where organization_id='99000000-0000-0000-0000-0000000000a1' and invoice_number='INV-1'),'customer cancelled','99200000-0000-0000-0000-000000000020')$$,'void no-deposit invoice');
select is((select status::text from public.invoices where invoice_number='INV-1' and organization_id='99000000-0000-0000-0000-0000000000a1'),'CANCELLED','invoice cancelled');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),0.000,'AR restored to 0');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),0.000,'Deferred restored to 0');
select throws_ok($$select public.void_invoice('99000000-0000-0000-0000-0000000000a1',(select id from public.invoices where invoice_number='INV-1' and organization_id='99000000-0000-0000-0000-0000000000a1'),'again','99200000-0000-0000-0000-000000000021')$$,'P0001','INVOICE_ALREADY_CANCELLED','re-void rejected');

-- ======================= VOID invoice restoring deposit ======================= --
-- Void INV-2 (partial deposit pre-CLOSED): restore 40 deposit, reverse AR/Deferred.
select lives_ok($$select public.void_invoice('99000000-0000-0000-0000-0000000000a1',(select id from public.invoices where invoice_number='INV-2' and organization_id='99000000-0000-0000-0000-0000000000a1'),'deposit refund','99200000-0000-0000-0000-000000000022')$$,'void partial-deposit invoice');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),40.000,'deposit restored to 40');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),0.000,'AR restored to 0');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2100'))),0.000,'Deferred restored to 0');
select is((select count(*)::int from public.customer_payment_allocations where organization_id='99000000-0000-0000-0000-0000000000a1' and invoice_id=(select id from public.invoices where invoice_number='INV-2' and organization_id='99000000-0000-0000-0000-0000000000a1')),0,'allocations cleared on void');

-- ======================= Payment void guard ======================= --
-- The 40 deposit on e2 is now free; void the payment => CUSTOMER_PAYMENT_VOID.
select lives_ok($$select public.void_customer_payment('99000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where reference='P-PART' and organization_id='99000000-0000-0000-0000-0000000000a1'),'refund payment','99200000-0000-0000-0000-000000000023')$$,'void payment after invoice void');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e2',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),0.000,'deposit zero after payment void');
-- Now attempt payment-void on an allocated deposit (e3 already invoiced): must reject.
select throws_ok($$select public.void_customer_payment('99000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where reference='P-FULL' and organization_id='99000000-0000-0000-0000-0000000000a1'),'try','99200000-0000-0000-0000-000000000024')$$,'23514','PAYMENT_ALLOCATED_TO_INVOICE','cannot void deposit already allocated to invoice');

-- ======================= VOID post-CLOSED reclassification ======================= --
-- Void INV-POST (e7, post-CLOSED) => reverse reclassification: AR back to 0,
-- Contract Asset restored, revenue/VAT untouched (service already earned).
select lives_ok($$select public.void_invoice('99000000-0000-0000-0000-0000000000a1',(select id from public.invoices where invoice_number='INV-POST' and organization_id='99000000-0000-0000-0000-0000000000a1'),'reclass reverse','99200000-0000-0000-0000-000000000025')$$,'void post-CLOSED reclassification invoice');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))),0.000,'AR back to 0');
select is((select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))),100.000,'Contract Asset restored to 100');
select is((select public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','4000'))),100.000,'Revenue still 100 (no reversal)');

-- ======================= Security ======================= --
select throws_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000e8','INV-B',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000040')$$,'42501','NOT_AUTHORIZED','cross-org invoice rejected');
set local "request.jwt.claims"='{"sub":"99000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.create_event_invoice('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1','INV-SUP',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'99200000-0000-0000-0000-000000000041')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot invoice');
set local "request.jwt.claims"='{"sub":"99000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.journal_entries set memo='x' where organization_id='99000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_IMMUTABLE','journal immutable');
select throws_ok($$delete from public.journal_lines where organization_id='99000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_LINE_IMMUTABLE','journal line immutable');

-- ======================= Reconciliation equation ======================= --
-- outstanding = AR + ContractAsset − Deposits (all debit/credit per event).
select is(
  (select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))
   + public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))
   - public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),
  0.000,
  'reconciliation e1 (voided invoice): 0 outstanding');
select is(
  (select public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1100'))
   + public._test_acct_debit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','1120'))
   - public._test_acct_credit_balance('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e7',public._test_chart('99000000-0000-0000-0000-0000000000a1','2000'))),
  100.000,
  'reconciliation e7 (post-close invoiced): 100 outstanding');

select * from finish();
rollback;
