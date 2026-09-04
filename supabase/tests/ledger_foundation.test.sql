-- ============================================================================
-- A1 Ledger Foundation — schema, invariants, idempotency, reversal,
-- tenant isolation, capability, balance APIs, RLS, entry_number safety.
-- ============================================================================
begin;
select plan(88);

-- Fixture users
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000001','authenticated','authenticated','a1-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000002','authenticated','authenticated','a1-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000003','authenticated','authenticated','a1-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000004','authenticated','authenticated','a1-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000005','authenticated','authenticated','a1-accountant-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000006','authenticated','authenticated','a1-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('a1000000-0000-0000-0000-0000000000a1','A1 Org A'),
('a1000000-0000-0000-0000-0000000000b1','A1 Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','OWNER'),
('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000002','MANAGER'),
('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003','SUPERVISOR'),
('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000004','WAREHOUSE'),
('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-000000000005','ACCOUNTANT'),
('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-000000000006','OWNER');

-- Org trigger should have seeded chart_of_accounts for both orgs via ensure_ledger_accounts
-- Verify seeding
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1'),22,'org A has 22 system accounts (16 active + 6 deferred)');
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and is_active=true),16,'org A has 16 active accounts');
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and is_active=false),6,'org A has 6 deferred placeholders');
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000b1'),22,'org B has 22 system accounts');

-- Check specific active accounts exist with correct type/normal_balance
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000' and account_type='ASSET' and normal_balance='DEBIT' and is_active=true and is_system=true),'1000 Cash ASSET DEBIT active system');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1100' and account_type='ASSET' and normal_balance='DEBIT'),'1100 AR exists');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1120' and account_type='ASSET' and normal_balance='DEBIT'),'1120 Unbilled Receivable Contract Asset exists');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1150' and account_type='ASSET' and normal_balance='DEBIT'),'1150 Staff Advances & Receivables exists');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='2000' and account_type='LIABILITY' and normal_balance='CREDIT'),'2000 Customer Deposits LIABILITY CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='2100' and normal_balance='CREDIT'),'2100 Deferred CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='2150' and account_type='LIABILITY' and normal_balance='CREDIT'),'2150 VAT Payable CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='2300' and normal_balance='CREDIT'),'2300 Payroll Payable CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000' and account_type='EQUITY' and normal_balance='CREDIT'),'3000 Opening Equity EQUITY CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='4000' and account_type='REVENUE' and normal_balance='CREDIT'),'4000 Event Revenue REVENUE CREDIT');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='5000' and account_type='EXPENSE' and normal_balance='DEBIT'),'5000 Staff Cost EXPENSE DEBIT');

-- Deferred placeholders
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1155' and is_active=false),'1155 Input VAT deferred inactive');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1200' and is_active=false),'1200 Inventory deferred');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1300' and is_active=false),'1300 Equipment deferred');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='2400' and is_active=false),'2400 GRNI deferred');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3100' and is_active=false),'3100 Retained Earnings deferred');
select ok(exists(select 1 from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='5300' and is_active=false),'5300 Damage/Loss deferred');

-- Check unique constraints and code format
select ok((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code !~ '^[0-9]{4}$')=0,'all codes match ^[0-9]{4}$');

-- Check document_sequences kind includes JOURNAL_ENTRY
select ok(exists(select 1 from information_schema.check_constraints where constraint_name='document_sequences_kind_check' and check_clause like '%JOURNAL_ENTRY%'),'document_sequences kind check includes JOURNAL_ENTRY');
select is(public.document_number_prefix('a1000000-0000-0000-0000-0000000000a1','JOURNAL_ENTRY'),'JE','document_number_prefix returns JE for JOURNAL_ENTRY');

-- Check enums exist
select ok(exists(select 1 from pg_type where typname='account_type'),'enum account_type exists');
select ok(exists(select 1 from pg_type where typname='normal_balance'),'enum normal_balance exists');
select ok(exists(select 1 from pg_type where typname='journal_source_type'),'enum journal_source_type exists');

