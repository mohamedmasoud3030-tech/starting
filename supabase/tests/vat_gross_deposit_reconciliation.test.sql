-- ============================================================================
-- 0095 — VAT gross-deposit reconciliation & cutover parity (contract §16/§17).
--
-- Proves the gross-deposit invariant for VAT-registered orgs:
--   ledger gross deposit = -raw(2000) + deposit VAT (2150 lines sourced from
--   CUSTOMER_PAYMENT / CUSTOMER_PAYMENT_VOID), applied exactly where the
--   contract compares deposits gross: the reconciliation `deposits` metric
--   (uninvoiced events) and the cutover deposit gap for gross-deposit
--   opening branches. Full voids must not overstate gross. Non-VAT orgs,
--   invoiced/CLOSED-unbilled branches, and §16 gross first-cutover openings
--   are regression-guarded.
--
-- Fails against 0094 main; passes with 0095.
-- ============================================================================
begin;
select plan(70);

create or replace function public._vg_raw(p_org uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
   where l.organization_id = p_org
     and l.account_id = (select id from public.chart_of_accounts
                          where organization_id = p_org and code = p_code);
$$;
create or replace function public._vg_event_raw(p_org uuid, p_event uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org
     and e.event_id = p_event
     and l.account_id = (select id from public.chart_of_accounts
                          where organization_id = p_org and code = p_code);
$$;
create or replace function public._vg_trial_zero(p_org uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: O1 VAT org (lifecycle scenarios), O2 non-VAT regression,
-- O3 VAT late-cutover, O4 VAT fresh-cutover (pre-ledger facts).
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','9b000000-0000-0000-0000-000000000001','authenticated','authenticated','vg-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9b000000-0000-0000-0000-000000000002','authenticated','authenticated','vg-outsider@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('9b000000-0000-0000-0000-0000000000a1','VAT Gross Org'),
('9b000000-0000-0000-0000-0000000000b1','NonVAT Org'),
('9b000000-0000-0000-0000-0000000000c1','VAT Late Cutover Org'),
('9b000000-0000-0000-0000-0000000000d1','VAT Fresh Cutover Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-000000000001','OWNER'),
('9b000000-0000-0000-0000-0000000000b1','9b000000-0000-0000-0000-000000000001','OWNER'),
('9b000000-0000-0000-0000-0000000000c1','9b000000-0000-0000-0000-000000000001','OWNER'),
('9b000000-0000-0000-0000-0000000000d1','9b000000-0000-0000-0000-000000000001','OWNER');
-- outsider 9b...02 intentionally has NO membership anywhere.

insert into public.customers(id,organization_id,name) values
('9b000000-0000-0000-0000-0000000000c2','9b000000-0000-0000-0000-0000000000a1','Cust V'),
('9b000000-0000-0000-0000-0000000000c3','9b000000-0000-0000-0000-0000000000b1','Cust N'),
('9b000000-0000-0000-0000-0000000000c4','9b000000-0000-0000-0000-0000000000c1','Cust L'),
('9b000000-0000-0000-0000-0000000000c5','9b000000-0000-0000-0000-0000000000d1','Cust F');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('9b000000-0000-0000-0000-0000000000e1','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000c2','EV-VG-1','Deposit Life','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e2','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000c2','EV-VG-2','Invoiced Life','2026-10-02 10:00+04','2026-10-02 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000002','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e3','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000c2','EV-VG-3','Closed Unbilled','2026-10-03 10:00+04','2026-10-03 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e4','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000c2','EV-VG-4','Cancelled Deposit','2026-10-04 10:00+04','2026-10-04 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000004','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e5','9b000000-0000-0000-0000-0000000000b1','9b000000-0000-0000-0000-0000000000c3','EV-VG-NV','NonVAT Deposit','2026-10-05 10:00+04','2026-10-05 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000005','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e6','9b000000-0000-0000-0000-0000000000c1','9b000000-0000-0000-0000-0000000000c4','EV-VG-LC','Late Cutover','2026-10-06 10:00+04','2026-10-06 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000006','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-0000000000e7','9b000000-0000-0000-0000-0000000000d1','9b000000-0000-0000-0000-0000000000c5','EV-VG-FC','Fresh Cutover','2026-10-07 10:00+04','2026-10-07 20:00+04',10,'Muscat','CONFIRMED','9b100000-0000-0000-0000-000000000007','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('9b000000-0000-0000-0000-0000000000f1','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','QT-VG-1',1,'ACCEPTED','Cust V','EV-VG-1','Deposit Life',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',2100.000,1000.000,1100.000,2000.000,true,5.000,100.000,'9b100000-0000-0000-0000-000000000011','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f2','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e2','QT-VG-2',1,'ACCEPTED','Cust V','EV-VG-2','Invoiced Life',10,'2026-10-02 10:00+04','2026-10-02 20:00+04','Muscat',2100.000,1000.000,1100.000,2000.000,true,5.000,100.000,'9b100000-0000-0000-0000-000000000012','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','QT-VG-3',1,'ACCEPTED','Cust V','EV-VG-3','Closed Unbilled',10,'2026-10-03 10:00+04','2026-10-03 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9b100000-0000-0000-0000-000000000013','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f4','9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e4','QT-VG-4',1,'ACCEPTED','Cust V','EV-VG-4','Cancelled Deposit',10,'2026-10-04 10:00+04','2026-10-04 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9b100000-0000-0000-0000-000000000014','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f5','9b000000-0000-0000-0000-0000000000b1','9b000000-0000-0000-0000-0000000000e5','QT-VG-5',1,'ACCEPTED','Cust N','EV-VG-NV','NonVAT Deposit',10,'2026-10-05 10:00+04','2026-10-05 20:00+04','Muscat',500.000,200.000,300.000,500.000,false,0,0.000,'9b100000-0000-0000-0000-000000000015','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f6','9b000000-0000-0000-0000-0000000000c1','9b000000-0000-0000-0000-0000000000e6','QT-VG-6',1,'ACCEPTED','Cust L','EV-VG-LC','Late Cutover',10,'2026-10-06 10:00+04','2026-10-06 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9b100000-0000-0000-0000-000000000016','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now()),
('9b000000-0000-0000-0000-0000000000f7','9b000000-0000-0000-0000-0000000000d1','9b000000-0000-0000-0000-0000000000e7','QT-VG-7',1,'ACCEPTED','Cust F','EV-VG-FC','Fresh Cutover',10,'2026-10-07 10:00+04','2026-10-07 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9b100000-0000-0000-0000-000000000017','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f1' where id='9b000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f2' where id='9b000000-0000-0000-0000-0000000000e2';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f3' where id='9b000000-0000-0000-0000-0000000000e3';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f4' where id='9b000000-0000-0000-0000-0000000000e4';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f5' where id='9b000000-0000-0000-0000-0000000000e5';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f6' where id='9b000000-0000-0000-0000-0000000000e6';
update public.events set accepted_quotation_id='9b000000-0000-0000-0000-0000000000f7' where id='9b000000-0000-0000-0000-0000000000e7';

-- Pre-ledger gross payment for the fresh-cutover org (no journals, per §16).
insert into public.customer_payments (
  id, organization_id, event_id, amount, payment_method, reference, paid_at,
  recorded_by, idempotency_key, request_fingerprint
) values (
  '9b000000-0000-0000-0000-0000000000aa','9b000000-0000-0000-0000-0000000000d1','9b000000-0000-0000-0000-0000000000e7',
  1050.000,'CASH','PRE-LEDGER-VAT',now(),
  '9b000000-0000-0000-0000-000000000001','9b300000-0000-0000-0000-000000000001',
  repeat('v', 64)
);

set local "request.jwt.claims"='{"sub":"9b000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.ensure_system_chart('9b000000-0000-0000-0000-0000000000a1')$$,'chart O1');                          -- 1
select lives_ok($$select public.create_treasury_account('9b000000-0000-0000-0000-0000000000a1','Main Cash','CASH',null,null,null,'9b200000-0000-0000-0000-000000000001')$$,'treasury O1');   -- 2
select lives_ok($$select public.ensure_system_chart('9b000000-0000-0000-0000-0000000000b1')$$,'chart O2');                          -- 3
select lives_ok($$select public.create_treasury_account('9b000000-0000-0000-0000-0000000000b1','Main Cash','CASH',null,null,null,'9b200000-0000-0000-0000-000000000002')$$,'treasury O2');   -- 4
select lives_ok($$select public.ensure_system_chart('9b000000-0000-0000-0000-0000000000c1')$$,'chart O3');                          -- 5
select lives_ok($$select public.create_treasury_account('9b000000-0000-0000-0000-0000000000c1','Main Cash','CASH',null,null,null,'9b200000-0000-0000-0000-000000000003')$$,'treasury O3');   -- 6
select lives_ok($$select public.ensure_system_chart('9b000000-0000-0000-0000-0000000000d1')$$,'chart O4');                          -- 7
select lives_ok($$select public.create_treasury_account('9b000000-0000-0000-0000-0000000000d1','Main Cash','CASH',null,null,null,'9b200000-0000-0000-0000-000000000004')$$,'treasury O4');   -- 8

-- ---------------------------------------------------------------------------
-- Scenario 1: VAT deposit 1050 = net 1000 + VAT 50 (event E1).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1',1050.000,'CASH','D-1',null,now(),'9b200000-0000-0000-0000-000000000011')$$,'VAT deposit records');   -- 9
select is((select public._vg_event_raw('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','2000')),-1000.000,'deposit net 1000 in 2000');   -- 10
select is((select public._vg_event_raw('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','2150')),-50.000,'deposit VAT 50 in 2150');      -- 11
select is((select public._vg_trial_zero('9b000000-0000-0000-0000-0000000000a1')),0.000,'trial balance zero after deposit');          -- 12

-- §17: reconciliation deposits metric must compare GROSS (1050 vs 1050).
select is((select operational_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),1050.000,'recon op gross 1050');   -- 13
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),1050.000,'recon ledger gross 1050 (FAILS pre-0095: 1000)');   -- 14
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),'MATCHED','recon deposit MATCHED (FAILS pre-0095)');   -- 15
select is((select customer_deposits_net from public.accounting_customer_positions('9b000000-0000-0000-0000-0000000000a1') where event_number='EV-VG-1'),1000.000,'positions net 1000');   -- 16
select is((select customer_deposits_gross from public.accounting_customer_positions('9b000000-0000-0000-0000-0000000000a1') where event_number='EV-VG-1'),1050.000,'positions gross 1050');   -- 17

-- Idempotent replay does not double-post.
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1',1050.000,'CASH','D-1',null,now(),'9b200000-0000-0000-0000-000000000011')$$,'same key replays');   -- 18
select is((select public._vg_event_raw('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','2000')),-1000.000,'replay posts nothing new');   -- 19

-- ---------------------------------------------------------------------------
-- Scenario 2: full void must return gross to exactly 0 (no phantom VAT).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.void_customer_payment('9b000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where organization_id='9b000000-0000-0000-0000-0000000000a1' and event_id='9b000000-0000-0000-0000-0000000000e1'),'wrong entry','9b200000-0000-0000-0000-000000000012')$$,'void deposit');   -- 20
select is((select public._vg_event_raw('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','2000')),0.000,'void clears 2000');   -- 21
select is((select public._vg_event_raw('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1','2150')),0.000,'void clears deposit VAT 2150');   -- 22
select is((select operational_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),0.000,'recon op 0 after void');   -- 23
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),0.000,'recon ledger 0 after void');   -- 24
select is((select customer_deposits_gross from public.accounting_customer_positions('9b000000-0000-0000-0000-0000000000a1') where event_number='EV-VG-1'),0.000,'positions gross 0 after void (FAILS pre-0095: 50)');   -- 25
select is((select public._vg_trial_zero('9b000000-0000-0000-0000-0000000000a1')),0.000,'trial balance zero after void');   -- 26

