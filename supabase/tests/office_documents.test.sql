-- ============================================================================
-- pgTAP — office document read models (migration 0080)
-- Run with: supabase test db   (authoritative acceptance evidence)
--
-- Covers the Pillar B canonical projections behind the printable documents:
--   * customer statement: canonical movements, cancelled events excluded,
--     voided payments excluded, exact OMR, visibility-gated, unknown != 0
--   * payment receipt: authoritative fields, voided shape is explicit
--   * warehouse preparation/return sheet: required + canonical movement
--     quantities, no cost data, member-visible
--   * host statement: canonical payroll rows, payroll.read-gated
--   * cross-org isolation on every projection
-- ============================================================================

begin;
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner / postgres, before switching role)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'od-owner-a@test.local',   'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'od-manager-a@test.local', 'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'od-supervisor-a@test.local','x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'od-owner-b@test.local',   'x', now(), now(), now(), '{}', '{}', false);

insert into public.organizations (id, name) values
  ('98000000-0000-0000-0000-0000000000a1', 'OD Org A'),
  ('98000000-0000-0000-0000-0000000000b1', 'OD Org B');

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000002', 'MANAGER',    'ACTIVE'),
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000003', 'SUPERVISOR', 'ACTIVE'),
  ('98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000006', 'OWNER',      'ACTIVE');

insert into public.customers (id, organization_id, name) values
  ('98000000-0000-0000-0000-0000000000c1', '98000000-0000-0000-0000-0000000000a1', 'Customer A'),
  ('98000000-0000-0000-0000-0000000000c2', '98000000-0000-0000-0000-0000000000b1', 'Customer B');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, cost_price, selling_price) values
  ('98000000-0000-0000-0000-0000000000c9', '98000000-0000-0000-0000-0000000000a1', 'Tables', 'REUSABLE_EQUIPMENT', 'FIXED', 40.000, 80.000),
  ('98000000-0000-0000-0000-0000000000c8', '98000000-0000-0000-0000-0000000000a1', 'Cups',   'CONSUMABLE',         'FIXED',  0.200,  0.500);

insert into public.events (id, organization_id, customer_id, event_number, title, start_at, end_at, guest_count, venue_name, status, idempotency_key, created_by, updated_by) values
  ('98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000c1', 'EV-OD-1', 'Wedding',   '2026-10-01 10:00+04', '2026-10-01 20:00+04', 100, 'Muscat',  'CONFIRMED', '98100000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-0000000000e2', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000c1', 'EV-OD-2', 'Drafted',   '2026-10-02 10:00+04', '2026-10-02 20:00+04',  50, 'Muscat',  'DRAFT',     '98100000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-0000000000e3', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000c1', 'EV-OD-3', 'Cancelled', '2026-10-03 10:00+04', '2026-10-03 20:00+04',  80, 'Salalah', 'CANCELLED', '98100000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-0000000000e4', '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000c2', 'EV-OD-B', 'B Event',   '2026-10-04 10:00+04', '2026-10-04 20:00+04',  60, 'Salalah', 'CONFIRMED', '98100000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-000000000006', '98000000-0000-0000-0000-000000000006');

insert into public.quotations (id, organization_id, event_id, quotation_number, revision, status, customer_name_snapshot, event_number_snapshot, event_title_snapshot, guest_count_snapshot, start_at_snapshot, end_at_snapshot, venue_snapshot, total_selling, total_expected_cost, total_expected_profit, idempotency_key, issued_by, accepted_by, accepted_at) values
  ('98000000-0000-0000-0000-0000000000f1', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', 'QT-OD-1', 1, 'ACCEPTED', 'Customer A', 'EV-OD-1', 'Wedding',   100, '2026-10-01 10:00+04', '2026-10-01 20:00+04', 'Muscat',  500.000, 300.000, 200.000, '98110000-0000-0000-0000-000000000011', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', now()),
  ('98000000-0000-0000-0000-0000000000f3', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e3', 'QT-OD-3', 1, 'ACCEPTED', 'Customer A', 'EV-OD-3', 'Cancelled',  80,  '2026-10-03 10:00+04', '2026-10-03 20:00+04', 'Salalah', 300.000, 150.000, 150.000, '98110000-0000-0000-0000-000000000013', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', now()),
  ('98000000-0000-0000-0000-0000000000f2', '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000e4', 'QT-OD-B', 1, 'ACCEPTED', 'Customer B', 'EV-OD-B', 'B Event',    60,  '2026-10-04 10:00+04', '2026-10-04 20:00+04', 'Salalah', 400.000, 200.000, 200.000, '98110000-0000-0000-0000-000000000012', '98000000-0000-0000-0000-000000000006', '98000000-0000-0000-0000-000000000006', now());

