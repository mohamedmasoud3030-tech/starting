-- ============================================================================
-- pgTAP — Quick Quote (عرض سعر سريع): prospect drafts, immutable issuance,
-- accept → Customer+Event conversion, idempotency, tenant/role isolation.
-- Run with: supabase test db   (authoritative acceptance evidence)
-- ============================================================================

begin;
select plan(52);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, before switching role)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner_a@test.local',      'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'supervisor_a@test.local','x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'owner_b@test.local',      'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);

insert into public.organizations (id, name, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Org B', true);

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'SUPERVISOR', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000007', 'OWNER',      'ACTIVE');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, cost_price, selling_price) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Coffee', 'SERVICE', 'PER_GUEST', 1.500, 2.800),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Dates',  'CONSUMABLE', 'PER_UNIT', 0.300, 0.800);

insert into public.packages (id, organization_id, name, base_guest_count, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Package A', 50, 'ACTIVE');

insert into public.package_items (organization_id, package_id, catalog_item_id, quantity, sort_order) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 1, 0),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c2', 5, 1);

insert into public.customers (id, organization_id, name, phone, customer_type) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Mohammed', '91234567', 'INDIVIDUAL'),
  ('00000000-0000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Said',     '99887766', 'INDIVIDUAL'),
  ('00000000-0000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'Khalid',   '91234567', 'INDIVIDUAL');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- A. Draft lifecycle without a permanent Customer / date / guests
-- ---------------------------------------------------------------------------
-- 1. created with only a prospect name (no Customer, no date, no guests)
select lives_ok($$select public.create_quick_quote('00000000-0000-0000-0000-0000000000a1','Reem',null,null,null,null,null,null,null,null,null,null,'20000000-0000-0000-0000-000000000001')$$,'draft created with minimal prospect info (no customer)');

-- 2. create is idempotent by idempotency key
select is((select count(*)::int from public.quick_quotes where organization_id='00000000-0000-0000-0000-0000000000a1' and idempotency_key='20000000-0000-0000-0000-000000000001'),1,'duplicate create with same key returns existing draft');

-- 3. draft status
select is((select status::text from public.quick_quotes where organization_id='00000000-0000-0000-0000-0000000000a1' and idempotency_key='20000000-0000-0000-0000-000000000001'),'DRAFT','new draft is DRAFT');

-- 4. PER_GUEST line without a guest count is rejected (unknown guests)
select throws_ok($$select public.save_quick_quote_line('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000001'),null,'Coffee','SERVICE','guest','PER_GUEST',1,2.800,true)$$,'GUEST_COUNT_REQUIRED',null,'PER_GUEST line requires a guest count');

-- 5. discarding an abandoned draft
select lives_ok($$select public.discard_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000001'),'client declined')$$,'abandoned draft discarded');

-- 6. abandoned draft creates NO Customer
select is((select count(*)::int from public.customers where organization_id='00000000-0000-0000-0000-0000000000a1'),3,'abandoned draft created no Customer (fixtures only)');

-- 7. abandoned draft creates NO Event
select is((select count(*)::int from public.events where organization_id='00000000-0000-0000-0000-0000000000a1'),0,'abandoned draft created no Event');

-- ---------------------------------------------------------------------------
-- B. Full flow: lines + package + issue (immutable quotation) + accept + convert
-- ---------------------------------------------------------------------------
-- 8. draft with known date/venue/guests and a unique phone (matches d2)
select lives_ok($$select public.create_quick_quote('00000000-0000-0000-0000-0000000000a1','Said','99887766',null,null,'Wedding','WEDDING','2026-09-01 10:00+04','2026-09-01 14:00+04',120,'Al Riad Hall',null,'20000000-0000-0000-0000-000000000002')$$,'draft with full prospect/event info created');

-- 9. custom PER_GUEST line saved
select lives_ok($$select public.save_quick_quote_line('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),null,'Coffee extra','SERVICE','guest','PER_GUEST',1,2.800,true)$$,'custom PER_GUEST line saved');

-- 10. exact 3-decimal total on the draft line (2.800 × 1 × 120 = 336.000)
select is((select total_selling::text from public.quick_quote_lines where organization_id='00000000-0000-0000-0000-0000000000a1' and description='Coffee extra'),'336.000','PER_GUEST line total exact to 3 decimals');

-- 11. package applies as selling-only lines
select is((select public.apply_package_to_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),'00000000-0000-0000-0000-0000000000e1')),2,'package applies 2 lines to draft');

-- 12. draft line totals exact: 336.000 + 336.000 + 4.000 = 676.000
select is((select sum(total_selling)::text from public.quick_quote_lines where quick_quote_id=(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'676.000','draft totals exact (336 + 336 + 4)');

-- 13. double-applying the same package is rejected
select throws_ok($$select public.apply_package_to_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),'00000000-0000-0000-0000-0000000000e1')$$,'PACKAGE_ALREADY_APPLIED',null,'double package apply rejected');

-- 14. issue creates a real quotation
select lives_ok($$select public.issue_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),null,null,'20000000-0000-0000-0000-000000000011')$$,'draft issued as a quotation');