-- ---------------------------------------------------------------------------
-- Scenario 3: two deposits, void one -> gross = survivor only.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1',630.000,'CASH','D-A',null,now(),'9b200000-0000-0000-0000-000000000013')$$,'deposit A 630');   -- 27
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e1',420.000,'CASH','D-B',null,now(),'9b200000-0000-0000-0000-000000000014')$$,'deposit B 420');   -- 28
select lives_ok($$select public.void_customer_payment('9b000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where organization_id='9b000000-0000-0000-0000-0000000000a1' and event_id='9b000000-0000-0000-0000-0000000000e1' and amount=420.000),'dup','9b200000-0000-0000-0000-000000000015')$$,'void deposit B');   -- 29
select is((select operational_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),630.000,'recon op 630 survivor');   -- 30
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),630.000,'recon ledger 630 survivor (FAILS pre-0095: 600)');   -- 31
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-1'),'MATCHED','mixed-state deposits MATCHED (FAILS pre-0095)');   -- 32

-- ---------------------------------------------------------------------------
-- Scenario 4: cancelled event keeps its gross deposit (refund liability).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e4',315.000,'CASH','D-C',null,now(),'9b200000-0000-0000-0000-000000000016')$$,'deposit on E4');   -- 33
select lives_ok($$select public.cancel_event('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e4','client cancelled','9b200000-0000-0000-0000-000000000020')$$,'cancel E4');   -- 34
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-4'),315.000,'cancelled event ledger gross 315 (FAILS pre-0095: 300)');   -- 35
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-4'),'MATCHED','cancelled event MATCHED (FAILS pre-0095)');   -- 36

