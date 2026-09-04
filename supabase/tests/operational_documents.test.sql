-- ============================================================================
-- pgTAP — operational & payroll document read models (migration 0081)
-- Run with: supabase test db   (authoritative acceptance evidence)
--
-- Covers the remaining office-document projections behind the printable
-- family:
--   * event team sheet: ACTIVE roster + non-confidential attendance state,
--     RELEASED/VOIDED excluded, presence worst-status aggregation, member
--     visibility, cross-org isolation, and a STRUCTURAL proof that the
--     projection carries no wage/rate/compensation column at all.
--   * event work order header: canonical event truth + customer + the
--     responsible office user; membership-gated; cost-free by construction.
--   * procurement ops lines: live (non-cancelled) orders only, no agreed
--     cost column in the projection.
--   * payroll period sheet: payroll.read gate, exact period aggregation
--     (VOIDED/out-of-range excluded), payout headers (no allocation
--     double-counting), balance reconciliation, deterministic range errors.
-- ============================================================================

begin;
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner, before switching role)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'op-owner-a@test.local',     'x', now(), now(), now(), '{}', '{"full_name":"Owner Person"}', false),
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'op-supervisor-a@test.local', 'x', now(), now(), now(), '{}', '{"full_name":"Ops Assistant"}', false),
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'op-owner-b@test.local',     'x', now(), now(), now(), '{}', '{"full_name":"Other Owner"}', false);

insert into public.organizations (id, name) values
  ('99000000-0000-0000-0000-0000000000a1', 'OP Org A'),
  ('99000000-0000-0000-0000-0000000000b1', 'OP Org B');

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-000000000002', 'SUPERVISOR', 'ACTIVE'),
  ('99000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-000000000003', 'OWNER',      'ACTIVE');

insert into public.customers (id, organization_id, name) values
  ('99000000-0000-0000-0000-0000000000c1', '99000000-0000-0000-0000-0000000000a1', 'Customer One'),
  ('99000000-0000-0000-0000-0000000000c2', '99000000-0000-0000-0000-0000000000b1', 'Customer Two');

insert into public.events (id, organization_id, customer_id, event_number, title, start_at, end_at, guest_count, venue_name, location_details, notes, status, idempotency_key, created_by, updated_by) values
  ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000c1', 'EV-OP-1', 'Wedding', '2026-10-01 08:00+04', '2026-10-01 23:30+04', 100, 'Muscat Hall', 'Al Khuwair', 'Setup two hours early', 'CONFIRMED', '99100000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-0000000000e2', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000c1', 'EV-OP-2', 'Majlis',  '2026-10-08 08:00+04', '2026-10-08 18:00+04',  40, 'Nizwa Hall',  null,         null,                  'CONFIRMED', '99100000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000002'),
  ('99000000-0000-0000-0000-0000000000e3', '99000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000c2', 'EV-OP-B', 'B Event', '2026-10-04 10:00+04', '2026-10-04 20:00+04',  60, 'Salalah',     null,         null,                  'CONFIRMED', '99100000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000003');

insert into public.staff_members (id, organization_id, name, phone, staff_type, default_compensation_method, default_rate) values
  ('99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000a1', 'Host One',   '+96890000001', 'HOST',    'PER_DAY', 20.000),
  ('99000000-0000-0000-0000-0000000000d2', '99000000-0000-0000-0000-0000000000a1', 'Host Two',   '+96890000002', 'HOSTESS', 'PER_DAY', 15.000),
  ('99000000-0000-0000-0000-0000000000d3', '99000000-0000-0000-0000-0000000000a1', 'Host Three', null,           'DRIVER',  'PER_DAY', 10.000);

