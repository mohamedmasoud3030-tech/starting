-- ============================================================================
-- 0085 — treasury accounts: create, opening, transfer, balances, gates.
-- ============================================================================
begin;
select plan(24);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000001','authenticated','authenticated','tr-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000002','authenticated','authenticated','tr-sup-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000003','authenticated','authenticated','tr-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('97100000-0000-0000-0000-0000000000a1','Treasury Org A'),
('97100000-0000-0000-0000-0000000000b1','Treasury Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-000000000001','OWNER'),
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-000000000002','SUPERVISOR'),
('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-000000000003','OWNER');

-- Run as the definer (postgres) with jwt claims so SECURITY DEFINER commands
-- authenticate as the OWNER; switch to `authenticated` only for the raw-read RLS test.
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.create_treasury_account('97100000-0000-0000-0000-0000000000a1','Main Cash','CASH',null,null,null,'99100000-0000-0000-0000-000000000001')$$,'OWNER creates a CASH treasury account');
select lives_ok($$select public.create_treasury_account('97100000-0000-0000-0000-0000000000a1','Bank Muscat','BANK','Bank Muscat','1234',null,'99100000-0000-0000-0000-000000000002')$$,'OWNER creates a BANK treasury account');
select is((select count(*)::int from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1'),2,'two treasury accounts created');
select is((select (select code from public.chart_of_accounts where id=treasury_accounts.chart_account_id) from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),'1001','CASH child chart account code is 1001');
select is((select (select code from public.chart_of_accounts where id=treasury_accounts.chart_account_id) from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),'1011','BANK child chart account code is 1011');

select lives_ok($$select public.set_treasury_opening_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),500.000,'99100000-0000-0000-0000-000000000010')$$,'set cash opening balance 500');
select lives_ok($$select public.set_treasury_opening_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),100.000,'99100000-0000-0000-0000-000000000011')$$,'set bank opening balance 100');
select is((select t.balance from public.treasury_account_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash')) t),500.000,'cash balance is 500 after opening');
select is((select t.balance from public.treasury_account_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat')) t),100.000,'bank balance is 100 after opening');

-- Transfer: no revenue/expense/customer/event effect; one balanced journal only.
select lives_ok($$select public.treasury_transfer('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),200.000,'move to bank','99100000-0000-0000-0000-000000000020')$$,'transfer 200 cash -> bank');
select is((select t.balance from public.treasury_account_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash')) t),300.000,'cash is 300 after transfer');
select is((select t.balance from public.treasury_account_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat')) t),300.000,'bank is 300 after transfer');
select is((select count(*)::int from public.journal_entries where organization_id='97100000-0000-0000-0000-0000000000a1' and source_type='TREASURY_TRANSFER'),1,'exactly one transfer journal');
select is((select count(*)::int from public.journal_lines l join public.journal_entries e on l.entry_id=e.id where e.organization_id='97100000-0000-0000-0000-0000000000a1' and e.source_type='TREASURY_TRANSFER' and l.account_id in (select id from public.chart_of_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and code in ('4000','5000','5100','5200'))),0,'transfer touches no revenue/expense account');

-- Idempotency: replay returns original, no second journal.
select lives_ok($$select public.treasury_transfer('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),200.000,'move to bank','99100000-0000-0000-0000-000000000020')$$,'idempotent transfer replay');
select is((select count(*)::int from public.journal_entries where organization_id='97100000-0000-0000-0000-0000000000a1' and source_type='TREASURY_TRANSFER'),1,'replay does not create a second transfer journal');

-- Negative balance and same-account guards.
select throws_ok($$select public.treasury_transfer('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),400.000,null,'99100000-0000-0000-0000-000000000021')$$,'23514','TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED','cannot transfer more than current cash');
select throws_ok($$select public.treasury_transfer('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),10.000,null,'99100000-0000-0000-0000-000000000022')$$,'23514','TREASURY_TRANSFER_SAME_ACCOUNT','cannot transfer to the same account');

-- Deactivate guard (non-zero balance).
select throws_ok($$select public.update_treasury_account('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),null,false,null,null,null,'99100000-0000-0000-0000-000000000030')$$,'23514','TREASURY_NONZERO_BALANCE_DEACTIVATE','cannot deactivate an account with non-zero balance');
select is((select is_active from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),true,'cash account remains active');

-- Cross-org: org-B owner cannot touch org-A treasury.
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.treasury_transfer('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'),(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),10.000,null,'99100000-0000-0000-0000-000000000025')$$,'42501','NOT_AUTHORIZED','org-B owner cannot operate org-A treasury');

-- Permission gate: SUPERVISOR cannot create treasury accounts.
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.create_treasury_account('97100000-0000-0000-0000-0000000000a1','Petty Cash','CASH',null,null,null,'99100000-0000-0000-0000-000000000040')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot create treasury accounts');
select throws_ok($$select public.treasury_account_balance('97100000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='97100000-0000-0000-0000-0000000000a1' and name='Main Cash'))$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot read treasury balances (no cost.visibility)');

-- Direct table read is blocked by RLS.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select count(*) from public.treasury_accounts$$,'42501',null,'authenticated cannot read the raw treasury_accounts table');

select * from finish();
rollback;