-- ---------------------------------------------------------------------------
-- Scenario 5: invoiced lifecycle — outstanding branch must NOT add depVAT.
-- deposit 1050 -> invoice 2100 -> settle 1050 => outstanding 0.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e2',1050.000,'CASH','D-2',null,now(),'9b200000-0000-0000-0000-000000000017')$$,'deposit on E2');   -- 37
select lives_ok($$select public.create_event_invoice('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e2','INV-VG-1',null,2100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-10","amount":"1050.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"1050.000"}]'::jsonb,null,'9b200000-0000-0000-0000-000000000018')$$,'invoice E2');   -- 38
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e2',1050.000,'CASH','D-2F',null,now(),'9b200000-0000-0000-0000-000000000019')$$,'settle E2');   -- 39
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-2'),'MATCHED','invoiced outstanding MATCHED 0');   -- 40
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-2'),0.000,'invoiced outstanding ledger 0 (no depVAT over-add)');   -- 41
select is((select public._vg_trial_zero('9b000000-0000-0000-0000-0000000000a1')),0.000,'trial balance zero after invoiced lifecycle');   -- 42

-- ---------------------------------------------------------------------------
-- Scenario 6: CLOSED unbilled with deposit — CA absorbs remaining VAT.
-- deposit 525 (net 500 + VAT 25), Q gross 1050 => outstanding 525.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3',525.000,'CASH','D-3',null,now(),'9b200000-0000-0000-0000-00000000001a')$$,'deposit on E3');   -- 43
select lives_ok($$select public.transition_event_status('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','PREPARING')$$,'E3 preparing');   -- 44
select lives_ok($$select public.transition_event_status('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','DISPATCHED')$$,'E3 dispatched');   -- 44a
select lives_ok($$select public.transition_event_status('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','IN_PROGRESS')$$,'E3 in progress');   -- 44b
select lives_ok($$select public.transition_event_status('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','RETURNING')$$,'E3 returning');   -- 44c
select lives_ok($$select public.transition_event_status('9b000000-0000-0000-0000-0000000000a1','9b000000-0000-0000-0000-0000000000e3','CLOSED')$$,'close E3 unbilled');   -- 44d
select is((select operational_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-3'),525.000,'closed unbilled op outstanding 525');   -- 45
select is((select ledger_balance from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-3'),525.000,'closed unbilled ledger 525 (CA holds remaining VAT, no double add)');   -- 46
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where dimension='CUSTOMER' and entity_label='EV-VG-3'),'MATCHED','closed unbilled MATCHED');   -- 47

-- No DIFFERENCE rows may remain anywhere in the VAT org.
select is((select count(*)::int from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1') where status='DIFFERENCE'),0,'zero DIFFERENCE rows in VAT org (FAILS pre-0095)');   -- 48

-- ---------------------------------------------------------------------------
-- Scenario 7: late cutover (O3) — posted deposit already on ledger; the
-- gross gap must be 0, no extra opening, books unchanged.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000c1','9b000000-0000-0000-0000-0000000000e6',1050.000,'CASH','D-LC',null,now(),'9b200000-0000-0000-0000-00000000001b')$$,'late-cutover deposit');   -- 49
select is((select jsonb_array_length(public.preview_opening_cutover('9b000000-0000-0000-0000-0000000000c1',0)->'journals')),0,'late cutover preview posts nothing (FAILS pre-0095: deposit gap 50)');   -- 50
select lives_ok($$select public.commit_opening_cutover('9b000000-0000-0000-0000-0000000000c1',0,'9b400000-0000-0000-0000-000000000001')$$,'commit late cutover');   -- 51
select is((select public._vg_raw('9b000000-0000-0000-0000-0000000000c1','2000')),-1000.000,'late cutover leaves 2000 at net 1000 (FAILS pre-0095: -1050)');   -- 52
select is((select public._vg_raw('9b000000-0000-0000-0000-0000000000c1','2150')),-50.000,'late cutover leaves 2150 at 50');   -- 53
select is((select public._vg_trial_zero('9b000000-0000-0000-0000-0000000000c1')),0.000,'late cutover trial balance zero');   -- 54
select is((select count(*)::int from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000c1') where status='DIFFERENCE'),0,'late cutover reconciles MATCHED (FAILS pre-0095)');   -- 55
select throws_ok($$select public.commit_opening_cutover('9b000000-0000-0000-0000-0000000000c1',0,gen_random_uuid())$$,'23514','OPENING_CUTOVER_ALREADY_COMMITTED','late cutover one-shot');   -- 56

-- ---------------------------------------------------------------------------
-- Scenario 8: fresh cutover (O4) — pre-ledger gross payment, §16 posts the
-- opening GROSS into 2000 (no VAT split invented for history).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.commit_opening_cutover('9b000000-0000-0000-0000-0000000000d1',0,'9b400000-0000-0000-0000-000000000002')$$,'commit fresh cutover');   -- 57
select is((select public._vg_raw('9b000000-0000-0000-0000-0000000000d1','2000')),-1050.000,'fresh cutover opening deposit GROSS 1050 in 2000 (contract §16)');   -- 58
select is((select public._vg_trial_zero('9b000000-0000-0000-0000-0000000000d1')),0.000,'fresh cutover trial balance zero');   -- 59
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000d1') where dimension='CUSTOMER' and entity_label='EV-VG-FC'),'MATCHED','fresh cutover recon MATCHED');   -- 60

-- ---------------------------------------------------------------------------
-- Scenario 9: non-VAT regression + isolation + authorization.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_customer_payment('9b000000-0000-0000-0000-0000000000b1','9b000000-0000-0000-0000-0000000000e5',100.000,'CASH','D-NV',null,now(),'9b200000-0000-0000-0000-00000000001c')$$,'non-VAT deposit');   -- 61
select is((select status from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000b1') where dimension='CUSTOMER' and entity_label='EV-VG-NV'),'MATCHED','non-VAT deposits MATCHED');   -- 62
select is((select customer_deposits_gross from public.accounting_customer_positions('9b000000-0000-0000-0000-0000000000b1') where event_number='EV-VG-NV'),100.000,'non-VAT gross = net');   -- 63
select is((select count(*)::int from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000b1') where entity_label like 'EV-VG-%' and entity_label <> 'EV-VG-NV'),0,'no cross-org leakage in recon');   -- 64

set local "request.jwt.claims"='{"sub":"9b000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select * from public.accounting_reconciliation('9b000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','recon gated for non-member');   -- 65
select throws_ok($$select public.preview_opening_cutover('9b000000-0000-0000-0000-0000000000a1',0)$$,'42501','NOT_AUTHORIZED','cutover preview gated for non-member');   -- 66

select * from finish();
rollback;