-- Check required source_type values exist
select ok((select count(*)::int from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='journal_source_type' and e.enumlabel in ('OPENING_BALANCE','CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID','EVENT_INVOICE','EVENT_INVOICE_VOID','REVENUE_RECOGNITION','UNBILLED_RECOGNITION','CONTRACT_ASSET_RECLASSIFICATION','STAFF_EARNING','STAFF_EARNING_VOID','STAFF_ADVANCE','STAFF_ADVANCE_VOID','STAFF_RECEIVABLE_RECOGNITION','HOST_PAYOUT','EVENT_EXPENSE','EVENT_EXPENSE_VOID','SUPPLIER_INVOICE','SUPPLIER_PAYMENT','TREASURY_TRANSFER','JOURNAL_REVERSAL'))=20,'required source_type taxonomy present');

-- RLS enabled
select ok((select relrowsecurity from pg_class where relname='chart_of_accounts')=true,'chart_of_accounts RLS enabled');
select ok((select relrowsecurity from pg_class where relname='journal_entries')=true,'journal_entries RLS enabled');
select ok((select relrowsecurity from pg_class where relname='journal_lines')=true,'journal_lines RLS enabled');

-- No direct table grants for anon/authenticated (check via has_table_privilege as postgres bypasses, so check pg_roles? Instead check that no policies allow anon insert — we test via authenticated role)
-- Direct table access denied for authenticated
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.chart_of_accounts(organization_id,code,name,account_type,normal_balance) values('a1000000-0000-0000-0000-0000000000a1','9999','Test','ASSET','DEBIT')$$,'42501',null,'direct chart_of_accounts INSERT denied for authenticated');
select throws_ok($$insert into public.journal_entries(organization_id,entry_number,entry_date,event_at,source_type,idempotency_key,fingerprint,created_by) values('a1000000-0000-0000-0000-0000000000a1','JE-TEST','2026-01-01',now(),'OPENING_BALANCE','a2000000-0000-0000-0000-000000000001','fingerprint','a1000000-0000-0000-0000-000000000001')$$,'42501',null,'direct journal_entries INSERT denied');
select throws_ok($$insert into public.journal_lines(organization_id,entry_id,account_id,debit,credit) values('a1000000-0000-0000-0000-0000000000a1','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001',100,0)$$,'42501',null,'direct journal_lines INSERT denied');
reset role;

-- internal_post_journal not executable by authenticated (no grants)
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.internal_post_journal('a1000000-0000-0000-0000-0000000000a1','2026-01-01',now(),'OPENING_BALANCE',null,null,null,'[]'::jsonb,'a2000000-0000-0000-0000-000000000002','fp','a1000000-0000-0000-0000-000000000001')$$,'42501',null,'internal_post_journal not granted to authenticated');
reset role;

-- Valid posting via internal_post_journal as postgres (superuser bypass)
-- Prepare account ids
-- Use cash 1000 and opening equity 3000 for opening balance
select lives_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-01',
    p_event_at := '2026-01-01 10:00:00+04',
    p_source_type := 'OPENING_BALANCE',
    p_source_id := null,
    p_memo := 'Opening cash',
    p_event_id := null,
    p_lines := (
      select jsonb_agg(jsonb_build_object('account_id', id, 'debit', case when code='1000' then 1000.000 else 0 end, 'credit', case when code='3000' then 1000.000 else 0 end, 'memo', 'opening'))
      from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code in ('1000','3000')
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000010',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','opening-1')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'valid opening balance journal posts');

