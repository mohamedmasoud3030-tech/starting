-- ============================================================================
-- 0082/0083 — Event Command Center, canonical readiness (staff + equipment +
-- consumables + procurement; finance EXCLUDED), assisted face attendance,
-- the Today collections/closure projections, and the wage-free attendance
-- command surface.
--
-- Acceptance fixtures from the stage brief:
--   §54: 20 hosts required / 18 assigned + one equipment + one consumables +
--        one procurement gap + an OUTSTANDING customer balance → NOT_READY
--        with exactly the four operational reasons; closing the four gaps
--        flips it to READY while the outstanding balance REMAINS (money never
--        blocks READY) — and the dispatch gate follows the same status.
--   §53: a match attempt is single-use and server-revalidated; the manual
--        roster path stays first-class with NO enrollment at all.
--   §55: Muscat day boundary computed from p_now (near midnight) and close
--        eligibility by canonical lifecycle state — not calendar age.
-- ============================================================================
begin;
select plan(50);

-- ---------------------------------------------------------------------------
-- Fixture. Owner, supervisor (attendance+ops, NO cost), warehouse (no
-- attendance record / no cost), accountant (payroll read only).
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','99300000-0000-0000-0000-0000000000a1','authenticated','authenticated','cc-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','99300000-0000-0000-0000-0000000000a2','authenticated','authenticated','cc-supervisor@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','99300000-0000-0000-0000-0000000000a3','authenticated','authenticated','cc-warehouse@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','99300000-0000-0000-0000-0000000000a4','authenticated','authenticated','cc-accountant@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values ('99300000-0000-0000-0000-0000000000a1','CC Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1','OWNER'),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a2','SUPERVISOR'),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a3','WAREHOUSE'),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a4','ACCOUNTANT');

insert into public.customers(id,organization_id,name) values
('99300000-0000-0000-0000-0000000000c1','99300000-0000-0000-0000-0000000000a1','CC Customer');

-- e1 = the §54 fixture. NOT "today" so next-action vs Today-day logic stay independent.
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000c1','EV-CC-1','Grand Hall','2026-11-15 18:00+04','2026-11-16 00:00+04',300,'Muscat','PREPARING','99400000-0000-0000-0000-000000000001','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1');

insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('99300000-0000-0000-0000-0000000000d1','99300000-0000-0000-0000-0000000000a1','Hosts','STAFF','person','PER_UNIT',5,8),
('99300000-0000-0000-0000-0000000000d2','99300000-0000-0000-0000-0000000000a1','Dallah sets','REUSABLE_EQUIPMENT','set','PER_UNIT',10,20),
('99300000-0000-0000-0000-0000000000d3','99300000-0000-0000-0000-0000000000a1','Water bottles','CONSUMABLE','piece','PER_UNIT',0.1,0.3);

insert into public.event_commercial_lines(organization_id,event_id,source_catalog_item_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost) values
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000d1','20 hosts','STAFF','person','PER_UNIT',20,8,5,160,100),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000d2','5 dallah sets','REUSABLE_EQUIPMENT','set','PER_UNIT',5,20,10,100,50),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000d3','10 water crates','CONSUMABLE','piece','PER_UNIT',10,0.3,0.1,3,1);

-- 20 hosts; the first 18 assigned to e1 (2 missing).
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate)
select ('99300000-0000-0000-0000-00000000f0' || lpad(i::text,2,'0'))::uuid,
       '99300000-0000-0000-0000-0000000000a1', 'Host ' || i, 'HOST', true, 'PER_EVENT', 25.000
from generate_series(1,20) as i;

insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by)
select ('99300000-0000-0000-0000-0000e100' || lpad(i::text,4,'0'))::uuid,
       '99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1',
       ('99300000-0000-0000-0000-00000000f0' || lpad(i::text,2,'0'))::uuid,
       'HOST','2026-11-15 18:00+04','2026-11-16 00:00+04','PER_EVENT',25,25,'ACTIVE',
       ('99500000-0000-0000-0000-00000000' || lpad(i::text,4,'0'))::uuid,
       '99300000-0000-0000-0000-0000000000a1'
