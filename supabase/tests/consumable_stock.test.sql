-- ============================================================================
-- S4B — consumable inventory & Event consumption.
--
-- Authoritative pgTAP coverage: item-type gating, tenant isolation, the role
-- authorization matrix, exact fractional quantities, both balance invariants
-- (warehouse on-hand >= 0, Event custody >= 0), warehouse/Event waste,
-- controlled adjustments, low stock, idempotency, audit, cancellation
-- interaction and final Event consumable reconciliation.
-- ============================================================================
begin;
select plan(94);

-- ---------------------------------------------------------------------------
-- Fixture: org A (OWNER, MANAGER, SUPERVISOR, WAREHOUSE, ACCOUNTANT) + org B.
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000001','authenticated','authenticated','s4b-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000002','authenticated','authenticated','s4b-warehouse-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000003','authenticated','authenticated','s4b-accountant-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000004','authenticated','authenticated','s4b-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000005','authenticated','authenticated','s4b-supervisor-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000006','authenticated','authenticated','s4b-manager-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('70000000-0000-0000-0000-0000000000a1','S4B Org A'),
('70000000-0000-0000-0000-0000000000b1','S4B Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000001','OWNER'),
('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000002','WAREHOUSE'),
('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000003','ACCOUNTANT'),
('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000005','SUPERVISOR'),
('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000006','MANAGER'),
('70000000-0000-0000-0000-0000000000b1','70000000-0000-0000-0000-000000000004','OWNER');

insert into public.customers(id,organization_id,name) values
('70000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000a1','Customer A'),
('70000000-0000-0000-0000-0000000000c2','70000000-0000-0000-0000-0000000000b1','Customer B');

-- Coffee is CONSUMABLE (kg, fractional); chairs are REUSABLE_EQUIPMENT and
-- must never become consumable stock. cost_price present to prove no leak.
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('70000000-0000-0000-0000-0000000000d1','70000000-0000-0000-0000-0000000000a1','قهوة عربية','CONSUMABLE','كجم','PER_UNIT',3.500,8.000),
('70000000-0000-0000-0000-0000000000d2','70000000-0000-0000-0000-0000000000a1','تمر خلاص','CONSUMABLE','كجم','PER_UNIT',2.000,5.000),
('70000000-0000-0000-0000-0000000000d3','70000000-0000-0000-0000-0000000000a1','Chairs','REUSABLE_EQUIPMENT','piece','PER_UNIT',4.250,9.000),
('70000000-0000-0000-0000-0000000000d4','70000000-0000-0000-0000-0000000000b1','قهوة ب','CONSUMABLE','كجم','PER_UNIT',3.000,7.000),
('70000000-0000-0000-0000-0000000000d5','70000000-0000-0000-0000-0000000000a1','فحم','CONSUMABLE','كرتون','PER_UNIT',1.500,4.000);

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('70000000-0000-0000-0000-000000000f01','70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000c1','EV-S4B-1','Main Event','2026-10-01 10:00+04','2026-10-01 20:00+04',200,'Muscat','PREPARING','71000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001'),
('70000000-0000-0000-0000-000000000f02','70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000c1','EV-S4B-2','Cancel With Custody','2026-11-01 10:00+04','2026-11-01 20:00+04',50,'Muscat','PREPARING','71000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001'),
('70000000-0000-0000-0000-000000000f03','70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000c1','EV-S4B-3','Draft Event','2027-01-01 10:00+04','2027-01-01 20:00+04',50,'Muscat','DRAFT','71000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001'),
('70000000-0000-0000-0000-000000000f04','70000000-0000-0000-0000-0000000000b1','70000000-0000-0000-0000-0000000000c2','EV-S4B-B1','Org B Event','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Salalah','PREPARING','71000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000004');

-- ===========================================================================
-- 1. Stock profile creation: type gating, authorization, tenancy.
-- ===========================================================================
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d1',5.000,true)$$,
  'OWNER can activate stock tracking for a CONSUMABLE item');
select lives_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d2',2.500,true)$$,
  'a second consumable can be tracked');
select lives_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d5',10.000,true)$$,
  'a third consumable can be tracked');

select throws_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d3',1.000,true)$$,
  '23514', 'CATALOG_ITEM_NOT_CONSUMABLE',
  'a REUSABLE_EQUIPMENT item can never be configured as consumable stock');
select throws_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d4',1.000,true)$$,
  '23503', 'CATALOG_ITEM_NOT_FOUND',
  'cross-org catalog reference is rejected');
