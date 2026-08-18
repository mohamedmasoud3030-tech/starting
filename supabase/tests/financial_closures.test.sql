-- pgTAP for migrations 0067-0069 (Phase D): unified expenses, actual
-- profitability, financial-closure lifecycle and the close-time mutation guard.
begin;
select plan(20);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98400000-0000-0000-0000-000000000001','authenticated','authenticated','fc-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','98400000-0000-0000-0000-000000000002','authenticated','authenticated','fc-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('98400000-0000-0000-0000-0000000000a1','FC Org A'),
('98400000-0000-0000-0000-0000000000b1','FC Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('98400000-0000-0000-0000-0000000000a1','98400000-0000-0000-0000-000000000001','OWNER'),
('98400000-0000-0000-0000-0000000000b1','98400000-0000-0000-0000-000000000002','OWNER');

insert into public.customers(id,organization_id,name,phone) values
('98400000-0000-0000-0000-0000000000c1','98400000-0000-0000-0000-0000000000a1','FC Customer','91234567');

-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98400000-0000-0000-0000-000000000001"}';

-- Build an accepted quotation → confirmed event (revenue 400).
select public.create_quotation_draft('98400000-0000-0000-0000-0000000000a1','FC Prospect', p_customer_id := '98400000-0000-0000-0000-0000000000c1', p_guest_count := 10);
select public.save_quotation_line('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),
  null, 'خدمة ضيافة', 'SERVICE', 'مناسبة', 'FIXED', 1, 400, 0, true);
select public.issue_quotation('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'));
select public.accept_quotation('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'));
select public.convert_quotation_to_event('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),
  '98400000-0000-0000-0000-0000000000e9',
  p_start_at := '2026-11-01 10:00+04', p_end_at := '2026-11-01 14:00+04',
  p_venue_name := 'نزوى', p_guest_count := 10);

-- 1. Close while there is still an outstanding balance is rejected with a reason.
select throws_ok(
  $sql$select public.close_event_financially('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'))$sql$,
  '23514', null, 'close with outstanding balance is rejected'
);

-- 2. Settle the outstanding balance.
select public.record_customer_payment('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
  400, 'CASH', null, null, null, '98400000-0000-0000-0000-0000000000f1');
select is(
  (select outstanding_balance::text from public.event_finance_summaries where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
  '0.000', 'outstanding is settled'
);

-- 3. An expense is recorded before close (cost 25 → profit 375).
select public.record_event_expense('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
  'TRANSPORT', 25, '2026-11-01', 'نقل', null, null, null, '98400000-0000-0000-0000-0000000000f2');
select is(
  (select actual_profit::text from public.event_finance_summaries where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
  '375.000', 'profit = revenue - expense (single source, no double count)'
);

-- 4. Negative expense amount is rejected.
select throws_ok(
  $sql$select public.record_event_expense('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
    'OTHER', -5, '2026-11-01', 'x', null, null, null, '98400000-0000-0000-0000-0000000000f3')$sql$,
  null, null, 'negative expense amount is rejected'
);

-- 5. Cross-organization expense write is rejected.
set local "request.jwt.claims"='{"role":"authenticated","sub":"98400000-0000-0000-0000-000000000002"}';
select throws_ok(
  $sql$select public.record_event_expense('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
    'OTHER', 10, '2026-11-01', 'x', null, null, null, '98400000-0000-0000-0000-0000000000f4')$sql$,
  '42501', null, 'cross-organization expense is rejected'
);
set local "request.jwt.claims"='{"role":"authenticated","sub":"98400000-0000-0000-0000-000000000001"}';

-- 6. Close succeeds and captures a snapshot.
select public.close_event_financially('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'), 'إغلاق');
select is(
  (select profit_at_close::text from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is null),
  '375.000', 'snapshot captures profit at close'
);
select is(
  (select count(*)::int from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is null),
  1, 'exactly one active closure exists'
);

-- 7. Double close does not create a second active closure.
select public.close_event_financially('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'));
select is(
  (select count(*)::int from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is null),
  1, 'double close does not create a second active closure'
);

-- 8. Financial mutation after close is rejected (expense).
select throws_ok(
  $sql$select public.record_event_expense('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
    'FUEL', 10, '2026-11-01', 'وقود', null, null, null, '98400000-0000-0000-0000-0000000000f5')$sql$,
  '42501', null, 'expense after close is rejected'
);

-- 9. Financial mutation after close is rejected (voiding the payment).
select throws_ok(
  $sql$select public.void_customer_payment('98400000-0000-0000-0000-0000000000a1',
    (select id from public.customer_payments where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
    'سبب الإلغاء', '98400000-0000-0000-0000-0000000000f6')$sql$,
  '42501', null, 'payment mutation after close is rejected'
);

-- 10. Reopen without a reason is rejected.
select throws_ok(
  $sql$select public.reopen_event_financially('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'), 'x')$sql$,
  '22023', null, 'reopen requires a reason'
);

-- 11. Reopen succeeds and keeps the previous close history.
select public.reopen_event_financially('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'), 'ظهر مصروف نقل إضافي');
select is(
  (select count(*)::int from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
  1, 'reopen keeps the single closure record'
);
select is(
  (select count(*)::int from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is null),
  0, 'no active closure after reopen'
);

-- 12. After reopen, mutation is allowed again.
select public.record_event_expense('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'),
  'TRANSPORT', 20, '2026-11-01', 'نقل إضافي', null, null, null, '98400000-0000-0000-0000-0000000000f7');
select is(
  (select actual_profit::text from public.event_finance_summaries where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
  '355.000', 'after reopen the extra transport lowers profit (400-25-20)'
);

-- 13. Close again → a second, independent closure record with correct history.
select public.close_event_financially('98400000-0000-0000-0000-0000000000a1',
  (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'));
select is(
  (select count(*)::int from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1')),
  2, 'second close creates a second independent record'
);
select is(
  (select profit_at_close::text from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is null),
  '355.000', 'second close captures the updated profit'
);
select is(
  (select profit_at_close::text from public.event_financial_closures where event_id=(select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1') and reopened_at is not null),
  '375.000', 'first close keeps its original snapshot (history not erased)'
);

-- 14. Readiness report is explainable (all checks pass when settled).
select is(
  (select count(*)::int from public.event_financial_readiness('98400000-0000-0000-0000-0000000000a1',
    (select id from public.events where organization_id='98400000-0000-0000-0000-0000000000a1'))
    where ok),
  3, 'readiness report returns three passing checks when settled'
);

-- 15. Audit trail records close and reopen.
select ok(
  (select count(*)::int from public.audit_events where organization_id='98400000-0000-0000-0000-0000000000a1' and action='EVENT_FINANCIALLY_CLOSED') >= 1,
  'close writes an audit event'
);
select ok(
  (select count(*)::int from public.audit_events where organization_id='98400000-0000-0000-0000-0000000000a1' and action='EVENT_FINANCIALLY_REOPENED') >= 1,
  'reopen writes an audit event'
);

select * from finish();
rollback;