from generate_series(1,18) as i;

-- equipment: capacity 5, only 4 reserved → 1 short.
insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values
('99300000-0000-0000-0000-0000000000b1','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000d2',5);
insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,status,idempotency_key,created_by) values
('99300000-0000-0000-0000-00000000b201','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000b1',4,'2026-11-15 17:00+04','2026-11-16 01:00+04','ACTIVE','99600000-0000-0000-0000-000000000001','99300000-0000-0000-0000-0000000000a1');

-- consumables: 7 of 10 issued to the event → short. Stock first RECEIVED
-- into the warehouse (the availability trigger guards every issue movement).
insert into public.consumable_stock_items(id,organization_id,catalog_item_id,minimum_stock_quantity,created_by) values
('99300000-0000-0000-0000-000000005c01','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000d3',0,'99300000-0000-0000-0000-0000000000a1');
insert into public.consumable_movements(id,organization_id,stock_item_id,event_id,movement_kind,quantity,actor_id,idempotency_key,request_fingerprint) values
('99300000-0000-0000-0000-000000005c04','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-000000005c01',null,'RECEIVE',20,'99300000-0000-0000-0000-0000000000a1','99700000-0000-0000-0000-000000000004',repeat(md5('cc-mov-4'),2)),
('99300000-0000-0000-0000-000000005c02','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-000000005c01','99300000-0000-0000-0000-0000000000e1','ISSUE_TO_EVENT',7,'99300000-0000-0000-0000-0000000000a1','99700000-0000-0000-0000-000000000001',repeat(md5('cc-mov-1'),2));

-- procurement: one approved-but-unreceived order for the event.
insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
('99300000-0000-0000-0000-000000005d01','99300000-0000-0000-0000-0000000000a1','CC Supplier','ACTIVE','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1');
insert into public.procurement_orders(id,organization_id,supplier_id,event_id,order_number,order_date,status,approved_by,approved_at,sent_by,sent_at,confirmed_by,confirmed_at,created_by,updated_by) values
('99300000-0000-0000-0000-000000005d02','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-000000005d01','99300000-0000-0000-0000-0000000000e1','PO-CC-1','2026-11-01','CONFIRMED','99300000-0000-0000-0000-0000000000a1',now(),'99300000-0000-0000-0000-0000000000a1',now(),'99300000-0000-0000-0000-0000000000a1',now(),'99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1');

-- money: accepted quotation 100.000, collected 60.000 → 40.000 outstanding.
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('99300000-0000-0000-0000-000000005e01','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','Q-CC-1',1,'ACCEPTED','CC Customer','EV-CC-1','Grand Hall',300,'2026-11-15 18:00+04','2026-11-16 00:00+04','Muscat',100.000,60.000,40.000,'99810000-0000-0000-0000-000000000001','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1',now());
update public.events set accepted_quotation_id='99300000-0000-0000-0000-000000005e01' where id='99300000-0000-0000-0000-0000000000e1';
insert into public.customer_payments(organization_id,event_id,amount,payment_method,paid_at,status,recorded_by,idempotency_key,request_fingerprint) values
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1',60.000,'CASH',now(),'RECORDED','99300000-0000-0000-0000-0000000000a1','99820000-0000-0000-0000-000000000001',repeat(md5('cc-pay-1'),2));

-- Face fixtures prepared as the test superuser (objects in the private bucket
-- exactly as the storage API would create them BEFORE the punch command).
insert into storage.objects(bucket_id, name, owner) values
('attachments','99300000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/face-in.jpg','99300000-0000-0000-0000-0000000000a2'),
('attachments','99300000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/face-in2.jpg','99300000-0000-0000-0000-0000000000a2');