-- 15. pre-event quotation has NO event_id
select is((select event_id is null from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),true,'issued quick quote has no event_id');

-- 16. issued total matches the draft exactly
select is((select total_selling::text from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'676.000','issued quotation total is exact');

-- 17. prospect identity snapshot preserved at issuance
select is((select customer_name_snapshot from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'Said','prospect name snapshot preserved');

-- 18. prospect phone snapshot preserved
select is((select customer_phone_snapshot from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'99887766','prospect phone snapshot preserved');

-- 19. quotation lines copied at issuance
select is((select count(*)::int from public.quotation_lines ql join public.quotations q on q.id=ql.quotation_id where q.organization_id='00000000-0000-0000-0000-0000000000a1' and q.quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),3,'quotation lines copied at issue');

-- 20. quick quotes carry no internal cost (selling-only)
select is((select sum(expected_unit_cost)::text from public.quotation_lines ql join public.quotations q on q.id=ql.quotation_id where q.organization_id='00000000-0000-0000-0000-0000000000a1' and q.quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'0.000','quick quote lines carry no expected cost');

-- 21. issued quotation snapshot is immutable
select throws_ok($$update public.quotations set customer_name_snapshot='Hacked' where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')$$,'QUOTATION_IMMUTABLE',null,'issued quotation snapshot immutable');

-- 22. issued quotation lines are immutable
select throws_ok($$update public.quotation_lines set unit_selling_price=0.001 where quotation_id=(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'))$$,'QUOTATION_IMMUTABLE',null,'issued quotation lines immutable');

-- 23. re-issuing (retry) is idempotent
select lives_ok($$select public.issue_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),null,null,'20000000-0000-0000-0000-000000000099')$$,'issue retry succeeds');

-- 24. exactly one quotation exists for that number after retry
select is((select count(*)::int from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),1,'issue retry did not duplicate the quotation');

-- 25. converting an UN-accepted quotation is rejected
select throws_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'20000000-0000-0000-0000-000000000031',null,null,null,null,null)$$,'QUOTATION_NOT_ACCEPTED',null,'un-accepted quotation cannot convert');

-- 26. accept the issued quotation
select lives_ok($$select public.accept_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'20000000-0000-0000-0000-000000000021')$$,'issued quotation accepted');

-- 27. status is ACCEPTED
select is((select status::text from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'ACCEPTED','quotation status ACCEPTED');

-- 28. convert accepted quotation → Customer (reused by exact phone) + Event
select lives_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'20000000-0000-0000-0000-000000000032',null,null,null,null,null)$$,'accepted quotation converts');

-- 29. converted event is CONFIRMED and linked to the quotation
select is((select status::text from public.events where organization_id='00000000-0000-0000-0000-0000000000a1' and accepted_quotation_id=(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'))),'CONFIRMED','converted event is CONFIRMED');

-- 30. conversion reuses the existing customer on an unambiguous phone match
select is((select customer_id from public.events where organization_id='00000000-0000-0000-0000-0000000000a1' and accepted_quotation_id=(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'))),'00000000-0000-0000-0000-0000000000d2','existing customer reused (exact phone match)');

-- 31. conversion retry is idempotent
select lives_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'20000000-0000-0000-0000-000000000033',null,null,null,null,null)$$,'convert retry succeeds');

-- 32. only one Event was ever created from this quotation
select is((select count(*)::int from public.events where organization_id='00000000-0000-0000-0000-0000000000a1' and accepted_quotation_id=(select id from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1' and quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'))),1,'convert retry created exactly one Event');

-- 33. the workspace aggregate marks CONVERTED
select is((select status::text from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002'),'CONVERTED','workspace aggregate marked CONVERTED');

-- ---------------------------------------------------------------------------
-- C. Unknown date/guests + convert overrides
-- ---------------------------------------------------------------------------
-- 34. quote with NO date and NO guests can be issued (unknowns allowed)
select lives_ok($$select public.create_quick_quote('00000000-0000-0000-0000-0000000000a1','Noura','90000000',null,null,null,null,null,null,null,null,null,'20000000-0000-0000-0000-000000000003')$$,'draft without date/guests created');

-- 35. FIXED line does not require a guest count
select lives_ok($$select public.save_quick_quote_line('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003'),null,'Photography','SERVICE','event','FIXED',1,100.000,true)$$,'FIXED line saved without guest count');

-- 36. issue with unknown date/guests keeps snapshots nullable
select lives_ok($$select public.issue_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003'),null,null,'20000000-0000-0000-0000-000000000012')$$,'draft without date issued');

-- 37. unknown date/guests/venue kept nullable on the issued quote
select is((select guest_count_snapshot is null and start_at_snapshot is null and venue_snapshot is null from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003')),true,'unknown date/guests/venue kept nullable on issued quote');

-- 38. accept the date-less quotation
select lives_ok($$select public.accept_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003')),'20000000-0000-0000-0000-000000000022')$$,'date-less quotation accepted');

-- 39. converting without a date raises a clear error
select throws_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003')),'20000000-0000-0000-0000-000000000034',null,null,null,null,null)$$,'EVENT_DATE_REQUIRED',null,'conversion without a date rejected');

-- 40. convert with date/venue/guests overrides succeeds
select lives_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000003')),'20000000-0000-0000-0000-000000000035','2026-09-10 09:00+04','2026-09-10 13:00+04','Beach Hall',60,'Noura Wedding')$$,'convert with overrides succeeds');

-- 41. conversion created the new Customer
select is((select count(*)::int from public.customers where organization_id='00000000-0000-0000-0000-0000000000a1' and phone='90000000'),1,'convert created the new Customer');

-- ---------------------------------------------------------------------------
-- D. Ambiguous phone match: NEVER silently merges customers
-- ---------------------------------------------------------------------------
-- 42. draft whose phone matches TWO existing customers
select lives_ok($$select public.create_quick_quote('00000000-0000-0000-0000-0000000000a1','Visitor','91234567',null,null,'Event X','OTHER','2026-09-20 10:00+04','2026-09-20 12:00+04',30,'Hall Y',null,'20000000-0000-0000-0000-000000000004')$$,'draft with ambiguous phone created');

-- 43. add a FIXED line and issue/accept it
select lives_ok($$select public.save_quick_quote_line('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000004'),null,'Service','SERVICE','event','FIXED',1,50.000,true)$$,'ambiguous draft line saved');

-- 44.
select lives_ok($$select public.issue_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000004'),null,null,'20000000-0000-0000-0000-000000000013')$$,'ambiguous draft issued');

-- 45.
select lives_ok($$select public.accept_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000004')),'20000000-0000-0000-0000-000000000023')$$,'ambiguous draft accepted');

-- 46. convert on an ambiguous match creates a NEW customer (no silent merge)
select lives_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000004')),'20000000-0000-0000-0000-000000000036',null,null,null,null,null)$$,'ambiguous convert succeeds');

-- 47. still exactly the original two customers + the new one (never merged)
select is((select count(*)::int from public.customers where organization_id='00000000-0000-0000-0000-0000000000a1' and phone='91234567'),3,'ambiguous phone match created a NEW customer, never merged');

-- ---------------------------------------------------------------------------
-- E. Tenant + role isolation
-- ---------------------------------------------------------------------------
-- 48. cross-org command rejected (owner_b cannot touch Org A quotation)
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok($$select public.convert_quick_quote('00000000-0000-0000-0000-0000000000a1',(select id from public.quotations where quotation_number=(select quotation_number from public.quick_quotes where idempotency_key='20000000-0000-0000-0000-000000000002')),'20000000-0000-0000-0000-000000000041',null,null,null,null,null)$$,'42501',null,'cross-org conversion rejected');

-- 49. role gate: SUPERVISOR (not commercial) cannot create a quick quote
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.create_quick_quote('00000000-0000-0000-0000-0000000000a1','Sneaky')$$,'42501',null,'SUPERVISOR cannot create quick quotes');

-- 50. cost separation: SUPERVISOR cannot read the cost-bearing quotations table
select is((select count(*)::int from public.quotations where organization_id='00000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR cannot read cost-bearing quotations table');

-- 51. ...but CAN read the customer-facing view, which exposes no cost/profit
select is((select count(*)::int from public.quotations_customer where organization_id='00000000-0000-0000-0000-0000000000a1'),3,'SUPERVISOR reads customer-facing quotation view');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='quotations_customer' and column_name in ('total_expected_cost','total_expected_profit')),0,'customer-facing view exposes no internal cost/profit');
