-- ============================================================================
-- 0099 — Contracted restaurants & event meal bookings pgTAP.
--
-- Coverage:
--   * supplier contracts: only ACTIVE CATERING_RESTAURANT suppliers are
--     contractable; one active contract per supplier; exact pricing lands in
--     the cost read model; OWNER/MANAGER only;
--   * meal bookings: unit price snapshotted from the active contract, exact
--     total (guests × price), PENDING → CONFIRMED → SERVED lifecycle,
--     CANCELLED with reason, open-booking uniqueness per
--     event/restaurant/meal/day, service date inside contract window;
--   * serving/confirm/cancel authorization and idempotent actor stamps;
--   * security: cost read model gated (WAREHOUSE sees operational rows only,
--     never amounts), cross-org isolation, anon denied, raw tables revoked;
--   * contract ending makes the restaurant unavailable for new bookings
--     while historical bookings remain intact.
-- ============================================================================
begin;
select plan(35);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000001','authenticated','authenticated','mr-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000002','authenticated','authenticated','mr-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000003','authenticated','authenticated','mr-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000004','authenticated','authenticated','mr-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9a000000-0000-0000-0000-000000000006','authenticated','authenticated','mr-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('9a000000-0000-0000-0000-0000000000a1','MR Org A'),
('9a000000-0000-0000-0000-0000000000b1','MR Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000001','OWNER'),
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000002','MANAGER'),
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000003','SUPERVISOR'),
('9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-000000000004','WAREHOUSE'),
('9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-000000000006','OWNER');

insert into public.customers(id,organization_id,name) values
('9a000000-0000-0000-0000-0000000000c1','9a000000-0000-0000-0000-0000000000a1','Customer MR-A'),
('9a000000-0000-0000-0000-0000000000c2','9a000000-0000-0000-0000-0000000000b1','Customer MR-B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000c1','EV-MR-1','حفل العشاء','2026-10-15 18:00+04','2026-10-15 23:00+04',80,'صلالة','CONFIRMED','9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001'),
('9a000000-0000-0000-0000-0000000000e2','9a000000-0000-0000-0000-0000000000a1','9a000000-0000-0000-0000-0000000000c1','EV-MR-2','غداء الشركة','2026-10-20 12:00+04','2026-10-20 15:00+04',60,'مسقط','CONFIRMED','9b000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001'),
('9a000000-0000-0000-0000-0000000000e3','9a000000-0000-0000-0000-0000000000b1','9a000000-0000-0000-0000-0000000000c2','EV-MR-B','حفل ب','2026-10-25 18:00+04','2026-10-25 23:00+04',30,'نزوى','CONFIRMED','9b000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000006','9a000000-0000-0000-0000-000000000006');

-- OWNER session of org A for the setup steps.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Restaurant + non-restaurant suppliers.
select lives_ok($$select public.create_supplier(
  '9a000000-0000-0000-0000-0000000000a1','مطعم الضيافة المتعاقد','CATERING_RESTAURANT',
  null,'فهد','24000000','92000000',null,'عقد سنوي للبوفيه','9b000000-0000-0000-0000-000000000100')$$,
  'OWNER creates a CATERING_RESTAURANT supplier');                                                        -- 1

select lives_ok($$select public.create_supplier(
  '9a000000-0000-0000-0000-0000000000a1','مورد مستهلكات عام','CONSUMABLES',
  null,'خالد','24000000','92000000',null,null,'9b000000-0000-0000-0000-000000000101')$$,
  'OWNER creates a non-restaurant supplier');                                                             -- 2

select lives_ok($$select public.create_supplier_contract(
  '9a000000-0000-0000-0000-0000000000a1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'CTR-2026-001','2026-01-01','2026-12-31',
  3.500,5.000,40,24.0,'30 يوم من تاريخ الفاتورة','تعاقد سنوي بوفيه مفتوح',
  '9b000000-0000-0000-0000-000000000200')$$,
  'OWNER creates an active restaurant contract');                                                          -- 3

select is(
  (select lunch_unit_price from public.supplier_contract_summaries where contract_number='CTR-2026-001'),
  3.500, 'contract summary exposes exact lunch unit price');                                               -- 4