-- Host 01 is pre-enrolled (the enrollment RPC re-enrollment test below runs
-- AFTER this row exists, proving a superseding enrollment invalidates pending
-- matches — so no attempt row is seeded here).
insert into public.staff_face_enrollments(id,organization_id,staff_member_id,provider_code,model_version,template_ref,capture_count,status,enrolled_by) values
('99300000-0000-0000-0000-00000000e001','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f001','TEST_PROVIDER','v1','device-token-1',4,'ACTIVE','99300000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 1–7. Canonical readiness — §54.
-- ---------------------------------------------------------------------------
select is((select r->>'status' from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  'NOT_READY','§54: four operational gaps ⇒ NOT_READY');
select is((select r->'reasons' @> '["STAFF_SHORTAGE","EQUIPMENT_SHORTAGE","CONSUMABLE_SHORTAGE","PROCUREMENT_PENDING"]'::jsonb
              and jsonb_array_length(r->'reasons') = 4
           from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  true,'§54: exactly the four canonical reason codes');
select is((select (r->>'staff_required')::int from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  20,'required staff is the plan (20)');
select is((select (r->>'staff_assigned')::int from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  18,'assigned staff is exact (18)');
select is((select r->'reasons' ? 'FINANCIAL_OUTSTANDING'
           from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  false,'no financial reason code can ever appear');
select is((select count(*)::int from public.event_readiness_batch('99300000-0000-0000-0000-0000000000a1',array['99300000-0000-0000-0000-0000000000e1']::uuid[])),
  1,'batch wrapper still returns per-event rows');
select is((select status from public.event_readiness_batch('99300000-0000-0000-0000-0000000000a1',array['99300000-0000-0000-0000-0000000000e1']::uuid[])),
  'NOT_READY','batch equals the core status — one formula, two doors');

-- ---------------------------------------------------------------------------
-- 8–12. Command center: one round trip; money visible per capability only.
-- ---------------------------------------------------------------------------
select is((select (public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'commercial')->>'outstanding'),
  '40.000','owner sees exact outstanding decimal text');
select is((select ((public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'operational')->'staff_assigned')::text),
  '18','command center embeds the canonical staff math');
select is((select public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'next_action'->>'code'),
  'COMPLETE_STAFF_ASSIGNMENT','next action is the highest-priority blocker (server-chosen)');

set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select (public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'commercial')->>'outstanding'),
  null,'WAREHOUSE role: no amount disclosure');
select is((select (public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'commercial')->>'attention'),
  'true','WAREHOUSE role still sees the boolean attention flag (routing only)');

set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 13–15. §54 resolution: close the four gaps; READY with money still open.
-- These are plain bookkeeping writes for the FIXTURE (the product surface for
-- them is command-only, like every other test here that seeds via postgres).
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by)
select ('99300000-0000-0000-0000-0000e101' || lpad(i::text,4,'0'))::uuid,
       '99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1',
       ('99300000-0000-0000-0000-00000000f0' || lpad(i::text,2,'0'))::uuid,
       'HOST','2026-11-15 18:00+04','2026-11-16 00:00+04','PER_EVENT',25,25,'ACTIVE',
       ('99510000-0000-0000-0000-00000000' || lpad(i::text,4,'0'))::uuid,
       '99300000-0000-0000-0000-0000000000a1'
from generate_series(19,20) as i;
insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,status,idempotency_key,created_by) values
('99300000-0000-0000-0000-00000000b202','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-0000000000b1',1,'2026-11-15 17:00+04','2026-11-16 01:00+04','ACTIVE','99610000-0000-0000-0000-000000000002','99300000-0000-0000-0000-0000000000a1');
insert into public.consumable_movements(id,organization_id,stock_item_id,event_id,movement_kind,quantity,actor_id,idempotency_key,request_fingerprint) values
('99300000-0000-0000-0000-000000005c03','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-000000005c01','99300000-0000-0000-0000-0000000000e1','ISSUE_TO_EVENT',3,'99300000-0000-0000-0000-0000000000a1','99710000-0000-0000-0000-000000000003',repeat(md5('cc-mov-3'),2));
update public.procurement_orders set status='RECEIVED' where id='99300000-0000-0000-0000-000000005d02';
set local role authenticated;

select is((select r->>'status' from public.event_readiness('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1') r),
  'READY','§54: all four operational gaps closed ⇒ READY');
select is((select (public.event_command_center('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')->'commercial')->>'outstanding'),
  '40.000','…while the balance is STILL outstanding under READY (money must not block readiness)');
select lives_ok($$select public.transition_event_status('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','DISPATCHED')$$,
  'the dispatch gate follows the same canonical status (READY ⇒ no override needed)');

-- ---------------------------------------------------------------------------
-- 16–21. Enrollment governance.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.enroll_staff_face('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f001'::uuid,'TEST_PROVIDER','v2','device-token-9',5)$$,
  'owner can (re)enroll — the command stores metadata only');
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.enroll_staff_face('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f002'::uuid,'TEST_PROVIDER','v1','t2',4)$$,
  '42501','NOT_AUTHORIZED','SUPERVISOR cannot enroll faces (staff.manage is OWNER/MANAGER only)');
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from information_schema.columns c
   where c.table_schema='public' and c.table_name='staff_face_enrollments'
     and c.data_type in ('bytea','blob')),
  0,'the enrollment table has NO binary column — biometric bytes never exist server-side');
