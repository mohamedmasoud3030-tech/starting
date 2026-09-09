-- ============================================================================
-- 0100/0101 — staff_leaves register pgTAP.
--
-- HR leave/absence register contract:
--   * read gate = can_read_cost (payroll/cost roles) — same as the roster;
--   * write/decide gate = has_permission(org, 'staff.manage');
--   * only PENDING has no decider; APPROVED/REJECTED/CANCELLED require
--     decided_by + decided_at (0101 makes CANCELLED a real decision);
--   * no DELETE grant to authenticated (append-only register);
--   * check constraints: leave_type/status/dates shape/days_count.
-- ============================================================================
begin;
select plan(14);

-- Seeded identities (mirrors delegated_permissions.test.sql harness).
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-000000000001','authenticated','authenticated','hr-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-000000000002','authenticated','authenticated','hr-sup-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-000000000003','authenticated','authenticated','hr-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('cb000000-0000-0000-0000-0000000000a1','HR Org A'),
('cb000000-0000-0000-0000-0000000000b1','HR Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-000000000001','OWNER'),
('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-000000000002','SUPERVISOR'),
('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-000000000003','OWNER');
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('cb000000-0000-0000-0000-0000000000f1','cb000000-0000-0000-0000-0000000000a1','HR Host A','HOST',true,'PER_EVENT',100.000);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1) OWNER records a pending request (recorded_by defaults to the acting user).
select lives_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, days_count, reason, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','ANNUAL',current_date,2,'اجازة','PENDING')$$,'OWNER records a pending leave');
-- 2) and can read it (cost gate allows).
select is((select count(*)::int from public.staff_leaves where organization_id='cb000000-0000-0000-0000-0000000000a1'),1,'OWNER reads the register');
-- 3) Approving without a decider violates the decision shape.
select throws_ok($$update public.staff_leaves set status='APPROVED' where organization_id='cb000000-0000-0000-0000-0000000000a1'$$,'23514',null,'APPROVED requires decided_by/decided_at');
-- 4) CANCELLING a pending record records who cancelled (0101 regression guard).
select lives_ok($$update public.staff_leaves set status='CANCELLED', decided_by='cb000000-0000-0000-0000-000000000001', decided_at=now()
  where organization_id='cb000000-0000-0000-0000-0000000000a1'$$,'CANCELLED is a decision under 0101');
-- 5) Full approve path works.
select lives_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, days_count, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','SICK',current_date,1,'PENDING')$$,'record second request');
select lives_ok($$update public.staff_leaves set status='APPROVED', decided_by='cb000000-0000-0000-0000-000000000001', decided_at=now()
  where status='PENDING' and organization_id='cb000000-0000-0000-0000-0000000000a1'$$,'approve with decider');
select is((select count(*)::int from public.staff_leaves where organization_id='cb000000-0000-0000-0000-0000000000a1'),2,'two records in register');

-- 6) enum/check constraints reject invalid input.
select throws_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','OVERTIME',current_date,'PENDING')$$,'23514',null,'invalid leave_type rejected');
select throws_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, end_date, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','ANNUAL',current_date,current_date - 1,'PENDING')$$,'23514',null,'end before start rejected');
-- 7) Register is append-only from the client: no DELETE grant.
select throws_ok($$delete from public.staff_leaves where organization_id='cb000000-0000-0000-0000-0000000000a1'$$,'42501',null,'no client delete on the register');

-- 8) SUPERVISOR preset: no cost read, no staff.manage write.
set local "request.jwt.claims"='{"sub":"cb000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.staff_leaves where organization_id='cb000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR sees no register rows');
select throws_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','ANNUAL',current_date,'PENDING')$$,'42501',null,'SUPERVISOR cannot record leaves');

-- 9) Cross-org OWNER: isolation holds.
set local "request.jwt.claims"='{"sub":"cb000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.staff_leaves where organization_id='cb000000-0000-0000-0000-0000000000a1'),0,'org-B OWNER sees no org-A rows');
select throws_ok($$insert into public.staff_leaves (organization_id, staff_member_id, leave_type, start_date, status)
  values ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000f1','ANNUAL',current_date,'PENDING')$$,'42501',null,'org-B OWNER cannot record org-A leaves');

select * from finish();
rollback;