select throws_ok(
  $$insert into public.consumable_stock_items(organization_id,catalog_item_id,created_by)
    values('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d1','70000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'direct client INSERT into stock profiles is denied');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d1',9.000,true)$$,
  '42501', null, 'WAREHOUSE cannot change stock-control policy');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.save_consumable_stock_item('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000d1',9.000,true)$$,
  '42501', null, 'an org-B OWNER cannot manage org-A stock');
select is((select count(*)::int from public.consumable_stock_summary
            where organization_id='70000000-0000-0000-0000-0000000000a1'),
  0, 'org-B member reads zero org-A stock summary rows (tenant isolation)');

-- ===========================================================================
-- 2. Receipt: positive quantities, exact fractional precision.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      12.500,'PO-FUTURE-1','72000000-0000-0000-0000-000000000001')$$,
  'WAREHOUSE can receive stock (12.500 kg)');
select lives_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.375,null,'72000000-0000-0000-0000-000000000002')$$,
  'exact fractional receipt (0.375 kg) is accepted');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  12.875::numeric, 'warehouse on-hand is the exact cumulative sum (12.875)');

select throws_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0,null,'72000000-0000-0000-0000-000000000003')$$,
  'P0001', 'INVALID_QUANTITY', 'zero receipt quantity is rejected');
select throws_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      -2,null,'72000000-0000-0000-0000-000000000004')$$,
  'P0001', 'INVALID_QUANTITY', 'negative receipt quantity is rejected');
select throws_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.0001,null,'72000000-0000-0000-0000-000000000005')$$,
  'P0001', 'QUANTITY_PRECISION_EXCEEDED',
  'a quantity finer than 3 decimals is rejected, never silently rounded');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000006')$$,
  '42501', null, 'ACCOUNTANT cannot perform physical stock operations');

-- ===========================================================================
-- 3. Issue to Event: custody increases, warehouse decreases, shortage blocked.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      8.250,'LOAD-1','72000000-0000-0000-0000-000000000010')$$,
  'issue 8.250 kg to the Event');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  4.625::numeric, 'issue decreases warehouse on-hand exactly (12.875 - 8.250)');
select is(
  (select outstanding_quantity from public.event_consumable_state('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  8.250::numeric, 'issue increases Event custody exactly');

select throws_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      99.000,null,'72000000-0000-0000-0000-000000000011')$$,
  'P0001', 'CONSUMABLE_STOCK_SHORTAGE',
  'issuing beyond warehouse on-hand is rejected transactionally');
select throws_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f03',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000012')$$,
  'P0001', 'EVENT_NOT_ISSUABLE', 'a DRAFT Event cannot receive consumable issues');
select throws_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f04',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000013')$$,
  'P0002', 'EVENT_NOT_FOUND', 'a cross-org Event reference is rejected');

-- ===========================================================================
-- 4. Return / consume / waste at the Event: custody accounting.
-- ===========================================================================
select lives_ok(
  $$select public.return_consumable_from_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      2.000,'RET-1','72000000-0000-0000-0000-000000000020')$$,
  'usable return of 2.000 kg');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  6.625::numeric, 'usable return increases warehouse stock (4.625 + 2.000)');

select lives_ok(
  $$select public.consume_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      5.000,null,'72000000-0000-0000-0000-000000000021')$$,
  'actual consumption of 5.000 kg');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  6.625::numeric, 'consumption never touches warehouse stock a second time');

select lives_ok(
  $$select public.waste_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,'انسكب أثناء التقديم','72000000-0000-0000-0000-000000000022')$$,
  'Event waste of 1.000 kg');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  6.625::numeric, 'Event waste never recreates warehouse stock');
select is(
  (select outstanding_quantity from public.event_consumable_state('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  0.250::numeric, 'outstanding = issued - returned - consumed - wasted (0.250)');

-- Over-accounting in every direction is rejected.
select throws_ok(
  $$select public.return_consumable_from_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.5,null,'72000000-0000-0000-0000-000000000023')$$,
  'P0001', 'CONSUMABLE_EXCEEDS_OUTSTANDING', 'over-return beyond custody is rejected');
select throws_ok(
  $$select public.consume_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.5,null,'72000000-0000-0000-0000-000000000024')$$,
  'P0001', 'CONSUMABLE_EXCEEDS_OUTSTANDING', 'over-consumption beyond custody is rejected');
select throws_ok(
  $$select public.waste_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.5,'سبب','72000000-0000-0000-0000-000000000025')$$,
  'P0001', 'CONSUMABLE_EXCEEDS_OUTSTANDING', 'over-waste beyond custody is rejected');