-- Check entry_number generated via JE prefix and unique
select ok((select entry_number like 'JE-%' from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1' and idempotency_key='a2000000-0000-0000-0000-000000000010'),'entry_number has JE prefix');
select is((select count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),1,'one journal entry after first post');

-- Idempotency: same key same fingerprint returns same entry, no duplicate
select lives_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-01',
    p_event_at := '2026-01-01 10:00:00+04',
    p_source_type := 'OPENING_BALANCE',
    p_source_id := null,
    p_memo := 'Opening cash',
    p_event_id := null,
    p_lines := (
      select jsonb_agg(jsonb_build_object('account_id', id, 'debit', case when code='1000' then 1000.000 else 0 end, 'credit', case when code='3000' then 1000.000 else 0 end))
      from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code in ('1000','3000')
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000010',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','opening-1')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'idempotent replay with same fingerprint succeeds');
select is((select count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),1,'replay does not create duplicate entry');

-- Idempotency mismatch fails
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-01',
    p_event_at := '2026-01-01 10:00:00+04',
    p_source_type := 'OPENING_BALANCE',
    p_source_id := null,
    p_memo := 'Different',
    p_event_id := null,
    p_lines := (
      select jsonb_agg(jsonb_build_object('account_id', id, 'debit', case when code='1000' then 2000.000 else 0 end, 'credit', case when code='3000' then 2000.000 else 0 end))
      from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code in ('1000','3000')
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000010',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','different')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23505','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same key different fingerprint fails');

-- Invalid: unbalanced
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'unbalanced',
    p_event_id := null,
    p_lines := (
      select jsonb_agg(jsonb_build_object('account_id', id, 'debit', case when code='1000' then 100.000 else 0 end, 'credit', case when code='3000' then 50.000 else 0 end))
      from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code in ('1000','3000')
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000011',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','unbalanced')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23514','JOURNAL_UNBALANCED','unbalanced journal rejected');

-- Invalid: less than 2 lines
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'single line',
    p_event_id := null,
    p_lines := (
      select jsonb_build_array(jsonb_build_object('account_id', id, 'debit', 100.000, 'credit', 0))
      from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000' limit 1
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000012',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','single')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23514','JOURNAL_MIN_LINES','single line journal rejected');

-- Invalid: both debit and credit >0
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'both',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'), 'debit', 100.000, 'credit', 100.000),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'), 'debit', 0, 'credit', 200.000)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000013',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','both')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'22023','BOTH_DEBIT_CREDIT_NOT_ALLOWED','both debit and credit on same line rejected');

-- Invalid: zero/zero
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'zero',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'), 'debit', 0, 'credit', 0),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'), 'debit', 0, 'credit', 0)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000014',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','zero')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'22023','ZERO_LINE_NOT_ALLOWED','zero/zero line rejected');

-- Invalid: OMR precision exceeded
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'precision',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'), 'debit', 100.0001, 'credit', 0),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'), 'debit', 0, 'credit', 100.0001)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000015',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','precision')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'22023','OMR_PRECISION_EXCEEDED','precision beyond 3dp rejected');

-- Invalid: inactive account
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'inactive',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1155'), 'debit', 100.000, 'credit', 0),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'), 'debit', 0, 'credit', 100.000)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000016',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','inactive')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23514','ACCOUNT_INACTIVE','inactive account rejected');

-- Invalid: cross-org account
select throws_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-01-02',
    p_event_at := '2026-01-02 10:00:00+04',
    p_source_type := 'ADJUSTMENT',
    p_source_id := null,
    p_memo := 'cross org',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000b1' and code='1000'), 'debit', 100.000, 'credit', 0),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'), 'debit', 0, 'credit', 100.000)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000017',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','crossorg')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23503','ACCOUNT_NOT_IN_ORG','cross-org account rejected');

-- Immutability: update/delete blocked
select throws_ok($$update public.journal_entries set memo='hacked' where organization_id='a1000000-0000-0000-0000-0000000000a1'$$,'23514','JOURNAL_IMMUTABLE','journal_entries UPDATE blocked');
select throws_ok($$delete from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'$$,'23514','JOURNAL_IMMUTABLE','journal_entries DELETE blocked');
select throws_ok($$update public.journal_lines set debit=999 where organization_id='a1000000-0000-0000-0000-0000000000a1'$$,'23514','JOURNAL_LINE_IMMUTABLE','journal_lines UPDATE blocked');
select throws_ok($$delete from public.journal_lines where organization_id='a1000000-0000-0000-0000-0000000000a1'$$,'23514','JOURNAL_LINE_IMMUTABLE','journal_lines DELETE blocked');

-- Balance APIs — need authenticated with cost.visibility
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- raw_balance = debit - credit
select lives_ok($$select * from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))$$,'account_raw_balance callable by OWNER');
select is((select raw_balance::text from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))),'1000.000','raw_balance = SUM(debit)-SUM(credit) for Cash');
select is((select debit_total::text from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))),'1000.000','debit_total correct');
-- normalized balance: DEBIT normal => balance = raw, CREDIT normal => balance = -raw
select is((select balance::text from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))),'1000.000','account_balance DEBIT normal balance = raw');
select is((select balance::text from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'))),'1000.000','account_balance CREDIT normal: balance = -raw, raw=-1000 so balance=1000');
select is((select raw_balance::text from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='3000'))),'-1000.000','raw_balance for Opening Equity is -1000 (credit)');
reset role;

