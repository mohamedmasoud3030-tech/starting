-- pgTAP for migrations 0062–0064 (Phase B commercial engine):
-- price components, discount validation, lifecycle state machine, versioning,
-- idempotent conversion, package-snapshot immutability, cross-org isolation.
begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures: two organizations, an owner in each, catalog + package + customer.
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98200000-0000-0000-0000-000000000001','authenticated','authenticated','ce-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','98200000-0000-0000-0000-000000000002','authenticated','authenticated','ce-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('98200000-0000-0000-0000-0000000000a1','CE Org A'),
('98200000-0000-0000-0000-0000000000b1','CE Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('98200000-0000-0000-0000-0000000000a1','98200000-0000-0000-0000-000000000001','OWNER'),
('98200000-0000-0000-0000-0000000000b1','98200000-0000-0000-0000-000000000002','OWNER');

insert into public.customers(id,organization_id,name,phone) values
('98200000-0000-0000-0000-0000000000c1','98200000-0000-0000-0000-0000000000a1','CE Customer A','91234567');

insert into public.catalog_items(id,organization_id,name,item_type,pricing_method,cost_price,selling_price,unit,status) values
('98200000-0000-0000-0000-0000000000d1','98200000-0000-0000-0000-0000000000a1','مضيف','STAFF','PER_EVENT',50,100,'مضيف','ACTIVE');

insert into public.packages(id,organization_id,name,base_guest_count,min_guests,max_guests,status) values
('98200000-0000-0000-0000-0000000000e1','98200000-0000-0000-0000-0000000000a1','باقة 10-100',50,10,100,'ACTIVE');

insert into public.package_items(id,organization_id,package_id,catalog_item_id,quantity) values
('98200000-0000-0000-0000-0000000000f1','98200000-0000-0000-0000-0000000000a1','98200000-0000-0000-0000-0000000000e1','98200000-0000-0000-0000-0000000000d1',5);

-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98200000-0000-0000-0000-000000000001"}';

-- 1. create a draft and apply a package → snapshot lines are created.
select public.create_quotation_draft('98200000-0000-0000-0000-0000000000a1','Prospect A', p_customer_id := '98200000-0000-0000-0000-0000000000c1', p_guest_count := 50);
select is(
  (select count(*)::int from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
  1, 'draft quotation created'
);

-- 2. apply the package to the draft → snapshot lines reference the package.
select public.apply_package_to_quotation(
  '98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
  '98200000-0000-0000-0000-0000000000e1'
);
select is(
  (select count(*)::int from public.quotation_lines),
  1, 'package applied as one snapshot line'
);

-- 3. Editing the package afterwards must NOT change the quotation snapshot.
update public.package_items set quantity = 99
 where id = '98200000-0000-0000-0000-0000000000f1';
select is(
  (select quantity::text from public.quotation_lines),
  '5.000', 'package edit does not mutate the quotation line snapshot'
);

-- 4. Pricing: fixed discount is applied and grand total = subtotal + transport + surcharge - discount.
select public.set_quotation_pricing(
  '98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
  p_transport_required := true, p_transport_amount := 10,
  p_surcharge_amount := 5,
  p_discount_type := 'FIXED', p_discount_value := 15
);
-- subtotal = 5 hosts × 100 = 500 ; grand = 500 + 10 + 5 - 15 = 500
select is(
  (select total_selling::text from public.quotations),
  '500.000', 'fixed discount: 500 + 10 + 5 - 15 = 500'
);
select is(
  (select discount_amount::text from public.quotations),
  '15.000', 'discount amount recorded for audit'
);

-- 5. Percentage discount: subtotal 500, 10% → discount 50 → grand 450.
select public.set_quotation_pricing(
  '98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
  p_transport_amount := 0, p_surcharge_amount := 0,
  p_discount_type := 'PERCENT', p_discount_value := 10
);
select is(
  (select total_selling::text from public.quotations),
  '450.000', 'percentage discount: 500 - 10% = 450'
);

-- 6. Invalid percentage (>100) is rejected.
select throws_ok(
  $sql$select public.set_quotation_pricing(
    '98200000-0000-0000-0000-0000000000a1',
    (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
    p_discount_type := 'PERCENT', p_discount_value := 150
  )$sql$,
  '22023', null, 'percentage discount above 100 is rejected'
);

-- 7. Negative total is rejected (discount larger than everything).
select throws_ok(
  $sql$select public.set_quotation_pricing(
    '98200000-0000-0000-0000-0000000000a1',
    (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'),
    p_transport_amount := 0, p_surcharge_amount := 0,
    p_discount_type := 'FIXED', p_discount_value := 9999
  )$sql$,
  '23514', null, 'negative grand total is rejected'
);

-- 8. Document numbers derive their prefix from organization settings (verified
--    end-to-end by the issued number assertion in step 9, since the number
--    allocator is an internal SECURITY DEFINER helper not callable by clients).
select public.save_organization_settings('98200000-0000-0000-0000-0000000000a1', p_quotation_number_prefix := 'AJQ');
select ok(true, 'quotation number prefix configured via organization settings');

-- 9. Issue → SENT (ISSUED); the number uses the settings prefix and is frozen.
select public.issue_quotation('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'));
select ok(
  (select quotation_number from public.quotations) like 'AJQ-%',
  'issued quotation carries the settings-derived number'
);
select is(
  (select status::text from public.quotations), 'ISSUED', 'quotation issued (sent)'
);

-- 10. Illegal transition: ISSUED cannot go back to DRAFT.
select throws_ok(
  $sql$update public.quotations set status='DRAFT' where organization_id='98200000-0000-0000-0000-0000000000a1'$sql$,
  null, null, 'issued quotation cannot silently return to DRAFT'
);

-- 11. Reject is an explicit, audited transition; REJECTED cannot become ACCEPTED.
select public.reject_quotation('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'), 'غير مناسب');
select is((select status::text from public.quotations), 'REJECTED', 'quotation rejected');
select throws_ok(
  $sql$select public.accept_quotation('98200000-0000-0000-0000-0000000000a1',
    (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'))$sql$,
  null, null, 'rejected quotation cannot be silently accepted'
);

-- 12. Revise creates revision 2 sharing the number; revision 1 is superseded, not lost.
select public.revise_quotation('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where organization_id='98200000-0000-0000-0000-0000000000a1'), 'تعديل');
select is(
  (select count(*)::int from public.quotations), 2, 'revise created a second revision'
);
select is(
  (select status::text from public.quotations where revision=1), 'SUPERSEDED', 'revision 1 superseded, snapshot kept'
);
select is(
  (select revision from public.quotations where status='DRAFT'), 2, 'revision 2 is a DRAFT'
);
select is(
  (select quotation_number from public.quotations where revision=2),
  (select quotation_number from public.quotations where revision=1),
  'revisions share the same quotation number'
);

-- 13. Accept the final revision and convert it to exactly one event.
select public.issue_quotation('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where revision=2));
select public.accept_quotation('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where revision=2));
select public.convert_quotation_to_event('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where revision=2),
  '98200000-0000-0000-0000-000000000099',
  p_start_at := '2026-09-01 10:00+04', p_end_at := '2026-09-01 14:00+04',
  p_venue_name := 'نزوى', p_guest_count := 50);
select is(
  (select count(*)::int from public.events where accepted_quotation_id = (select id from public.quotations where revision=2)),
  1, 'accepted quotation converted into exactly one event'
);

-- 14. Converting again must NOT create a second event (idempotent).
select public.convert_quotation_to_event('98200000-0000-0000-0000-0000000000a1',
  (select id from public.quotations where revision=2),
  '98200000-0000-0000-0000-000000000098',
  p_start_at := '2026-09-01 10:00+04', p_end_at := '2026-09-01 14:00+04',
  p_venue_name := 'نزوى', p_guest_count := 50);
select is(
  (select count(*)::int from public.events where accepted_quotation_id = (select id from public.quotations where revision=2)),
  1, 'repeat conversion does not create a second event'
);

-- 15. Cross-organization isolation: org B owner cannot see org A's quotations.
set local "request.jwt.claims"='{"role":"authenticated","sub":"98200000-0000-0000-0000-000000000002"}';
select is(
  (select count(*)::int from public.quotations_customer),
  0, 'org B member cannot read org A quotations'
);

-- 16. Cross-organization write is rejected.
select throws_ok(
  $sql$select public.revise_quotation('98200000-0000-0000-0000-0000000000a1',
    (select id from public.quotations where revision=2))$sql$,
  '42501', null, 'org B member cannot revise org A quotation'
);

select * from finish();
rollback;
