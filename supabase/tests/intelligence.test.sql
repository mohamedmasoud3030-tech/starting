-- pgTAP for migrations 0070-0072 (Phase E intelligence layer):
-- alerts, metrics, customer 360, search, integrity, reports.
begin;
select plan(15);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98500000-0000-0000-0000-000000000001','authenticated','authenticated','int-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','98500000-0000-0000-0000-000000000002','authenticated','authenticated','int-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('98500000-0000-0000-0000-0000000000a1','INT Org A'),
('98500000-0000-0000-0000-0000000000b1','INT Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('98500000-0000-0000-0000-0000000000a1','98500000-0000-0000-0000-000000000001','OWNER'),
('98500000-0000-0000-0000-0000000000b1','98500000-0000-0000-0000-000000000002','OWNER');

insert into public.customers(id,organization_id,name,phone) values
('98500000-0000-0000-0000-0000000000c1','98500000-0000-0000-0000-0000000000a1','INT Customer','91234567');

-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98500000-0000-0000-0000-000000000001"}';

-- An accepted quotation converted to a CONFIRMED event (revenue 400), then a payment.
select public.create_quotation_draft('98500000-0000-0000-0000-0000000000a1','INT Prospect', p_customer_id := '98500000-0000-0000-0000-0000000000c1', p_guest_count := 10);
select public.save_quotation_line('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1'),
  null, 'خدمة ضيافة', 'SERVICE', 'مناسبة', 'FIXED', 1, 400, 0, true);
select public.issue_quotation('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1'));
select public.accept_quotation('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1'));
select public.convert_quotation_to_event('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1'),
  '98500000-0000-0000-0000-0000000000e9',
  p_start_at := now() + interval '3 days', p_end_at := now() + interval '3 days 4 hours',
  p_venue_name := 'نزوى', p_guest_count := 10);

-- 1. The event with no staff assigned and no payment triggers a balance alert.
select is(
  (select count(*)::int from public.management_alerts('98500000-0000-0000-0000-0000000000a1')
    where alert_type = 'EVENT_BALANCE_OUTSTANDING'),
  1, 'outstanding balance produces an alert'
);

-- 2. Metrics: revenue 400, collected 0, outstanding 400.
select is(
  (select revenue::text from public.management_metrics('98500000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '30 days')),
  '400.000', 'management metrics report contracted revenue'
);
select is(
  (select outstanding::text from public.management_metrics('98500000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '30 days')),
  '400.000', 'outstanding equals revenue minus zero collected'
);

-- 3. Global search finds the customer by phone.
select is(
  (select count(*)::int from public.global_search('98500000-0000-0000-0000-0000000000a1', '91234567') where entity_type='customer'),
  1, 'global search finds a customer by phone'
);

-- 4. Global search is organization-scoped (org B is rejected).
set local "request.jwt.claims"='{"role":"authenticated","sub":"98500000-0000-0000-0000-000000000002"}';
select throws_ok(
  $sql$select * from public.global_search('98500000-0000-0000-0000-0000000000a1', '91234567')$sql$,
  '42501', null, 'org B cannot search org A records'
);

-- 5. Org B cannot read org A alerts/metrics (membership guard).
select throws_ok(
  $sql$select * from public.management_alerts('98500000-0000-0000-0000-0000000000a1')$sql$,
  '42501', null, 'org B cannot read org A alerts'
);
select throws_ok(
  $sql$select * from public.management_metrics('98500000-0000-0000-0000-0000000000a1', now(), now() + interval '1 day')$sql$,
  '42501', null, 'org B cannot read org A metrics'
);

-- 6. Integrity: an accepted quote not yet converted is NOT flagged (normal business).
set local "request.jwt.claims"='{"role":"authenticated","sub":"98500000-0000-0000-0000-000000000001"}';
select public.create_quotation_draft('98500000-0000-0000-0000-0000000000a1','Second Prospect', p_guest_count := 5);
select public.save_quotation_line('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1' and customer_name_snapshot='Second Prospect'),
  null, 'خدمة', 'SERVICE', 'مناسبة', 'FIXED', 1, 100, 0, true);
select public.issue_quotation('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1' and customer_name_snapshot='Second Prospect'));
select public.accept_quotation('98500000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98500000-0000-0000-0000-0000000000a1' and customer_name_snapshot='Second Prospect'));

-- An ACCEPTED (not converted) quote → alert, not integrity finding.
select is(
  (select count(*)::int from public.management_alerts('98500000-0000-0000-0000-0000000000a1') where alert_type='ACCEPTED_QUOTE_NOT_CONVERTED'),
  1, 'accepted-not-converted quote is an alert'
);

-- 7. Integrity center has no cross-org leakage and returns the expected finding set.
select is(
  (select count(*)::int from public.integrity_findings('98500000-0000-0000-0000-0000000000a1')),
  0, 'no integrity findings for a clean dataset'
);

-- 8. Customer 360 aggregates for the single customer.
select is(
  (select events_count::text from public.customer_360('98500000-0000-0000-0000-0000000000a1') where name='INT Customer'),
  '1', 'customer 360 counts the converted event'
);
select is(
  (select total_commercial_value::text from public.customer_360('98500000-0000-0000-0000-0000000000a1') where name='INT Customer'),
  '400.000', 'customer 360 sums commercial value'
);

-- 9. Reports: revenue by event reflects the accepted quotation.
select is(
  (select revenue::text from public.report_events('98500000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '30 days')),
  '400.000', 'report_events returns contracted revenue'
);

-- 10. Package report is empty without packages (no crash, zero rows).
select is(
  (select count(*)::int from public.report_packages('98500000-0000-0000-0000-0000000000a1')),
  0, 'report_packages is empty when no packages exist'
);

-- 11. A second event for the same customer produces a repeat-customer history.
select public.create_event('98500000-0000-0000-0000-0000000000a1',
  '98500000-0000-0000-0000-0000000000c1', 'مناسبة ثانية', 'OTHER',
  now() + interval '10 days', now() + interval '10 days 4 hours', 10, 'نزوى',
  null, null, null, null, '98500000-0000-0000-0000-0000000000aa');
select is(
  (select events_count::int from public.customer_360('98500000-0000-0000-0000-0000000000a1') where name='INT Customer'),
  2, 'customer 360 counts both events for the same customer'
);

-- 12. Integrity: multiple events from the same converted quote is detected
--     (negative control — the conversion path prevents duplicates).
select is(
  (select count(*)::int from public.integrity_findings('98500000-0000-0000-0000-0000000000a1') where finding_code='MULTIPLE_EVENTS_FROM_QUOTE'),
  0, 'no duplicate events from one quote in a clean dataset'
);

select * from finish();
rollback;
