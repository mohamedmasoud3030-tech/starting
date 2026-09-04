-- ============================================================================
-- 0086 — customer payments now post their accounting consequence to the journal.
--
--   * pre-invoice payment  -> Dr Treasury / Cr Customer Deposits (+ Cr VAT Payable)
--   * post-invoice payment -> Dr Treasury / Cr Accounts Receivable
--   * void                 -> CUSTOMER_PAYMENT_VOID reversal
--
-- Assertions run under the definer (postgres) with the OWNER jwt claims set,
-- so journal tables (revoked/no-policy) are readable for verification.
-- ============================================================================
begin;
select plan(28);

-- Fixtures: org A (OWNER) with a non-VAT and a VAT-registered quotation; org B
-- proves tenant isolation.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-000000000001','authenticated','authenticated','s6p-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-000000000002','authenticated','authenticated','s6p-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('98000000-0000-0000-0000-0000000000a1','Posting Org A'),
('98000000-0000-0000-0000-0000000000b1','Posting Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000001','OWNER'),
('98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-000000000002','OWNER');

insert into public.customers(id,organization_id,name) values
('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000a1','Customer A'),
('98000000-0000-0000-0000-0000000000c2','98000000-0000-0000-0000-0000000000b1','Customer B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1','EV-P-A','Plain','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','98100000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000e2','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1','EV-P-VAT','Vat','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','98100000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000e3','98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000c2','EV-P-B','Cross','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','98100000-0000-0000-0000-000000000003','98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000002');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','QT-P-A',1,'ACCEPTED','Customer A','EV-P-A','Plain',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',500.000,300.000,200.000,500.000,false,0,0.000,'98100000-0000-0000-0000-000000000011','98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001',now()),
('98000000-0000-0000-0000-0000000000f2','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e2','QT-P-VAT',1,'ACCEPTED','Customer A','EV-P-VAT','Vat',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',2100.000,1200.000,900.000,2000.000,true,5.000,100.000,'98100000-0000-0000-0000-000000000012','98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001',now()),
('98000000-0000-0000-0000-0000000000f3','98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000e3','QT-P-B',1,'ACCEPTED','Customer B','EV-P-B','Cross',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Salalah',400.000,200.000,200.000,400.000,false,0,0.000,'98100000-0000-0000-0000-000000000013','98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000002',now());
update public.events set accepted_quotation_id='98000000-0000-0000-0000-0000000000f1' where id='98000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='98000000-0000-0000-0000-0000000000f2' where id='98000000-0000-0000-0000-0000000000e2';
update public.events set accepted_quotation_id='98000000-0000-0000-0000-0000000000f3' where id='98000000-0000-0000-0000-0000000000e3';

-- Act as OWNER of org A (definer session with jwt claims; journal is readable).
set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Helper: id of a system account by code.
create or replace function public._t_account(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code
$$;

-- 1. Non-VAT deposit posts Dr Treasury / Cr Customer Deposits.
select lives_ok($$select public.record_customer_payment('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1',150.000,'CASH','D-1',null,now(),'98200000-0000-0000-0000-000000000001')$$,'non-VAT deposit records');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','1000'))),150.000,'treasury debited 150');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2000'))),150.000,'customer deposits credited 150 (non-VAT gross)');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2150'))),0.000,'no VAT liability for non-VAT org');
select is((select count(*)::int from public.journal_entries where organization_id='98000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT' and source_id=(select id from public.customer_payments where reference='D-1')),1,'exactly one CUSTOMER_PAYMENT journal');

-- 2. Journal is balanced (SUM(debit) = SUM(credit)) and multi-line.
select is((select sum(debit) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.organization_id='98000000-0000-0000-0000-0000000000a1' and e.source_type='CUSTOMER_PAYMENT' and e.source_id=(select id from public.customer_payments where reference='D-1')),150.000,'deposit debits sum 150');
select is((select sum(credit) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.organization_id='98000000-0000-0000-0000-0000000000a1' and e.source_type='CUSTOMER_PAYMENT' and e.source_id=(select id from public.customer_payments where reference='D-1')),150.000,'deposit credits sum 150');

-- 3. Idempotent replay adds no second journal.
select lives_ok($$select public.record_customer_payment('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1',150.000,'CASH','D-1',null,now(),'98200000-0000-0000-0000-000000000001')$$,'same key+payload replays');
select is((select count(*)::int from public.journal_entries where organization_id='98000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT'),1,'replay does not duplicate the journal');

-- 4. VAT-registered deposit posts Dr Treasury gross / Cr Deposits net / Cr VAT Payable.
select lives_ok($$select public.record_customer_payment('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e2',1050.000,'BANK_TRANSFER','D-VAT',null,now(),'98200000-0000-0000-0000-000000000002')$$,'VAT-registered deposit records');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','1000'))),1200.000,'treasury = 150 + 1050');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2000'))),1150.000,'deposits = 150 gross + 1000 net');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2150'))),50.000,'VAT payable = 50 (5% of 1050 gross)');

-- 5. Void reverses the VAT deposit fully and idempotently.
select lives_ok($$select public.void_customer_payment('98000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where reference='D-VAT'),'entered in error','98200000-0000-0000-0000-000000000010')$$,'void VAT deposit');
select is((select count(*)::int from public.journal_entries where organization_id='98000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT_VOID' and is_reversal),1,'void creates one CUSTOMER_PAYMENT_VOID reversal');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','1000'))),150.000,'treasury restored to 150');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2000'))),150.000,'deposits restored to 150');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2150'))),0.000,'VAT payable restored to 0');
select lives_ok($$select public.void_customer_payment('98000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where reference='D-VAT'),'entered in error','98200000-0000-0000-0000-000000000010')$$,'void replays idempotently');
select is((select count(*)::int from public.journal_entries where organization_id='98000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT_VOID' and is_reversal),1,'no duplicate void journal');

-- 6. Reversal of a non-VAT deposit restores balances.
select lives_ok($$select public.void_customer_payment('98000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where reference='D-1'),'customer cancelled','98200000-0000-0000-0000-000000000011')$$,'void non-VAT deposit');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','1000'))),0.000,'treasury fully restored');
select is((select balance from public.account_balance('98000000-0000-0000-0000-0000000000a1',public._t_account('98000000-0000-0000-0000-0000000000a1','2000'))),0.000,'deposits fully restored');

-- 7. Every journal is immutable: corrections only via reversal.
select throws_ok($$update public.journal_entries set memo='x' where organization_id='98000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_IMMUTABLE','posted journal cannot be edited');
select throws_ok($$delete from public.journal_lines where organization_id='98000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_LINE_IMMUTABLE','journal line cannot be deleted');

-- 8. Tenant isolation: org-B owner cannot post into org A.
set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.record_customer_payment('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),'98200000-0000-0000-0000-000000000020')$$,'42501','NOT_AUTHORIZED','cross-org payment is rejected');

-- 9. A supervisor/manager without payment.record cannot post.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-000000000003','authenticated','authenticated','s6p-sup@test.local','x',now(),now(),now(),'{}','{}',false);
insert into public.organization_memberships(organization_id,user_id,role) values
('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000003','SUPERVISOR');
set local "request.jwt.claims"='{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.record_customer_payment('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),'98200000-0000-0000-0000-000000000021')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot record payments');
select is((select count(*)::int from public.journal_entries where organization_id='98000000-0000-0000-0000-0000000000a1'),4,'no journal was posted for the denied payment');

select * from finish();
rollback;