-- Capability gating: SUPERVISOR cannot read balances
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select * from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot read cost balances');
select throws_ok($$select * from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot read account_balance');
reset role;

-- ACCOUNTANT can read (has cost.visibility)
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$select * from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))$$,'ACCOUNTANT can read balances via cost.visibility');
reset role;

-- Tenant isolation: org B owner cannot read org A balances
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$select * from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))$$,'42501','NOT_AUTHORIZED','org B owner cannot read org A balances');
reset role;

-- Second valid journal to test balance_at_time and entry_number uniqueness
select lives_ok($$
  select public.internal_post_journal(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_date := '2026-02-01',
    p_event_at := '2026-02-01 12:00:00+04',
    p_source_type := 'CUSTOMER_PAYMENT',
    p_source_id := null,
    p_memo := 'Customer payment 500',
    p_event_id := null,
    p_lines := jsonb_build_array(
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'), 'debit', 500.000, 'credit', 0),
      jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1100'), 'debit', 0, 'credit', 500.000)
    ),
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000020',
    p_fingerprint := public.warehouse_fingerprint(jsonb_build_object('test','payment-500')),
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'second journal CUSTOMER_PAYMENT posts');

-- entry_number uniqueness and sequential
select ok((select count(distinct entry_number)::int = count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),'entry_number unique per org');
select is((select count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),2,'two journals after second post');

-- Balance after two journals
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select raw_balance::text from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))),'1500.000','Cash raw_balance 1500 after two journals');
select is((select balance::text from public.account_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1100'))),'500.000','AR normalized balance 500 (CREDIT normal, raw -500 => balance 500)');
-- balance_at_time
select is((select raw_balance::text from public.account_balance_at_time('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'),'2026-01-15 00:00:00+04')),'1000.000','balance_at_time before second journal returns 1000');
select is((select raw_balance::text from public.account_balance_at_time('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'),'2026-02-15 00:00:00+04')),'1500.000','balance_at_time after second journal returns 1500');
reset role;