select throws_ok(
  $$select public.return_consumable_from_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      1.000,null,'72000000-0000-0000-0000-000000000026')$$,
  'P0001', 'CONSUMABLE_EXCEEDS_OUTSTANDING',
  'returning an item never issued to the Event is rejected');

-- ===========================================================================
-- 5. Warehouse waste.
-- ===========================================================================
select lives_ok(
  $$select public.waste_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.625,'تلف بسبب الرطوبة','72000000-0000-0000-0000-000000000030')$$,
  'warehouse waste with an explicit reason');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  6.000::numeric, 'warehouse waste decreases stock exactly (6.625 - 0.625)');
select throws_ok(
  $$select public.waste_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,'','72000000-0000-0000-0000-000000000031')$$,
  'P0001', 'WASTE_REASON_REQUIRED', 'warehouse waste without a reason is rejected');
select throws_ok(
  $$select public.waste_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      99.000,'سبب واضح','72000000-0000-0000-0000-000000000032')$$,
  'P0001', 'CONSUMABLE_STOCK_SHORTAGE', 'warehouse waste beyond on-hand is rejected');

-- ===========================================================================
-- 6. Controlled adjustments (OWNER/MANAGER only, reason required, never
--    negative resulting stock).
-- ===========================================================================
select throws_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,'تصحيح جرد','72000000-0000-0000-0000-000000000040')$$,
  '42501', null, 'WAREHOUSE cannot adjust stock');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,'تصحيح جرد','72000000-0000-0000-0000-000000000041')$$,
  '42501', null, 'SUPERVISOR cannot adjust stock');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      20.000,'رصيد افتتاحي بعد الجرد','72000000-0000-0000-0000-000000000042')$$,
  'MANAGER records a positive opening-balance adjustment');
select lives_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      -0.500,'تصحيح جرد فعلي','72000000-0000-0000-0000-000000000043')$$,
  'MANAGER records a negative count correction');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'))),
  19.500::numeric, 'adjustments accumulate exactly (20.000 - 0.500)');

select throws_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      -100.000,'تصحيح','72000000-0000-0000-0000-000000000044')$$,
  'P0001', 'CONSUMABLE_STOCK_SHORTAGE', 'an adjustment can never produce negative stock');
select throws_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      1.000,'','72000000-0000-0000-0000-000000000045')$$,
  'P0001', 'ADJUSTMENT_REASON_REQUIRED', 'an adjustment without a reason is rejected');
select throws_ok(
  $$select public.adjust_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      0,'تصحيح','72000000-0000-0000-0000-000000000046')$$,
  'P0001', 'INVALID_QUANTITY', 'a zero adjustment is rejected');

-- ===========================================================================
-- 7. Low stock (on_hand <= minimum) from the authoritative balance.
-- ===========================================================================
select is(
  (select is_low_stock from public.consumable_stock_summary
    where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
  false, 'coffee (6.000 on hand, min 5.000) is not low stock');
select is(
  (select is_low_stock from public.consumable_stock_summary
    where catalog_item_id='70000000-0000-0000-0000-0000000000d5'),
  true, 'charcoal (0 on hand, min 10.000) reports low stock');
select is(
  (select on_hand_quantity from public.consumable_stock_summary
    where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
  19.500::numeric, 'the stock summary exposes the exact derived balance');

-- The stock summary and event lines expose NO cost columns at all.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public'
      and table_name in ('consumable_stock_summary','event_consumable_lines',
                         'consumable_movements','consumable_stock_items')
      and (column_name like '%cost%' or column_name like '%valuation%' or column_name like '%price%')),
  0, 'no consumable operational surface carries cost/valuation columns');

-- ===========================================================================
-- 8. Idempotency: replay, mismatch, single audit.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      12.500,'PO-FUTURE-1','72000000-0000-0000-0000-000000000001')$$,
  'an identical receipt retry replays the original result');
select is(
  (select count(*)::int from public.consumable_movements
    where organization_id='70000000-0000-0000-0000-0000000000a1'
      and idempotency_key='72000000-0000-0000-0000-000000000001'),
  1, 'the replayed key still maps to exactly one physical movement');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'))),
  6.000::numeric, 'a replay changes no balance');