select is((select jsonb_typeof(public.get_staff_face_enrollment('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f001'::uuid))),
  'object','profile metadata read returns the enrollment state');
select is((select public.get_staff_face_enrollment('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f005'::uuid)->>'status'),
  'NONE','unenrolled hosts read NONE (no row ⇒ honest absence, not zero)');

set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 22–24. Candidate scope + server revalidation (§53).
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.event_attendance_candidates('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')),
  1,'candidates = org ∩ assigned ∩ ACTIVE-enrolled (only Host 01)');
select throws_ok($$select public.record_face_match_attempt('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','CHECK_IN','99300000-0000-0000-0000-00000000f019'::uuid,'TEST_PROVIDER','0.99')$$,
  '23503','CANDIDATE_MISMATCH','unassigned host is refused even if a client claims a match');
select throws_ok($$select public.record_face_match_attempt('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','CHECK_IN','99300000-0000-0000-0000-00000000f002'::uuid,'TEST_PROVIDER','0.99')$$,
  '23503','CANDIDATE_MISMATCH','assigned-but-unenrolled host is refused too');

-- ---------------------------------------------------------------------------
-- 25–31. The confirmed, assisted check-in. A REAL attempt is minted through
-- the RPC (full success path), then the punch consumes a fresh fixed-id row —
-- minting and consumption both proven without client-side id capture.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_face_match_attempt('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','CHECK_IN','99300000-0000-0000-0000-00000000f001'::uuid,'TEST_PROVIDER','0.97')$$,
  'RPC mints an attempt for a valid, enrolled, assigned host');
set local role postgres;
select is((select count(*)::int from public.face_match_attempts f
   where f.staff_member_id='99300000-0000-0000-0000-00000000f001'::uuid and f.event_id='99300000-0000-0000-0000-0000000000e1' and f.status='MATCHED'),
  1,'the minted attempt persisted as exactly one fresh MATCHED row');
insert into public.face_match_attempts(id,organization_id,event_id,staff_member_id,action,provider_code,confidence_label,status,attempted_by) values
('99300000-0000-0000-0000-00000000a001','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-00000000f001','CHECK_IN','TEST_PROVIDER','0.97','MATCHED','99300000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.clock_staff_in('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-00000000f001'::uuid,null::uuid,null::public.staff_shift,null,
  '99300000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/face-in.jpg','face-in.jpg','image/jpeg',4321,gen_random_uuid(),
  'FACE_ASSISTED','99300000-0000-0000-0000-00000000a001'::uuid)$$,
  'face-assisted clock-in succeeds through the confirming office user');
set local role postgres;
select is((select a.check_in_method::text from public.staff_attendance a
   where a.staff_member_id='99300000-0000-0000-0000-00000000f001'::uuid and a.event_id='99300000-0000-0000-0000-0000000000e1'),
  'FACE_ASSISTED','the attendance row records the assisted method');
select is((select a.confirmed_by is not null from public.staff_attendance a
   where a.staff_member_id='99300000-0000-0000-0000-00000000f001'::uuid and a.event_id='99300000-0000-0000-0000-0000000000e1'),
  true,'the confirming office user is recorded');
select is((select count(*)::int from public.face_match_attempts f
   where f.id='99300000-0000-0000-0000-00000000a001'::uuid and f.status='CONSUMED'),
  1,'the match attempt was consumed exactly once');