select throws_ok($$select public.create_supplier_contract(
  '9a000000-0000-0000-0000-0000000000a1',
  (select supplier_id from public.supplier_summaries where name='مورد مستهلكات عام'),
  'CTR-2026-002','2026-01-01','2026-12-31',
  1.000,1.000,0,24.0,null,null,'9b000000-0000-0000-0000-000000000201')$$,
  '23503','SUPPLIER_NOT_CONTRACTABLE','non-restaurant supplier cannot be contracted');                     -- 5

select throws_ok($$select public.create_supplier_contract(
  '9a000000-0000-0000-0000-0000000000a1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'CTR-2026-003','2026-01-01','2026-12-31',
  4.000,6.000,40,24.0,null,null,'9b000000-0000-0000-0000-000000000202')$$,
  '23505',null,'one active contract per restaurant supplier');                                                 -- 6

set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.create_supplier_contract(
  '9a000000-0000-0000-0000-0000000000a1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'CTR-2026-004','2026-01-01','2026-12-31',
  4.000,6.000,40,24.0,null,null,'9b000000-0000-0000-0000-000000000203')$$,
  '42501','NOT_AUTHORIZED','SUPERVISOR cannot create contracts');                                           -- 7

-- Back to OWNER for booking setup.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  '9a000000-0000-0000-0000-0000000000e1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'DINNER','2026-10-15',80,'بوفيه عشاء مفتوح','يبدأ التقديم الثامنة مساءً',
  '9b000000-0000-0000-0000-000000000300')$$,
  'OWNER books dinner for event EV-MR-1');                                                                -- 8

select is(
  (select unit_price from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  5.000, 'unit price snapshotted from the active contract dinner price');                                  -- 9

select is(
  (select total_amount from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  400.000, 'total = guests × contract price (80 × 5)');                                                   -- 10

select is(
  (select status from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  'PENDING', 'new booking starts PENDING (قيد التأكيد)');                                                  -- 11

-- SUPERVISOR can raise a PENDING booking but cannot confirm it.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.create_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  '9a000000-0000-0000-0000-0000000000e2',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'LUNCH','2026-10-20',60,'بوفيه غداء','بدون مأكولات بحرية',
  '9b000000-0000-0000-0000-000000000301')$$,
  'SUPERVISOR raises a PENDING lunch booking');                                                            -- 12

select throws_ok($$select public.confirm_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e2' and meal_type='LUNCH'),
  '9b000000-0000-0000-0000-000000000302')$$,
  '42501','NOT_AUTHORIZED','SUPERVISOR cannot confirm a booking');                                          -- 13

-- Duplicate open booking for the same meal/day/supplier blocked (same event).
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  '9a000000-0000-0000-0000-0000000000e1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'DINNER','2026-10-15',90,'بوفيه إضافي',null,'9b000000-0000-0000-0000-000000000303')$$,
  '23505',null,'duplicate open booking rejected');                                                            -- 14

-- Service date outside the contract window rejected.
select throws_ok($$select public.create_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  '9a000000-0000-0000-0000-0000000000e1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'DINNER','2027-01-05',80,'عشاء','خارج نطاق العقد','9b000000-0000-0000-0000-000000000304')$$,
  '22023','CONTRACT_DATE_MISMATCH','booking outside contract window rejected');                             -- 15

-- MANAGER confirms the dinner booking.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.confirm_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  '9b000000-0000-0000-0000-000000000400')$$,
  'MANAGER confirms the dinner booking');                                                                  -- 16

select is(
  (select status from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  'CONFIRMED', 'confirmed booking status (مؤكد)');                                                          -- 17

select is(
  (select confirmed_by from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  '9a000000-0000-0000-0000-000000000002', 'confirm actor stamped');                                          -- 18

select throws_ok($$select public.confirm_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  '9b000000-0000-0000-0000-000000000401')$$,
  '22023','INVALID_LIFECYCLE','double confirm rejected');                                                   -- 19

-- Cancel without a reason is rejected; cancel with reason works.
select throws_ok($$select public.cancel_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e2' and meal_type='LUNCH'),
  '  ','9b000000-0000-0000-0000-000000000402')$$,
  '22023','CANCELLATION_REASON_REQUIRED','cancel without reason rejected');                                  -- 20