insert into public.event_staff_assignments (id, organization_id, event_id, staff_member_id, assignment_role, scheduled_start, scheduled_end, compensation_method, rate, expected_compensation, status, notes, idempotency_key, created_by) values
  ('99000000-0000-0000-0000-000000000a01', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d1', 'HOST',    '2026-10-01 08:30+04', '2026-10-01 23:00+04', 'PER_DAY', 20.000, 20.000, 'ACTIVE',   'Lead the hall',  '99110000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-000000000a02', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d2', 'HOSTESS', '2026-10-01 08:30+04', '2026-10-01 18:00+04', 'PER_DAY', 15.000, 15.000, 'ACTIVE',   null,             '99110000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-000000000a03', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d3', 'DRIVER',  '2026-10-01 08:30+04', '2026-10-01 18:00+04', 'PER_DAY', 10.000, 10.000, 'ACTIVE',   null,             '99110000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-000000000a04', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d1', 'HOST',    '2026-10-02 08:30+04', '2026-10-02 12:00+04', 'PER_DAY', 20.000, 20.000, 'RELEASED', 'must not print', '99110000-0000-0000-0000-000000000004', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-000000000a05', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e2', '99000000-0000-0000-0000-0000000000d2', 'HOSTESS', '2026-10-08 08:30+04', '2026-10-08 17:00+04', 'PER_DAY', 15.000, 15.000, 'ACTIVE',   null,             '99110000-0000-0000-0000-000000000005', '99000000-0000-0000-0000-000000000001');

insert into public.staff_attendance (organization_id, event_id, staff_member_id, attendance_date, shift, check_in, check_out, status, wage_method, wage_rate, earned_amount, recorded_by, idempotency_key, request_fingerprint) values
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d1', '2026-10-01', 'MORNING', '2026-10-01 09:00+04', '2026-10-01 14:00+04', 'PRESENT', 'PER_DAY', 20.000, 20.000, '99000000-0000-0000-0000-000000000001', '99120000-0000-0000-0000-000000000001', repeat('a', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d1', '2026-10-01', 'EVENING', '2026-10-01 18:10+04', '2026-10-01 23:00+04', 'LATE',    'PER_DAY', 20.000, 20.000, '99000000-0000-0000-0000-000000000001', '99120000-0000-0000-0000-000000000002', repeat('b', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d2', '2026-10-01', 'MORNING', null,                  null,                  'ABSENT',  'PER_DAY', 15.000,  0.000, '99000000-0000-0000-0000-000000000001', '99120000-0000-0000-0000-000000000003', repeat('c', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e2', '99000000-0000-0000-0000-0000000000d2', '2026-10-08', 'MORNING', '2026-10-08 08:40+04', '2026-10-08 17:00+04', 'PRESENT', 'PER_DAY', 15.000, 15.000, '99000000-0000-0000-0000-000000000001', '99120000-0000-0000-0000-000000000004', repeat('d', 64));

-- A VOIDED attendance row for Host Three: presence must fall back to unrecorded.
insert into public.staff_attendance (organization_id, event_id, staff_member_id, attendance_date, shift, check_in, check_out, status, wage_method, wage_rate, earned_amount, recorded_by, voided_by, voided_at, void_reason, idempotency_key, request_fingerprint) values
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000d3', '2026-10-01', 'MORNING', '2026-10-01 08:55+04', '2026-10-01 09:05+04', 'VOIDED', 'PER_DAY', 10.000, 5.000, '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001', now(), 'mistake', '99120000-0000-0000-0000-000000000005', repeat('e', 64));