select throws_ok(
  $$select public.receive_consumable_stock('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      13.000,'PO-FUTURE-1','72000000-0000-0000-0000-000000000001')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
  'the same key with a different payload is hard-rejected');

-- ===========================================================================
-- 9. Direct ledger writes are denied; ledger is append-only.
-- ===========================================================================
select throws_ok(
  $$insert into public.consumable_movements(organization_id,stock_item_id,movement_kind,quantity,actor_id,idempotency_key,request_fingerprint)
    values('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      'RECEIVE',1,'70000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-0000000000ff','x')$$,
  '42501', null, 'a client cannot insert directly into the movement ledger');
select throws_ok(
  $$update public.consumable_movements set quantity=1$$,
  '42501', null, 'the movement ledger cannot be mutated by a client');
select throws_ok(
  $$delete from public.consumable_movements$$,
  '42501', null, 'the movement ledger cannot be deleted by a client');
select throws_ok(
  $$update public.consumable_stock_items set minimum_stock_quantity=0$$,
  '42501', null, 'stock profiles cannot be mutated directly by a client');

-- Default grants stay least-privilege: SELECT only for authenticated.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('consumable_stock_items','consumable_movements','event_consumable_reconciliations')
      and grantee in ('anon','authenticated')
      and privilege_type <> 'SELECT'),
  0, 'anon/authenticated hold no DML grant on any consumable table');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('consumable_stock_items','consumable_movements','event_consumable_reconciliations')
      and grantee = 'anon'),
  0, 'anon holds no grant at all on consumable tables');

-- RLS enabled on all three business tables.
select is(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.consumable_stock_items'::regclass,
                  'public.consumable_movements'::regclass,
                  'public.event_consumable_reconciliations'::regclass)),
  true, 'RLS is enabled on every consumable business table');

-- ===========================================================================
-- 10. Cancellation: custody survives; explicit accounting stays possible.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      4.000,null,'72000000-0000-0000-0000-000000000050')$$,
  'issue 4.000 kg to the Event that will be cancelled');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.cancel_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02','العميل ألغى المناسبة','72000000-0000-0000-0000-000000000051')$$,
  'the Event can be cancelled while consumables are in custody');
select is(
  (select outstanding_quantity from public.event_consumable_state('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'))),
  4.000::numeric, 'cancellation does NOT silently restock issued consumables');
select is(
  (select public.consumable_stock_on_hand('70000000-0000-0000-0000-0000000000a1',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'))),
  15.500::numeric, 'warehouse stock is unchanged by cancellation (19.500 - 4.000)');

-- Post-cancellation, new issues are blocked but accounting movements remain.
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      1.000,null,'72000000-0000-0000-0000-000000000052')$$,
  'P0001', 'EVENT_NOT_ISSUABLE', 'a cancelled Event cannot receive NEW issues');
select lives_ok(
  $$select public.return_consumable_from_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      3.000,null,'72000000-0000-0000-0000-000000000053')$$,
  'usable stock can still be returned after cancellation');
select lives_ok(
  $$select public.waste_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'),
      1.000,'فسد أثناء النقل','72000000-0000-0000-0000-000000000054')$$,
  'waste can still be recorded after cancellation');
select is(
  (select outstanding_quantity from public.event_consumable_state('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f02',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d2'))),
  0::numeric, 'the cancelled Event reaches zero custody through explicit accounting');

-- ===========================================================================
-- 11. Final Event consumable reconciliation.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',null,'72000000-0000-0000-0000-000000000060')$$,
  '42501', null, 'WAREHOUSE cannot finalize the consumable reconciliation');

set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',null,'72000000-0000-0000-0000-000000000061')$$,
  'P0001', 'CONSUMABLE_OUTSTANDING_QUANTITY',
  'reconciliation is rejected while custody is unexplained (0.250 outstanding)');

-- Explain the remaining 0.250 kg, then close.
select lives_ok(
  $$select public.consume_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      0.250,null,'72000000-0000-0000-0000-000000000062')$$,
  'the final 0.250 kg is consumed');
select lives_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01','التسوية النهائية','72000000-0000-0000-0000-000000000063')$$,
  'reconciliation succeeds once issued = returned + consumed + waste');
select is(
  (select total_issued_quantity from public.event_consumable_reconciliations
    where event_id='70000000-0000-0000-0000-000000000f01'),
  8.250::numeric, 'the reconciliation freezes the exact issued total');
select is(
  (select total_returned_quantity + total_consumed_quantity + total_wasted_quantity
     from public.event_consumable_reconciliations
    where event_id='70000000-0000-0000-0000-000000000f01'),
  8.250::numeric, 'the frozen totals satisfy the accounting identity');

-- After closure: no movement of any custody kind can land.
select throws_ok(
  $$select public.issue_consumable_to_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000064')$$,
  'P0001', 'CONSUMABLES_ALREADY_RECONCILED', 'issue after reconciliation is rejected');