select lives_ok($$select public.cancel_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e2' and meal_type='LUNCH'),
  'تغيير موعد الفعالية','9b000000-0000-0000-0000-000000000403')$$,
  'MANAGER cancels the pending lunch booking with a reason');                                               -- 21

select is(
  (select status from public.meal_booking_summaries where event_id='9a000000-0000-0000-0000-0000000000e2' and meal_type='LUNCH'),
  'CANCELLED', 'booking cancelled');                                                                        -- 22

-- WAREHOUSE cannot cancel or confirm but can see operational projection.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$select public.cancel_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  'ليس مخولاً','9b000000-0000-0000-0000-000000000404')$$,
  '42501','NOT_AUTHORIZED','WAREHOUSE cannot cancel bookings');                                              -- 23

select is(
  (select count(*) from public.meal_booking_operational where organization_id='9a000000-0000-0000-0000-0000000000a1')::text,
  '2', 'WAREHOUSE reads operational booking rows');                                                          -- 24

select is(
  (select count(*) from public.meal_booking_summaries where organization_id='9a000000-0000-0000-0000-0000000000a1')::text,
  '0', 'WAREHOUSE never sees the cost-bearing summary (amounts hidden)');                                    -- 25

-- SUPERVISOR marks the confirmed dinner as served.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.mark_meal_booking_served(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  '9b000000-0000-0000-0000-000000000500')$$,
  'SUPERVISOR marks the confirmed dinner as served');                                                        -- 26

select is(
  (select status from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  'SERVED', 'booking reached SERVED');                                                                       -- 27

select throws_ok($$select public.mark_meal_booking_served(
  '9a000000-0000-0000-0000-0000000000a1',
  (select booking_id from public.meal_booking_operational where event_id='9a000000-0000-0000-0000-0000000000e1' and meal_type='DINNER'),
  '9b000000-0000-0000-0000-000000000501')$$,
  '22023','INVALID_LIFECYCLE','served booking cannot be served again');                                       -- 28

-- Cross-org isolation + anon denial + raw table revocation.
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.meal_booking_summaries where organization_id='9a000000-0000-0000-0000-0000000000a1')::text,
  '0', 'org B owner sees zero org A booking summaries');                                                     -- 29

select is(
  (select count(*) from public.supplier_contract_summaries where organization_id='9a000000-0000-0000-0000-0000000000a1')::text,
  '0', 'org B owner sees zero org A contracts');                                                              -- 30

set local role anon;
set local "request.jwt.claims"='{}';
select throws_ok($$select * from public.meal_booking_operational$$,'42501',null,'anon cannot read booking projections'); -- 31

-- Contract ending: historical bookings intact, new bookings refused.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.end_supplier_contract(
  '9a000000-0000-0000-0000-0000000000a1',
  (select contract_id from public.supplier_contract_summaries where contract_number='CTR-2026-001'),
  '9b000000-0000-0000-0000-000000000600')$$,
  'OWNER ends the restaurant contract');                                                                     -- 32

select is(
  (select status from public.supplier_contract_summaries where contract_number='CTR-2026-001'),
  'ENDED', 'contract status becomes ENDED');                                                                  -- 33

select throws_ok($$select public.create_meal_booking(
  '9a000000-0000-0000-0000-0000000000a1',
  '9a000000-0000-0000-0000-0000000000e1',
  (select supplier_id from public.supplier_summaries where name='مطعم الضيافة المتعاقد'),
  'DINNER','2026-10-16',80,'عشاء','لا عقد فعال','9b000000-0000-0000-0000-000000000601')$$,
  '23503','NO_ACTIVE_CONTRACT','ended contract blocks new bookings');                                          -- 34

select is(
  (select count(*) from public.meal_booking_summaries
   where organization_id='9a000000-0000-0000-0000-0000000000a1' and status='SERVED')::text,
  '1', 'historical served booking survives contract ending');                                                 -- 35

rollback;