set local role authenticated;
select throws_ok($$select public.clock_staff_in('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-00000000f001'::uuid,null::uuid,null::public.staff_shift,null,
  '99300000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/face-in2.jpg','face-in2.jpg','image/jpeg',4321,gen_random_uuid(),
  'FACE_ASSISTED','99300000-0000-0000-0000-00000000a001'::uuid)$$,
  '23505','FACE_MATCH_ALREADY_CONSUMED','single-use: a consumed match can never create a second row');
set local role postgres;
select is((select f.confidence_label from public.face_match_attempts f where f.id='99300000-0000-0000-0000-00000000a001'::uuid),
  '0.97','the provider label is relayed verbatim — never recomputed');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 31–33. Manual path first-class (no enrollment needed).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.clock_staff_in('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-00000000f003'::uuid,null::uuid,null::public.staff_shift,null,
  '99300000-0000-0000-0000-0000000000a1/ATTENDANCE_CHECKIN/staff_attendance/face-in2.jpg','face-in2.jpg','image/jpeg',4321,gen_random_uuid())$$,
  'manual roster punch for a NON-enrolled host works exactly like before');
set local role postgres;
select is((select a.check_in_method::text from public.staff_attendance a
   where a.staff_member_id='99300000-0000-0000-0000-00000000f003'::uuid and a.event_id='99300000-0000-0000-0000-0000000000e1'),
  'MANUAL','the manual method label is explicit');
select is((select count(*)::int from public.staff_attendance a
   where a.staff_member_id='99300000-0000-0000-0000-00000000f003'::uuid and a.match_attempt_id is not null),
  0,'manual punches carry no match metadata');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- 34–37. Wage-free record command + wage-free status projection.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.record_staff_attendance('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','99300000-0000-0000-0000-00000000f004'::uuid,null::uuid,'2026-11-15','EVENING','2026-11-15 18:00+04','2026-11-15 23:00+04',0,'PRESENT','derived rates',gen_random_uuid())$$,
  'record_staff_attendance works with NO wage parameters at all');
set local role postgres;
select is((select a.earned_amount from public.staff_attendance a
   where a.staff_member_id='99300000-0000-0000-0000-00000000f004'::uuid and a.event_id='99300000-0000-0000-0000-0000000000e1'),
  25.000::numeric,'earned derives from the assignment override (PER_EVENT 25) in SQL');
set local role authenticated;
select is((select count(*)::int > 0 from public.event_attendance_status('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')),
  true,'supervisor reads the operational attendance status rows');
select throws_ok($$select wage_rate from public.event_attendance_status('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')$$,
  '42703',null,'the status projection has NO wage column to leak');

-- ---------------------------------------------------------------------------
-- 38–40. Revocation kills scope + pending attempts.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.revoke_staff_face('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-00000000f001'::uuid,'left the program')$$,
  'owner revokes the enrollment');
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.event_attendance_candidates('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1')),
  0,'revoked hosts leave the candidate scope at once');
select throws_ok($$select public.record_face_match_attempt('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e1','CHECK_OUT','99300000-0000-0000-0000-00000000f001'::uuid,'TEST_PROVIDER','0.9')$$,
  '23503','CANDIDATE_MISMATCH','a revoked host cannot produce a fresh attempt either');

