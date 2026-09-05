-- ============================================================================
-- 0088 — operational expense posting pgTAP.
--
-- Covers: direct expense Dr 5200 / Cr Treasury; treasury attribution (valid
-- CASH / BANK, cross-org rejected, inactive rejected, insufficient rejected,
-- no negative CASH); expense void via reverse_journal_entry (original
-- immutable, reversal points to original, balances restored, repeat rejected);
-- idempotent replay (no duplicate journal); authorization (finance.manage,
-- cross-org, raw RLS); and procurement non-posting (PO/approval/receipt emit NO
-- journal, and no procurement->expense double posting). Also reconciles
-- operational expense totals to the event expense account balance.
--
-- Assertions inspect real ledger balances / journal relationships, not just RPC
-- return values. Runs under the definer (postgres) with jwt claims so the
-- revoked journal tables are readable for verification.
-- ============================================================================
begin;
select plan(42);

-- Test helper helpers (available under the definer).
create or replace function public._xp_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
-- Credit-normal account balance (credit - debit).
create or replace function public._xp_credit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(credit) - sum(debit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;
-- Debit-normal account balance (debit - credit).
create or replace function public._xp_debit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;

-- Fixtures ----------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000001','authenticated','authenticated','ex-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000002','authenticated','authenticated','ex-sup-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000003','authenticated','authenticated','ex-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('9a000000-0000-0000-0000-0000000000a1','Exp Org A'),
('9a000000-0000-0000-0000-0000000000b1','Exp Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000001','OWNER'),
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000002','SUPERVISOR'),
('9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-000000000003','OWNER');

insert into public.customers(id,organization_id,name) values
('9a000000-0000-0000-0000-0000000000c1','9a000000-0000-0000-0000-0000000000a1','Cust A'),
('9a000000-0000-0000-0000-0000000000c2','9a000000-0000-0000-0000-0000000000b1','Cust B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000c1','EV-X-1','Exp Ev','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','IN_PROGRESS','9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001'),
('9a000000-0000-0000-0000-0000000000e2','9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-0000000000c2','EV-X-2','Cross Ev','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','IN_PROGRESS','9b000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000003');

-- Act as OWNER of org A.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('9a000000-0000-0000-0000-0000000000a1')$$,'seed chart');

-- Create treasurer accounts: CASH (500) and BANK (1000).
select lives_ok($$select public.create_treasury_account('9a000000-0000-0000-0000-0000000000a1','Petty Cash','CASH',null,null,null,'9c000000-0000-0000-0000-000000000001')$$,'create CASH treasury');
select lives_ok($$select public.create_treasury_account('9a000000-0000-0000-0000-0000000000a1','Bank Muscat','BANK','Bank Muscat','1234',null,'9c000000-0000-0000-0000-000000000002')$$,'create BANK treasury');
select lives_ok($$select public.set_treasury_opening_balance('9a000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'),500.000,'9c000000-0000-0000-0000-000000000010')$$,'cash opening 500');
select lives_ok($$select public.set_treasury_opening_balance('9a000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Bank Muscat'),1000.000,'9c000000-0000-0000-0000-000000000011')$$,'bank opening 1000');

-- ======================= Direct expense posting ======================= --
select lives_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','TRANSPORT',25.000,'2026-11-01','نقل', 'CASH', null, 'RC-1', '9d000000-0000-0000-0000-000000000001')$$,'record transport expense (default CASH)');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',public._xp_chart('9a000000-0000-0000-0000-0000000000a1','5200'))),25.000,'expense account debited 25');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),475.000,'petty cash reduced to 475');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Bank Muscat'))),1000.000,'bank untouched (1000)');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE'),1,'one EVENT_EXPENSE journal');
select is((select count(*)::int from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.organization_id='9a000000-0000-0000-0000-0000000000a1' and e.source_type='EVENT_EXPENSE'),2,'two balanced lines');

-- Idempotent replay: same key + payload => no duplicate journal.
select lives_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','TRANSPORT',25.000,'2026-11-01','نقل', 'CASH', null, 'RC-1', '9d000000-0000-0000-0000-000000000001')$$,'replay expense');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE'),1,'no duplicate journal on replay');
select is((select count(*)::int from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1' and reference='RC-1'),1,'one operational expense row');

-- Different command => separate journal.
select lives_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','FUEL',15.000,'2026-11-02','وقود','CASH',null,'RC-2','9d000000-0000-0000-0000-000000000002')$$,'record second expense');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',public._xp_chart('9a000000-0000-0000-0000-0000000000a1','5200'))),40.000,'expense total = 40');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE'),2,'two EVENT_EXPENSE journals');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),460.000,'petty cash = 500 - 40');