-- Reversal primitive
select lives_ok($$
  select public.reverse_journal_entry(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_id := (select id from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1' and idempotency_key='a2000000-0000-0000-0000-000000000020'),
    p_reason := 'Entered in error',
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000030',
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'reverse_journal_entry succeeds');

select is((select count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),3,'three entries after reversal');
select ok((select is_reversal=true and reversal_of is not null and source_type='JOURNAL_REVERSAL' from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1' and idempotency_key='a2000000-0000-0000-0000-000000000030'),'reversal entry has is_reversal true, reversal_of set, source JOURNAL_REVERSAL');

-- Reversal swaps debit/credit
select is((select sum(debit)::text from public.journal_lines where entry_id=(select id from public.journal_entries where idempotency_key='a2000000-0000-0000-0000-000000000030')),'500.000','reversal debit total 500');
select is((select sum(credit)::text from public.journal_lines where entry_id=(select id from public.journal_entries where idempotency_key='a2000000-0000-0000-0000-000000000030')),'500.000','reversal credit total 500');
-- Check that reversal lines are opposite of original
select ok((
  select exists(
    select 1 from public.journal_lines orig
    join public.journal_lines rev on rev.account_id=orig.account_id and rev.entry_id=(select id from public.journal_entries where idempotency_key='a2000000-0000-0000-0000-000000000030')
    where orig.entry_id=(select id from public.journal_entries where idempotency_key='a2000000-0000-0000-0000-000000000020')
    and orig.debit=rev.credit and orig.credit=rev.debit
  )
),'reversal lines are swapped');

-- Double reversal prevented
select throws_ok($$
  select public.reverse_journal_entry(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_id := (select id from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1' and idempotency_key='a2000000-0000-0000-0000-000000000020'),
    p_reason := 'Second reversal attempt',
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000031',
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'23514','JOURNAL_ALREADY_REVERSED','double reversal blocked by unique reversal_of');

-- Reversal idempotency
select lives_ok($$
  select public.reverse_journal_entry(
    p_org_id := 'a1000000-0000-0000-0000-0000000000a1',
    p_entry_id := (select id from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1' and idempotency_key='a2000000-0000-0000-0000-000000000020'),
    p_reason := 'Entered in error',
    p_idempotency_key := 'a2000000-0000-0000-0000-000000000030',
    p_created_by := 'a1000000-0000-0000-0000-000000000001'
  )
$$,'reversal idempotent replay returns same entry');
select is((select count(*)::int from public.journal_entries where organization_id='a1000000-0000-0000-0000-0000000000a1'),3,'reversal replay does not create duplicate');

-- Balance after reversal should be back to 1000 cash
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select raw_balance::text from public.account_raw_balance('a1000000-0000-0000-0000-0000000000a1',(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'))),'1000.000','Cash raw_balance back to 1000 after reversal');
reset role;

-- ensure_ledger_accounts idempotent
select lives_ok($$select public.ensure_ledger_accounts('a1000000-0000-0000-0000-0000000000a1')$$,'ensure_ledger_accounts idempotent');
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1'),22,'still 22 accounts after idempotent reseed');

-- New org gets chart via trigger
insert into public.organizations(id,name) values ('a1000000-0000-0000-0000-0000000000c1','A1 Org C');
select is((select count(*)::int from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000c1'),22,'new org C gets 22 accounts via trigger');

-- list_chart_of_accounts capability-gated
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.list_chart_of_accounts('a1000000-0000-0000-0000-0000000000a1')$$,'list_chart_of_accounts callable by OWNER');
select is((select count(*)::int from public.list_chart_of_accounts('a1000000-0000-0000-0000-0000000000a1')),22,'list returns 22 accounts');
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select * from public.list_chart_of_accounts('a1000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot list chart');
reset role;

-- Check that deferred trigger also enforces min 2 lines at DB level (direct insert via postgres bypassing internal_post_journal but still hitting trigger)
-- Insert a header then single line and expect deferred failure at commit
-- We test via a transaction block that should fail
-- Note: we need to test the CONSTRAINT TRIGGER defers to commit, so we do it in a nested transaction
select throws_ok($$
  do $$
  declare
    v_entry_id uuid;
  begin
    insert into public.journal_entries(organization_id,entry_number,entry_date,event_at,source_type,idempotency_key,fingerprint,created_by)
    values('a1000000-0000-0000-0000-0000000000a1','JE-TEST-MIN','2026-03-01','2026-03-01 10:00:00+04','ADJUSTMENT','a2000000-0000-0000-0000-000000000099',repeat('a',64),'a1000000-0000-0000-0000-000000000001')
    returning id into v_entry_id;
    insert into public.journal_lines(organization_id,entry_id,account_id,debit,credit)
    values('a1000000-0000-0000-0000-0000000000a1',v_entry_id,(select id from public.chart_of_accounts where organization_id='a1000000-0000-0000-0000-0000000000a1' and code='1000'),100.000,0);
    -- commit will trigger deferred check for min lines
  end $$;
$$,'23514','JOURNAL_MIN_LINES','deferred trigger enforces min 2 lines on direct insert');

-- Check trial balance: sum debits = sum credits across org
select is((select sum(debit)::text from public.journal_lines where organization_id='a1000000-0000-0000-0000-0000000000a1'),'2000.000','trial balance debits total 2000 (1000 opening + 500 payment + 500 reversal)');
select is((select sum(credit)::text from public.journal_lines where organization_id='a1000000-0000-0000-0000-0000000000a1'),'2000.000','trial balance credits total 2000');

select * from finish();
rollback;
