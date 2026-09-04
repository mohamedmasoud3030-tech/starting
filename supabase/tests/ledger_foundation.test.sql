-- ============================================================================
-- 0084 — double-entry ledger foundation invariants.
-- Runs as the definer (postgres) to exercise the internal posting primitive and
-- the DB-level invariants; switches to `authenticated` only for the
-- direct-write / RLS rejection checks.
-- ============================================================================
begin;
select plan(51);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-000000000001','authenticated','authenticated','ledger-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-000000000002','authenticated','authenticated','ledger-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('97000000-0000-0000-0000-0000000000a1','Ledger Org A'),
('97000000-0000-0000-0000-0000000000b1','Ledger Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000001','OWNER'),
('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-000000000002','OWNER');

set local "request.jwt.claims"='{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('97000000-0000-0000-0000-0000000000a1')$$,'system chart seeds for org A');
select lives_ok($$select public.ensure_system_chart('97000000-0000-0000-0000-0000000000a1')$$,'system chart reseeds idempotently');
select lives_ok($$select public.ensure_system_chart('97000000-0000-0000-0000-0000000000b1')$$,'system chart seeds for org B');
select is((select count(*)::int from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1'),16,'org A chart has exactly 16 active system accounts');
select is((select count(*)::int from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000b1'),16,'org B chart has exactly 16 active system accounts');

select is((select account_type::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1100'),'ASSET','1100 is ASSET');
select is((select normal_balance::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1100'),'DEBIT','1100 is debit-normal');
select is((select normal_balance::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'CREDIT','2000 is credit-normal');
select is((select normal_balance::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='4000'),'CREDIT','4000 is credit-normal');
select is((select account_type::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='5000'),'EXPENSE','5000 is EXPENSE');
select is((select normal_balance::text from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='5200'),'DEBIT','5200 is debit-normal');

select lives_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'CUSTOMER_PAYMENT','97000000-0000-0000-0000-00000000aa01',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',100.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',100.000)),'98000000-0000-0000-0000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','deposit')$$,'post a balanced customer-payment journal');
select is((select entry_number from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT' and is_reversal=false) like 'JE-%',true,'journal number is JE-prefixed');
select is((select count(*)::int from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1'),1,'one journal entry posted');

select lives_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'CUSTOMER_PAYMENT','97000000-0000-0000-0000-00000000aa01',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',100.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',100.000)),'98000000-0000-0000-0000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'idempotent replay returns original without new entry');
select is((select count(*)::int from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1'),1,'replay creates exactly one journal');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'CUSTOMER_PAYMENT','97000000-0000-0000-0000-00000000aa01',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',999.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',999.000)),'98000000-0000-0000-0000-000000000001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same key + different payload fails');

select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa02',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',50.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',40.000)),'98000000-0000-0000-0000-000000000002',null)$$,'23514','JOURNAL_UNBALANCED','unbalanced entry is rejected');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa03',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',50.000,'credit',0)),'98000000-0000-0000-0000-000000000003',null)$$,'23514','JOURNAL_REQUIRES_TWO_LINES','single-line entry is rejected');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa04',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',50.000,'credit',50.000),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',50.000,'credit',50.000)),'98000000-0000-0000-0000-000000000004',null)$$,'23514','JOURNAL_LINE_BOTH_SIDES','both-sides line is rejected');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa05',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',0,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',0)),'98000000-0000-0000-0000-000000000005',null)$$,'23514','JOURNAL_ZERO_LINE','zero line is rejected');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa06',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',10.0001,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',10.0001)),'98000000-0000-0000-0000-000000000006',null)$$,'22023','OMR_PRECISION_EXCEEDED','more than 3 decimals is rejected');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa07',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000b1' and code='1000'),'debit',50.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',50.000)),'98000000-0000-0000-0000-000000000007',null)$$,'23503','JOURNAL_ACCOUNT_NOT_FOUND','org-B account cannot be posted into org-A journal');