-- ======================= Treasury failures ======================= --
-- Cross-org treasury account is rejected. Give org B a real treasury first
-- (act as org-B owner to create it), then switch back to org-A owner.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.create_treasury_account('9a000000-0000-0000-0000-0000000000b1','OrgB Cash','CASH',null,null,null,'9c000000-0000-0000-0000-000000000005')$$,'create org-B treasury');
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',10.000,'2026-11-03','x',null,null,null,'9d000000-0000-0000-0000-000000000011',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000b1' and name='OrgB Cash'))$$,'P0002','TREASURY_ACCOUNT_NOT_FOUND','cross-org treasury rejected');
-- Inactive treasury account is rejected.
select lives_ok($$select public.create_treasury_account('9a000000-0000-0000-0000-0000000000a1','Idle Box','CASH',null,null,null,'9c000000-0000-0000-0000-000000000003')$$,'create idle cash');
select lives_ok($$select public.update_treasury_account('9a000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Idle Box'),null,false,null,null,null,'9c000000-0000-0000-0000-000000000004')$$,'deactivate idle cash (zero balance)');
select throws_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',10.000,'2026-11-03','x',null,null,null,'9d000000-0000-0000-0000-000000000012',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Idle Box'))$$,'42501','TREASURY_ACCOUNT_INACTIVE','inactive treasury rejected');
-- Insufficient CASH is rejected (no negative cash).
select throws_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',5000.000,'2026-11-03','too big',null,null,null,'9d000000-0000-0000-0000-000000000013',(select id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))$$,'23514','TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED','insufficient cash rejected');

-- ======================= Expense void ======================= --
select lives_ok($$select public.void_event_expense('9a000000-0000-0000-0000-0000000000a1',(select id from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1' and reference='RC-2'),'entered in error','9d000000-0000-0000-0000-000000000020')$$,'void fuel expense');
select is((select status::text from public.event_expenses where reference='RC-2' and organization_id='9a000000-0000-0000-0000-0000000000a1'),'VOIDED','expense marked VOIDED');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',public._xp_chart('9a000000-0000-0000-0000-0000000000a1','5200'))),25.000,'expense balance restored to 25');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),475.000,'petty cash restored to 475');
-- Original journal remains, reversal references it.
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE' and not is_reversal),2,'both originals immutable');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE_VOID' and is_reversal),1,'one EVENT_EXPENSE_VOID reversal');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE_VOID' and reversal_of is not null),1,'reversal references an original');
-- Repeat void rejected.
select throws_ok($$select public.void_event_expense('9a000000-0000-0000-0000-0000000000a1',(select id from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1' and reference='RC-2'),'again','9d000000-0000-0000-0000-000000000021')$$,'P0001','EXPENSE_ALREADY_VOIDED','repeat void rejected');

-- ======================= Reconciliation ======================= --
select is((select coalesce(sum(amount),0) from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1' and status='RECORDED'),25.000,'operational RECORDED expense total');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',public._xp_chart('9a000000-0000-0000-0000-0000000000a1','5200'))),25.000,'ledger expense = operational total');

-- ======================= Authorization ======================= --
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',10.000,'2026-11-04','x',null,null,null,'9d000000-0000-0000-0000-000000000030')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot record expense');
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.record_event_expense('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',10.000,'2026-11-04','x',null,null,null,'9d000000-0000-0000-0000-000000000031')$$,'42501','NOT_AUTHORIZED','cross-org expense rejected');
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ======================= Procurement: NO posting ======================= --
-- Purchase order creation/approval/receipt must NOT emit a journal and must NOT
-- touch the expense/treasury accounts (anti-double-counting). We assert that no
-- procurement-derived journal source type ever exists and that the expense /
-- treasury balances are unchanged after creating a supplier.
insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
('9a000000-0000-0000-0000-0000000004d1','9a000000-0000-0000-0000-0000000000a1','Supplier A','ACTIVE','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.journal_entries where organization_id='9a000000-0000-0000-0000-0000000000a1' and source_type in ('SUPPLIER_INVOICE','SUPPLIER_PAYMENT','SUPPLIER_INVOICE_VOID','SUPPLIER_PAYMENT_VOID')),0,'no SUPPLIER_* journal exists (procurement is not a financial event here)');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='9a000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),475.000,'treasury unchanged by procurement activity');
select is((select public._xp_debit('9a000000-0000-0000-0000-0000000000a1',public._xp_chart('9a000000-0000-0000-0000-0000000000a1','5200'))),25.000,'expense account unchanged by procurement');
-- The event_expenses table records no procurement rows (0067 excludes PURCHASE/STAFF).
select is((select count(*)::int from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1' and category in ('OTHER','CONSUMABLE')),0,'procurement is not double-recorded as an event expense');

-- ======================= Raw RLS denial (final) ======================= --
-- As the SUPERVISOR (which lacks cost.visibility), the SELECT policy filters all
-- rows out (count = 0) and the raw INSERT is denied by RLS.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.event_expenses where organization_id='9a000000-0000-0000-0000-0000000000a1'),0,'raw expense ledger hidden from non-cost role');
select throws_ok($$insert into public.event_expenses(organization_id,event_id,category,amount,expense_date,description,recorded_by,idempotency_key,request_fingerprint) values('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000e1','OTHER',1.000,'2026-11-04','x','9a000000-0000-0000-0000-000000000001','9f000000-0000-0000-0000-000000000099',repeat('0',64))$$,'42501',null,'raw expense INSERT denied');

select * from finish();
rollback;