-- ---------------------------------------------------------------------------
-- 41–45. Today collections + the Muscat midnight boundary (§55).
-- ---------------------------------------------------------------------------
-- Fixtures for the money projections are written by the OWNER under the org
-- RLS policies.
set local role postgres;
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('99300000-0000-0000-0000-0000000000e2','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000c1','EV-CC-2','Today Event','2026-11-15 18:00+04','2026-11-15 23:00+04',50,'Muscat','DISPATCHED','99400000-0000-0000-0000-000000000002','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1'),
('99300000-0000-0000-0000-0000000000e3','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000c1','EV-CC-3','Yesterday Late','2026-11-14 23:30+04','2026-11-15 02:00+04',50,'Muscat','RETURNING','99400000-0000-0000-0000-000000000003','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1'),
('99300000-0000-0000-0000-0000000000e4','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000c1','EV-CC-4','Closed Ops','2026-11-14 10:00+04','2026-11-14 16:00+04',50,'Muscat','CLOSED','99400000-0000-0000-0000-000000000004','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('99300000-0000-0000-0000-000000005e02','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e2','Q-CC-2',1,'ACCEPTED','CC Customer','EV-CC-2','Today Event',50,'2026-11-15 18:00+04','2026-11-15 23:00+04','Muscat',30.000,10.000,20.000,'99810000-0000-0000-0000-000000000002','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1',now()),
('99300000-0000-0000-0000-000000005e03','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e3','Q-CC-3',1,'ACCEPTED','CC Customer','EV-CC-3','Yesterday Late',50,'2026-11-14 23:30+04','2026-11-15 02:00+04','Muscat',20.000,10.000,10.000,'99810000-0000-0000-0000-000000000003','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1',now()),
('99300000-0000-0000-0000-000000005e04','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e4','Q-CC-4',1,'ACCEPTED','CC Customer','EV-CC-4','Closed Ops',50,'2026-11-14 10:00+04','2026-11-14 16:00+04','Muscat',10.000,5.000,5.000,'99810000-0000-0000-0000-000000000004','99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000a1',now());
update public.events e set accepted_quotation_id = q.id
from public.quotations q
where q.event_id = e.id and q.organization_id = e.organization_id
  and e.id in ('99300000-0000-0000-0000-0000000000e2','99300000-0000-0000-0000-0000000000e3','99300000-0000-0000-0000-0000000000e4');
insert into public.customer_payments(organization_id,event_id,amount,payment_method,paid_at,status,recorded_by,idempotency_key,request_fingerprint) values
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e2',15.000,'CASH',now(),'RECORDED','99300000-0000-0000-0000-0000000000a1','99820000-0000-0000-0000-000000000002',repeat(md5('cc-pay-2'),2)),
('99300000-0000-0000-0000-0000000000a1','99300000-0000-0000-0000-0000000000e4',10.000,'CASH',now(),'RECORDED','99300000-0000-0000-0000-0000000000a1','99820000-0000-0000-0000-000000000004',repeat(md5('cc-pay-4'),2));
set local role authenticated;
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- p_now = 2026-11-14T20:10Z = 2026-11-15 00:10 Asia/Muscat. The day boundary
-- is computed SERVER-SIDE: e3 (started 23:30 Muscat on the 14th) is now
-- overdue; e2 (18:00 Muscat on the 15th) is today.
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.today_collections('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z')),
  3,'collections lists e1(40) + e2(15) + e3(20) at the midnight boundary');
select is((select event_number from public.today_collections('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') limit 1),
  'EV-CC-3','deterministic ordering: overdue first');
select is((select overdue from public.today_collections('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') where event_number='EV-CC-2'),
  false,'a Muscat-today event is not overdue at 00:10');
select is((select overdue from public.today_collections('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') where event_number='EV-CC-3'),
  true,'the 23:30-Muscat event is overdue on the new Muscat day');

set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select count(*)::int from public.today_collections('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z')$$,
  '42501','NOT_AUTHORIZED','WAREHOUSE is refused the collections ledger outright');
set local "request.jwt.claims"='{"sub":"99300000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 46–48. Closure candidates (lifecycle semantics) + gated refusal.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.today_closure_candidates('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z')),
  2,'both close flows are surfaced for authorized offices');
select is((select action from public.today_closure_candidates('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') where event_number='EV-CC-3'),
  'CLOSE_OPS','RETURNING + nothing outstanding ⇒ operational close ready');
select is((select cardinality(blockers) from public.today_closure_candidates('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') where event_number='EV-CC-3'),
  0,'no blockers for a clean operational close');
select is((select action from public.today_closure_candidates('99300000-0000-0000-0000-0000000000a1', timestamp with time zone '2026-11-14T20:10:00Z') where event_number='EV-CC-4'),
  'CLOSE_FINANCIAL','CLOSED + fully collected + unclosed ⇒ financial close ready');

select * from finish();
rollback;
