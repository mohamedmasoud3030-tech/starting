-- ============================================================================
-- 0077 — Optional VAT: authoritative snapshots through the quotation/invoice
-- lifecycle, historical immutability, OMR 3-decimal rounding.
-- ============================================================================
begin;
select plan(21);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98400000-0000-0000-0000-000000000001','authenticated','authenticated','vat-a-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98400000-0000-0000-0000-000000000002','authenticated','authenticated','vat-b-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('98400000-0000-0000-0000-0000000000a1','VAT-disabled Org'),
('98400000-0000-0000-0000-0000000000b1','VAT-enabled Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('98400000-0000-0000-0000-0000000000a1','98400000-0000-0000-0000-000000000001','OWNER'),
('98400000-0000-0000-0000-0000000000b1','98400000-0000-0000-0000-000000000002','OWNER');

-- ---------------------------------------------------------------------------
-- VAT-disabled organization: totals unchanged.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"98400000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.create_quotation_draft('98400000-0000-0000-0000-0000000000a1','Prospect A', p_customer_id := null);
select public.save_quotation_line('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),
  null, 'خدمة', 'SERVICE', 'مناسبة', 'FIXED', 1, 100, 0, true);
select public.issue_quotation('98400000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'));

select is((select vat_registered from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),false,'VAT-disabled org snapshots vat_registered=false');
select is((select vat_amount::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),'0.000','VAT-disabled org snapshots zero VAT amount');
select is((select total_selling::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),'100.000','VAT-disabled final total is the pre-VAT total');
select is((select pre_vat_total::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000a1'),'100.000','pre-VAT total is the line total');

-- ---------------------------------------------------------------------------
-- VAT-enabled organization (5%): authoritative snapshot at issue.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"98400000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.save_organization_settings('98400000-0000-0000-0000-0000000000b1',
  p_vat_registered := true, p_vat_percent := 5.000, p_vat_registration_number := 'OM-VAT-1');

select public.create_quotation_draft('98400000-0000-0000-0000-0000000000b1','Prospect B', p_customer_id := null);
select public.save_quotation_line('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),
  null, 'خدمة', 'SERVICE', 'مناسبة', 'FIXED', 1, 100, 0, true);
select public.set_quotation_pricing('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),
  p_transport_required := true, p_transport_amount := 10);
select public.issue_quotation('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'));

select is((select vat_registered from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),true,'VAT-enabled org snapshots vat_registered=true');
select is((select vat_percent::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),'5.000','5% percent is snapshotted');
select is((select pre_vat_total::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),'110.000','pre-VAT total = 100 + 10 transport');
select is((select vat_amount::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),'5.500','5% of 110 = 5.500 VAT');
select is((select total_selling::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),'115.500','final total = 110 + 5.500');
select is((select vat_registration_number from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1'),'OM-VAT-1','registration number is snapshotted');

-- OMR 3-decimal rounding: 5% of 33.333 = 1.66665 -> 1.667.
select public.create_quotation_draft('98400000-0000-0000-0000-0000000000b1','Prospect C', p_customer_id := null);
select public.save_quotation_line('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect C'),
  null, 'خدمة', 'SERVICE', 'مناسبة', 'FIXED', 1, 33.333, 0, true);
select public.issue_quotation('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect C'));
select is((select vat_amount::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect C'),'1.667','VAT rounds half-away-from-zero to 3 decimals');
select is((select total_selling::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect C'),'35.000','rounded final total is exact');

-- Historical snapshot unchanged after settings change.
select public.save_organization_settings('98400000-0000-0000-0000-0000000000b1',
  p_vat_percent := 7.500, p_vat_registration_number := 'OM-VAT-2');
select is((select vat_percent::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B'),'5.000','issued quote keeps its 5% snapshot after settings change');
select is((select total_selling::text from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B'),'115.500','issued quote total unchanged after settings change');

-- ---------------------------------------------------------------------------
-- Invoice reconciles with the accepted quotation's VAT snapshot.
-- ---------------------------------------------------------------------------
select public.accept_quotation('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B'));
select public.convert_quotation_to_event('98400000-0000-0000-0000-0000000000b1',
  (select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B'),
  '98400000-0000-0000-0000-0000000000b9',
  p_start_at := '2026-11-01 10:00+04', p_end_at := '2026-11-01 14:00+04',
  p_venue_name := 'نزوى', p_guest_count := 10);

select throws_ok($sql$
  select public.create_event_invoice('98400000-0000-0000-0000-0000000000b1',
    (select id from public.events where accepted_quotation_id=(select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B')),
    'INV-BAD', null, 100.000,
    '[{"seq":0,"kind":"DEPOSIT","due_date":"2026-11-01","amount":50.000},{"seq":1,"kind":"FINAL","due_date":"2026-12-01","amount":50.000}]'::jsonb,
    null, '98400000-0000-0000-0000-0000000000c1')
$sql$,'23514','INVOICE_TOTAL_MISMATCH','invoice must equal the VAT-inclusive accepted total');

select lives_ok($sql$
  select public.create_event_invoice('98400000-0000-0000-0000-0000000000b1',
    (select id from public.events where accepted_quotation_id=(select id from public.quotations where organization_id='98400000-0000-0000-0000-0000000000b1' and customer_name_snapshot='Prospect B')),
    'INV-B1', null, 115.500,
    '[{"seq":0,"kind":"DEPOSIT","due_date":"2026-11-01","amount":50.000},{"seq":1,"kind":"FINAL","due_date":"2026-12-01","amount":65.500}]'::jsonb,
    null, '98400000-0000-0000-0000-0000000000c2')
$sql$,'invoice is issued at the VAT-inclusive total');

select is((select total_amount::text from public.invoice_summaries where invoice_number='INV-B1'),'115.500','invoice total is the VAT-inclusive final total');
select is((select vat_amount::text from public.invoice_summaries where invoice_number='INV-B1'),'5.500','invoice snapshots the quotation VAT amount');
select is((select pre_vat_total::text from public.invoice_summaries where invoice_number='INV-B1'),'110.000','invoice snapshots the pre-VAT total');
select is((select vat_percent::text from public.invoice_summaries where invoice_number='INV-B1'),'5.000','invoice snapshots the quotation VAT percent');
select is((select remaining_balance::text from public.invoice_summaries where invoice_number='INV-B1'),'115.500','invoice remaining balance reconciles to the VAT-inclusive total');

select finish();
rollback;