select lives_ok($$update public.chart_of_accounts set is_active=false where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1100'$$,'deactivate 1100 for test');
select throws_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000aa08',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1100'),'debit',50.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),'debit',0,'credit',50.000)),'98000000-0000-0000-0000-000000000008',null)$$,'42501','ACCOUNT_INACTIVE','inactive account cannot be posted');
select lives_ok($$update public.chart_of_accounts set is_active=true where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1100'$$,'reactivate 1100');

select is((select b.raw_balance from public.account_balance('97000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000')) b),100.000::numeric,'cash raw balance after one 100 debit');
select is((select b.raw_balance from public.account_balance('97000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000')) b),-100.000::numeric,'deposits raw balance (credit)');
select is((select b.balance from public.account_balance('97000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000')) b),100.000::numeric,'deposits normalized balance is positive (credit-normal)');
select is((select b.raw_balance from public.account_balance_at_time('97000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),current_date) b),-100.000::numeric,'balance-at-time includes the entry as of today');
select is((select b.raw_balance from public.account_balance_at_time('97000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='2000'),(current_date - 1)) b),0::numeric,'balance-at-time before the entry is zero');

select is((select (select coalesce(sum(debit),0) from public.journal_lines) = (select coalesce(sum(credit),0) from public.journal_lines)),true,'global debits equal credits');

select lives_ok($$select public.internal_post_journal('97000000-0000-0000-0000-0000000000a1',current_date,'EVENT_EXPENSE','97000000-0000-0000-0000-00000000aa09',jsonb_build_array(jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='5200'),'debit',30.000,'credit',0),jsonb_build_object('account_id',(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='1000'),'debit',0,'credit',30.000)),'98000000-0000-0000-0000-000000000009',null)$$,'post an expense journal');
select is((select (select coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0) from public.journal_lines l join public.journal_entries e on l.entry_id=e.id where e.organization_id='97000000-0000-0000-0000-0000000000a1' and e.source_type='EVENT_EXPENSE' and e.is_reversal=false and l.account_id=(select id from public.chart_of_accounts where organization_id='97000000-0000-0000-0000-0000000000a1' and code='5200'))),30.000::numeric,'expense account raw balance is +30');

select lives_ok($$select public.reverse_journal_entry('97000000-0000-0000-0000-0000000000a1',(select id from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE' and is_reversal=false),'entered in error','98000000-0000-0000-0000-000000000010')$$,'reverse the expense journal');
select is((select count(*)::int from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and is_reversal=true),1,'one reversal entry exists');
select is((select e.reversal_of is not null from public.journal_entries e where e.organization_id='97000000-0000-0000-0000-0000000000a1' and e.is_reversal=true),true,'reversal references the original journal');
select is((select (select coalesce(sum(debit),0) from public.journal_lines l join public.journal_entries e on l.entry_id=e.id where e.organization_id='97000000-0000-0000-0000-0000000000a1' and e.is_reversal=true) = (select coalesce(sum(credit),0) from public.journal_lines l join public.journal_entries e on l.entry_id=e.id where e.organization_id='97000000-0000-0000-0000-0000000000a1' and e.is_reversal=true)),true,'reversal is balanced');

select throws_ok($$select public.reverse_journal_entry('97000000-0000-0000-0000-0000000000a1',(select id from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE' and is_reversal=false),'again','98000000-0000-0000-0000-000000000011')$$,'23514','JOURNAL_ALREADY_REVERSED','journal cannot be reversed twice');
select throws_ok($$select public.reverse_journal_entry('97000000-0000-0000-0000-0000000000a1',(select id from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and is_reversal=true),'reverse a reversal','98000000-0000-0000-0000-000000000012')$$,'23514','CANNOT_REVERSE_REVERSAL','a reversal entry cannot be reversed');
select throws_ok($$select public.reverse_journal_entry('97000000-0000-0000-0000-0000000000a1',(select id from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1' and source_type='CUSTOMER_PAYMENT' and is_reversal=false),'x','98000000-0000-0000-0000-000000000013')$$,'22023','REVERSAL_REASON_REQUIRED','reversal requires a reason of at least 3 chars');

select throws_ok($$delete from public.journal_entries where organization_id='97000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_IMMUTABLE','journal entry DELETE is denied');
select throws_ok($$update public.journal_entries set memo='x' where organization_id='97000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_IMMUTABLE','journal entry UPDATE is denied');
select throws_ok($$delete from public.journal_lines where organization_id='97000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_LINE_IMMUTABLE','journal line DELETE is denied');
select throws_ok($$update public.journal_lines set debit=0 where organization_id='97000000-0000-0000-0000-0000000000a1'$$,'42501','JOURNAL_LINE_IMMUTABLE','journal line UPDATE is denied');

-- DB-level balanced invariant is installed as a DEFERRABLE CONSTRAINT TRIGGER.
select is((select count(*)::int from pg_trigger where tgname='journal_lines_balanced'),1,'balanced-journal constraint trigger is installed');
select is((select count(*)::int from pg_trigger where tgname='journal_entries_immutable'),1,'journal immutability trigger is installed');

-- Direct client reads/writes to the ledger are denied (RLS + no grants).
select set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select count(*) from public.journal_entries$$,'42501',null,'authenticated cannot read raw journal_entries');
select throws_ok($$select count(*) from public.journal_lines$$,'42501',null,'authenticated cannot read raw journal_lines');
select throws_ok($$select count(*) from public.chart_of_accounts$$,'42501',null,'authenticated cannot read raw chart_of_accounts');
select throws_ok($$insert into public.journal_entries(organization_id,entry_number,entry_date,source_type,source_id,idempotency_key,request_fingerprint,created_by) values('97000000-0000-0000-0000-0000000000a1','JE-X',current_date,'ADJUSTMENT','97000000-0000-0000-0000-00000000cc01','98100000-0000-0000-0000-000000000030',repeat('0',64),'97000000-0000-0000-0000-000000000001')$$,'42501',null,'authenticated cannot directly insert a journal');

select * from finish();
rollback;