select throws_ok(
  $$select public.return_consumable_from_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000065')$$,
  'P0001', 'CONSUMABLES_ALREADY_RECONCILED', 'return after reconciliation is rejected');
select throws_ok(
  $$select public.consume_consumable_at_event('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',
      (select id from public.consumable_stock_items where catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
      1.000,null,'72000000-0000-0000-0000-000000000066')$$,
  'P0001', 'CONSUMABLES_ALREADY_RECONCILED', 'consumption after reconciliation is rejected');

-- Idempotent replay of the reconciliation itself.
select lives_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01','التسوية النهائية','72000000-0000-0000-0000-000000000063')$$,
  'an identical reconciliation retry replays the original closure');
select is(
  (select count(*)::int from public.event_consumable_reconciliations
    where event_id='70000000-0000-0000-0000-000000000f01'),
  1, 'the replay creates no duplicate closure');
select throws_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01','ملاحظة مختلفة','72000000-0000-0000-0000-000000000063')$$,
  '22023', 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
  'reconciliation key reuse with a different payload is rejected');
select throws_ok(
  $$select public.reconcile_event_consumables('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01',null,'72000000-0000-0000-0000-000000000067')$$,
  'P0001', 'CONSUMABLES_ALREADY_RECONCILED',
  'a second distinct reconciliation attempt is rejected');
select throws_ok(
  $$update public.event_consumable_reconciliations set notes='x'$$,
  '42501', null, 'a final reconciliation cannot be mutated');

-- The reconciled state is visible in the read models.
select is(
  (select is_reconciled from public.event_consumable_lines
    where event_id='70000000-0000-0000-0000-000000000f01'
      and catalog_item_id='70000000-0000-0000-0000-0000000000d1'),
  true, 'the Event consumable line reports the reconciled state');
select is(
  (public.event_consumable_summary('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f01')->>'status'),
  'RECONCILED', 'the Event consumable summary reports RECONCILED');
select is(
  (public.event_consumable_summary('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-000000000f03')->>'status'),
  'NO_CONSUMABLES', 'an Event without consumables reports NO_CONSUMABLES');

-- ===========================================================================
-- 12. Audit trail: complete, single per movement, no cost leakage.
-- ===========================================================================
set local role postgres;

select is(
  (select count(*)::int from public.audit_events
    where organization_id='70000000-0000-0000-0000-0000000000a1'
      and action='CONSUMABLE_RECEIVED'
      and metadata->>'idempotency_key'='72000000-0000-0000-0000-000000000001'),
  1, 'a replayed receipt produced exactly one audit event');
select is(
  (select metadata->>'quantity' from public.audit_events
    where metadata->>'idempotency_key'='72000000-0000-0000-0000-000000000010'),
  '8.250', 'the audit payload carries the exact issued quantity');
select is(
  (select user_id from public.audit_events
    where metadata->>'idempotency_key'='72000000-0000-0000-0000-000000000010'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'the audited actor is the authenticated warehouse user');
select is(
  (select count(*)::int from public.audit_events
    where action like 'CONSUMABLE%'
      and (metadata ? 'cost' or metadata ? 'valuation' or metadata ? 'cost_price')),
  0, 'no commercial cost leaks into any consumable audit payload');
select is(
  (select count(*)::int from public.audit_events
    where organization_id='70000000-0000-0000-0000-0000000000a1'
      and action='CONSUMABLES_RECONCILED'),
  1, 'the reconciliation emitted exactly one audit event');
select is(
  (select count(*)::int from public.audit_events
    where organization_id='70000000-0000-0000-0000-0000000000a1'
      and action='CONSUMABLE_ADJUSTED'),
  2, 'every adjustment is audited');
select is(
  (select metadata->>'reason' from public.audit_events
    where metadata->>'idempotency_key'='72000000-0000-0000-0000-000000000042'),
  'رصيد افتتاحي بعد الجرد', 'the adjustment audit carries its reason');

-- WAREHOUSE reading the catalog cannot see cost (existing boundary re-proved
-- against the consumable item).
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.catalog_items
    where id='70000000-0000-0000-0000-0000000000d1'),
  0, 'WAREHOUSE cannot read the cost-bearing catalog base table row');
select is(
  (select count(*)::int from public.catalog_items_operational
    where id='70000000-0000-0000-0000-0000000000d1'),
  1, 'WAREHOUSE reads the consumable item through the operational projection');

select * from finish();
rollback;