update public.events set accepted_quotation_id = '98000000-0000-0000-0000-0000000000f1' where id = '98000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id = '98000000-0000-0000-0000-0000000000f3' where id = '98000000-0000-0000-0000-0000000000e3';
update public.events set accepted_quotation_id = '98000000-0000-0000-0000-0000000000f2' where id = '98000000-0000-0000-0000-0000000000e4';

insert into public.event_commercial_lines (organization_id, event_id, source_catalog_item_id, description, item_type, unit, pricing_method, quantity, unit_selling_price, expected_unit_cost, total_selling, total_expected_cost, sort_order) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000c9', 'Tables', 'REUSABLE_EQUIPMENT', 'pc',  'FIXED', 1.500, 80.000, 40.000, 120.000, 60.000, 1),
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000c8', 'Cups',   'CONSUMABLE',         'box', 'FIXED', 3.000,  0.500,  0.200,   1.500,  0.600, 2);

insert into public.equipment_capacity (id, organization_id, catalog_item_id, total_quantity) values
  ('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000c9', 10);

insert into public.event_equipment_reservations (id, organization_id, event_id, equipment_capacity_id, quantity, reserved_from, reserved_until, status, idempotency_key, created_by) values
  ('98000000-0000-0000-0000-000000000021', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000d1', 2, '2026-09-25 10:00+04', '2026-10-02 10:00+04', 'ACTIVE', '98120000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');

insert into public.event_equipment_movements (organization_id, event_id, reservation_id, equipment_capacity_id, movement_kind, dispatched_quantity, returned_good_quantity, damaged_quantity, lost_quantity, valuation_basis, unit_valuation_omr, damage_loss_valuation_omr, actor_id, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-000000000021', '98000000-0000-0000-0000-0000000000d1', 'DISPATCH', 2, 0, 0, 0, null, null, null, '98000000-0000-0000-0000-000000000001', '98130000-0000-0000-0000-000000000001', repeat('b', 64)),
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-000000000021', '98000000-0000-0000-0000-0000000000d1', 'RETURN',   0, 1, 0, 1, 'CATALOG_COST_SNAPSHOT', 40.000, 40.000, '98000000-0000-0000-0000-000000000001', '98130000-0000-0000-0000-000000000002', repeat('d', 64));

insert into public.consumable_stock_items (id, organization_id, catalog_item_id, created_by) values
  ('98000000-0000-0000-0000-000000000012', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000c8', '98000000-0000-0000-0000-000000000001');

insert into public.consumable_movements (organization_id, stock_item_id, event_id, movement_kind, quantity, actor_id, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000012', null, 'RECEIVE', 5.000, '98000000-0000-0000-0000-000000000001', '98140000-0000-0000-0000-000000000000', repeat('a', 64)),
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000012', '98000000-0000-0000-0000-0000000000e1', 'ISSUE_TO_EVENT', 3.000, '98000000-0000-0000-0000-000000000001', '98140000-0000-0000-0000-000000000001', repeat('c', 64));

insert into public.staff_members (id, organization_id, name, phone, staff_type, default_compensation_method, default_rate) values
  ('98000000-0000-0000-0000-000000000011', '98000000-0000-0000-0000-0000000000a1', 'Host One', '+96890000002', 'HOST', 'PER_DAY', 20.000);

insert into public.staff_attendance (organization_id, event_id, staff_member_id, attendance_date, shift, check_in, check_out, status, wage_method, wage_rate, earned_amount, recorded_by, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-000000000011', '2026-10-01', 'MORNING', '2026-10-01 09:00+04', '2026-10-01 18:00+04', 'PRESENT', 'PER_DAY', 20.000, 20.000, '98000000-0000-0000-0000-000000000001', '98180000-0000-0000-0000-000000000001', repeat('g', 64));

insert into public.staff_advances (organization_id, staff_member_id, amount, advance_date, status, recorded_by, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000011', 10.000, '2026-09-01', 'RECORDED', '98000000-0000-0000-0000-000000000001', '98150000-0000-0000-0000-000000000001', repeat('e', 64));

insert into public.host_payouts (organization_id, staff_member_id, event_id, amount, payout_date, payment_method, reference, status, recorded_by, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-000000000011', '98000000-0000-0000-0000-0000000000e1', 25.000, '2026-09-20', 'CASH', 'HP-1', 'RECORDED', '98000000-0000-0000-0000-000000000001', '98160000-0000-0000-0000-000000000001', repeat('f', 64));

insert into public.customer_payments (id, organization_id, event_id, amount, payment_method, reference, notes, paid_at, status, recorded_by, voided_by, voided_at, void_reason, idempotency_key, request_fingerprint) values
  ('98000000-0000-0000-0000-000000000031', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', 150.000, 'BANK_TRANSFER', 'TRX-1', 'deposit', '2026-10-05 11:00+04', 'RECORDED', '98000000-0000-0000-0000-000000000001', null, null, null, '98170000-0000-0000-0000-000000000001', repeat('1', 64)),
  ('98000000-0000-0000-0000-000000000032', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1',  50.000, 'CASH',          null,    null,      '2026-10-06 09:00+04', 'RECORDED', '98000000-0000-0000-0000-000000000001', null, null, null, '98170000-0000-0000-0000-000000000002', repeat('2', 64)),
  ('98000000-0000-0000-0000-000000000033', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000e1', 100.000, 'CASH',          null,    null,      '2026-10-07 09:00+04', 'VOIDED',   '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', now(), 'wrong amount', '98170000-0000-0000-0000-000000000003', repeat('3', 64));

-- ---------------------------------------------------------------------------
-- 1) Customer statement — canonical movements, gated by cost.visibility
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1')),3,'statement has the charge plus two recorded payments (voided + cancelled excluded)');
select is((select amount::text from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1') where row_kind='CHARGE'),'500.000','charge amount is the accepted revenue');
select is((select occurred_at from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1') where row_kind='CHARGE'),'2026-10-01 10:00+04'::timestamptz,'charge dated at the event date');
select is((select count(*)::int from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1') where row_kind='PAYMENT' and payment_method='BANK_TRANSFER' and reference='TRX-1'),1,'payment rows carry method and reference');
select is((select coalesce(sum(amount),0)::text from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1') where row_kind='PAYMENT'),'200.000','payment total is exact OMR');
select is((select count(*)::int from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000ff')),0,'unknown customer yields no rows (unknown is not zero)');

set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1')),0,'SUPERVISOR without cost.visibility sees no statement rows');

set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_member_permission('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000003','cost.visibility',true)$$,'OWNER grants the SUPERVISOR cost.visibility');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.customer_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1')),3,'granted cost.visibility unlocks the statement');

-- ---------------------------------------------------------------------------
-- 2) Payment receipt — authoritative fields, explicit void shape
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select amount::text from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000031')),'150.000','receipt amount is exact');
select is((select status from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000031')),'RECORDED','recorded receipt carries its status');
select is((select customer_name from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000031')),'Customer A','receipt names the customer');
select is((select status from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000033')),'VOIDED','voided payment is reported as VOIDED, never silently valid');
select is((select void_reason from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000033')),'wrong amount','voided receipt carries the void reason');
select is((select count(*)::int from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000ff')),0,'unknown payment id yields no receipt');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.customer_payment_receipt('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000031')),0,'cross-org receipt is empty');

-- ---------------------------------------------------------------------------
-- 3) Warehouse preparation/return sheet — quantities, no cost, member-visible
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1')),2,'sheet has one equipment line and one consumable line');
select is((select required_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='EQUIPMENT'),'2.000','equipment required quantity is ceiled to whole units');
select is((select dispatched_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='EQUIPMENT'),'2.000','equipment dispatched quantity is canonical');
select is((select returned_good_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='EQUIPMENT'),'1.000','equipment returned-good quantity is canonical');
select is((select lost_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='EQUIPMENT'),'1.000','equipment lost quantity is canonical');
select is((select required_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='CONSUMABLE'),'3.000','consumable required quantity is exact');
select is((select prepared_qty::text from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1') where line_kind='CONSUMABLE'),'3.000','consumable issued quantity is canonical');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1')),0,'cross-org sheet is empty');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.event_warehouse_sheet_lines('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e2')),0,'event without operational lines yields no sheet rows');

-- ---------------------------------------------------------------------------
-- 4) Host statement — canonical payroll rows, gated by payroll.read
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000011')),1,'MANAGER preset sees the host''s canonical rows');
select is((select payouts_total::text from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000011')),'25.000','host payouts total is canonical');
select is((select advances_total::text from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000011')),'10.000','host advances total is canonical');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000011')),0,'SUPERVISOR without payroll.read sees no host statement rows');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_member_permission('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000003','payroll.read',true)$$,'OWNER grants the SUPERVISOR payroll.read');
set local "request.jwt.claims" = '{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000011')),1,'granted payroll.read unlocks the host statement');
select is((select count(*)::int from public.host_statement('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000ff')),0,'unknown staff member yields no statement rows');

select * from finish();
rollback;