-- Payroll facts: advances and payouts (VOIDED rows carry their void shape
-- inline — the ledger is append-only). The multi-event payout header (30)
-- with allocations 18 + 12 must count ONCE in the period view.
insert into public.staff_advances (organization_id, staff_member_id, amount, advance_date, status, recorded_by, voided_by, voided_at, void_reason, idempotency_key, request_fingerprint) values
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1', 10.000, '2026-10-05', 'RECORDED', '99000000-0000-0000-0000-000000000001', null, null, null, '99130000-0000-0000-0000-000000000001', repeat('f', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1',  5.000, '2026-09-01', 'RECORDED', '99000000-0000-0000-0000-000000000001', null, null, null, '99130000-0000-0000-0000-000000000002', repeat('g', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1',  7.000, '2026-10-10', 'VOIDED',   '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001', now(), 'entry error', '99130000-0000-0000-0000-000000000003', repeat('h', 64));

insert into public.host_payouts (organization_id, staff_member_id, event_id, amount, payout_date, payment_method, reference, status, recorded_by, voided_by, voided_at, void_reason, idempotency_key, request_fingerprint) values
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000e1', 12.000, '2026-10-20', 'CASH', 'HP-OP-1', 'RECORDED', '99000000-0000-0000-0000-000000000001', null, null, null, '99140000-0000-0000-0000-000000000001', repeat('i', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000e1',  4.000, '2026-10-21', 'CASH', 'HP-OP-2', 'VOIDED',   '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001', now(), 'duplicate entry', '99140000-0000-0000-0000-000000000002', repeat('j', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d2', null,                          30.000, '2026-10-12', 'CASH', 'HP-OP-3', 'RECORDED', '99000000-0000-0000-0000-000000000001', null, null, null, '99140000-0000-0000-0000-000000000003', repeat('k', 64)),
  ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000e2', 15.000, '2026-11-05', 'CASH', 'HP-OP-4', 'RECORDED', '99000000-0000-0000-0000-000000000001', null, null, null, '99140000-0000-0000-0000-000000000004', repeat('l', 64));

insert into public.host_payout_allocations (id, organization_id, payout_id, event_id, amount) values
  ('99000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000a1', (select id from public.host_payouts where idempotency_key = '99140000-0000-0000-0000-000000000003'), '99000000-0000-0000-0000-0000000000e1', 18.000),
  ('99000000-0000-0000-0000-0000000000b2', '99000000-0000-0000-0000-0000000000a1', (select id from public.host_payouts where idempotency_key = '99140000-0000-0000-0000-000000000003'), '99000000-0000-0000-0000-0000000000e2', 12.000);

-- Procurement dependency for the work order (live + cancelled orders).
insert into public.suppliers (id, organization_id, name, status, created_by, updated_by) values
  ('99000000-0000-0000-0000-0000000000f1', '99000000-0000-0000-0000-0000000000a1', 'Fresh Supplies', 'ACTIVE', '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001');

insert into public.procurement_orders (id, organization_id, supplier_id, event_id, order_number, order_date, expected_delivery_at, notes, status, agreed_total_cost, supplier_name_snapshot, approved_at, approved_by, sent_at, sent_by, cancelled_at, cancelled_by, cancellation_reason, created_by, updated_by) values
  ('99000000-0000-0000-0000-0000000000f2', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f1', '99000000-0000-0000-0000-0000000000e1', 'PO-OP-1', '2026-09-20', '2026-09-30 16:00+04', 'Deliver to hall', 'SENT', 100.000, 'Fresh Supplies', '2026-09-21 08:00+04', '99000000-0000-0000-0000-000000000001', '2026-09-21 09:00+04', '99000000-0000-0000-0000-000000000001', null, null, null, '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-0000000000f3', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f1', '99000000-0000-0000-0000-0000000000e1', 'PO-OP-2', '2026-09-19', null,                   null,              'CANCELLED', 10.000, 'Fresh Supplies', null, null, null, null, now(), '99000000-0000-0000-0000-000000000001', 'no longer needed', '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001');

insert into public.procurement_order_lines (id, organization_id, order_id, line_kind, description, unit, quantity, agreed_unit_cost, agreed_total_cost, sort_order) values
  ('99000000-0000-0000-0000-0000000000f4', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f2', 'CATERING_SERVICE', 'Fresh Juice', 'liter', 40.000, 2.500, 100.000, 1),
  ('99000000-0000-0000-0000-0000000000f5', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f3', 'OTHER', 'Ice', 'box', 10.000, 1.000, 10.000, 1);

-- ---------------------------------------------------------------------------
-- 1) Event team sheet — roster, presence, wage-free, member-gated
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is((select count(*)::int from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),3,'team sheet has the three ACTIVE assignments (RELEASED excluded)');
select is((select presence_status from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host One'),'LATE','presence is the worst live status across shifts');
select is((select check_in from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host One'),'2026-10-01 09:00+04'::timestamptz,'arrival is the earliest check-in');
select is((select check_out from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host One'),'2026-10-01 23:00+04'::timestamptz,'departure is the latest check-out');
select is((select presence_status from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host Two'),'ABSENT','an ABSENT shift is shown on the operational sheet');
select ok((select presence_status is null and check_in is null and check_out is null from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host Three'),'a VOIDED-only attendance falls back to unrecorded presence');
select is((select assignment_notes from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1') where staff_name='Host One'),'Lead the hall','assignment notes travel to the sheet');

-- Wage privacy is structural: the declared output columns themselves contain
-- no wage/rate/compensation name (pg_proc.proargnames is the projection's
-- complete surface — nothing more can be fetched).
select is((select count(*)::int from pg_proc p, unnest(p.proargnames) with ordinality as u(argname, ord) where p.oid = 'public.event_team_sheet(uuid, uuid)'::regprocedure and coalesce(p.proargmodes[u.ord], 'o') = 'o' and (u.argname ilike '%rate%' or u.argname ilike '%wage%' or u.argname ilike '%earned%' or u.argname ilike '%compensation%' or u.argname ilike '%amount%' or u.argname ilike '%cost%')),0,'team sheet projection carries NO wage/rate/compensation column');

select is((select count(*)::int from public.event_team_sheet('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000e1')),0,'foreign org id with org-A event yields no rows');

set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.event_team_sheet('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),0,'a non-member cannot pull the roster through the definer projection');

-- ---------------------------------------------------------------------------
-- 2) Event work order header — canonical event truth, operations only
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select customer_name from public.event_work_order_header('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),'Customer One','work order names the event customer');
select is((select responsible_user_name from public.event_work_order_header('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),'Owner Person','work order names the responsible office user');
select is((select guest_count from public.event_work_order_header('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),100,'guest count is the canonical event figure');
select is((select count(*)::int from public.event_work_order_header('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000ff')),0,'unknown event yields no work order row');
select is((select count(*)::int from pg_proc p, unnest(p.proargnames) with ordinality as u(argname, ord) where p.oid = 'public.event_work_order_header(uuid, uuid)'::regprocedure and coalesce(p.proargmodes[u.ord], 'o') = 'o' and (u.argname ilike '%cost%' or u.argname ilike '%profit%' or u.argname ilike '%margin%' or u.argname ilike '%revenue%' or u.argname ilike '%amount%')),0,'work order header carries NO financial column');

-- ---------------------------------------------------------------------------
-- 3) Procurement ops lines — live orders only, cost-free projection
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.event_procurement_ops_lines('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),1,'only the live (non-cancelled) order prints on the work order');
select is((select item_name from public.event_procurement_ops_lines('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),'Fresh Juice','the procurement item text is projected');
select is((select quantity::text from public.event_procurement_ops_lines('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000e1')),'40.000','quantity keeps the exact persisted scale');
select is((select count(*)::int from pg_proc p, unnest(p.proargnames) with ordinality as u(argname, ord) where p.oid = 'public.event_procurement_ops_lines(uuid, uuid)'::regprocedure and coalesce(p.proargmodes[u.ord], 'o') = 'o' and (u.argname ilike '%cost%' or u.argname ilike '%price%')),0,'procurement ops projection carries NO agreed-cost column');

-- ---------------------------------------------------------------------------
-- 4) Payroll period sheet — payroll.read gate + exact period math
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31')),0,'SUPERVISOR without payroll.read gets no period rows');

set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31')),2,'OWNER period sheet covers exactly the hosts with period activity');
select is((select earned_total::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31') where staff_name='Host One'),'40.000','period earned is the live attendance sum (VOIDED excluded)');
select is((select advances_total::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31') where staff_name='Host One'),'10.000','period advances exclude out-of-range and VOIDED entries');
select is((select payouts_total::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31') where staff_name='Host Two'),'30.000','multi-event payout counts ONCE at the header (no allocation double-count)');
select is((select balance_total::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31') where staff_name='Host One'),'18.000','balance = earned - advances - payouts, exact');
select is((select coalesce(sum(earned_total - advances_total - payouts_total), 0)::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31')),
           (select coalesce(sum(balance_total), 0)::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31')),
           'the whole period sheet reconciles: sum(earned-advances-payouts) = sum(balance)');
select is((select count(*)::int from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-09-01','2026-09-30')),1,'September period covers only the host with September facts');
select is((select payouts_total::text from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-11-01','2026-11-30')),'15.000','the November payout is dated into its own period');
select throws_ok($$select * from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-31','2026-10-01')$$,'22023','PAYROLL_PERIOD_RANGE_INVALID','reversed period is rejected deterministically');
select throws_ok($$select * from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1',null,'2026-10-31')$$,'22023','PAYROLL_PERIOD_RANGE_REQUIRED','a missing period bound is rejected, never guessed');

set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_member_permission('99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-000000000002','payroll.read',true)$$,'OWNER grants payroll.read to the operations assistant');
set local "request.jwt.claims" = '{"sub":"99000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.payroll_period_sheet('99000000-0000-0000-0000-0000000000a1','2026-10-01','2026-10-31')),2,'granted payroll.read unlocks the period sheet immediately');

select * from finish();
rollback;
