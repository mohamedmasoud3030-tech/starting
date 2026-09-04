-- ============================================================================
-- pgTAP — owner-delegated capabilities (migration 0079)
-- Run with: supabase test db   (authoritative acceptance evidence)
--
-- Covers the Pillar A security model at the PostgreSQL boundary:
--   * OWNER has every capability and full control
--   * OWNER configures per-member overrides; capability grants work
--   * revocation blocks immediately at the DB layer
--   * non-owners can never self-grant (no direct table access, OWNER-only RPC)
--   * OWNER permissions and membership are immutable (no self-demotion, no
--     second owner)
--   * cross-org management is rejected
--   * cost / payroll visibility are real data boundaries (grant → rows,
--     no grant → zero rows; payroll.read does not imply payroll.pay)
--   * inactive organization confers no capabilities (frozen, not deleted)
--   * UI hiding is not security: direct table writes are RLS-blocked
--   * invitation/claim provisioning: exact email, single use, OWNER-only
-- ============================================================================

begin;
select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner / postgres, before switching role)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'dp-owner-a@test.local',   'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dp-manager-a@test.local', 'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'dp-supervisor-a@test.local','x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dp-warehouse-a@test.local','x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'dp-inactive-a@test.local', 'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'dp-owner-b@test.local',   'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'dp-supervisor-b@test.local','x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'dp-owner-c@test.local',   'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'dp-assistant-a@test.local','x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'dp-newhire-a@test.local', 'x', now(), now(), now(), '{}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'dp-outsider@test.local',  'x', now(), now(), now(), '{}', '{}', false);

insert into public.organizations (id, name, is_active) values
  ('97000000-0000-0000-0000-0000000000a1', 'DP Org A', true),
  ('97000000-0000-0000-0000-0000000000b2', 'DP Org B', true),
  ('97000000-0000-0000-0000-0000000000c3', 'DP Org C (inactive)', false);

insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000001', 'OWNER',      'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000002', 'MANAGER',    'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000003', 'SUPERVISOR', 'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000004', 'WAREHOUSE',  'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000006', 'MANAGER',    'INACTIVE'),
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000010', 'SUPERVISOR', 'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-000000000007', 'OWNER',      'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-000000000008', 'SUPERVISOR', 'ACTIVE'),
  ('97000000-0000-0000-0000-0000000000c3', '97000000-0000-0000-0000-000000000009', 'OWNER',      'ACTIVE');

insert into public.customers (id, organization_id, name) values
  ('97000000-0000-0000-0000-0000000000c1', '97000000-0000-0000-0000-0000000000a1', 'DP Customer A');

insert into public.catalog_items (id, organization_id, name, item_type, pricing_method, cost_price, selling_price, internal_notes) values
  ('97000000-0000-0000-0000-0000000000c9', '97000000-0000-0000-0000-0000000000a1', 'DP Coffee A', 'SERVICE', 'PER_GUEST', 2.500, 3.000, 'dp cost note'),
  ('97000000-0000-0000-0000-0000000000c8', '97000000-0000-0000-0000-0000000000c3', 'DP Coffee C', 'SERVICE', 'PER_GUEST', 5.000, 6.000, 'dp inactive org');

insert into public.staff_members (id, organization_id, name, phone, staff_type, default_compensation_method, default_rate) values
  ('97000000-0000-0000-0000-0000000000a9', '97000000-0000-0000-0000-0000000000a1', 'DP Host', '+96890000001', 'HOST', 'PER_DAY', 20.000);

insert into public.host_payouts (organization_id, staff_member_id, event_id, amount, payout_date, payment_method, reference, recorded_by, idempotency_key, request_fingerprint) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-0000000000a9', null, 20.000, '2026-09-01', 'CASH', 'DP-PO-1', '97000000-0000-0000-0000-000000000001', '97400000-0000-0000-0000-000000000001', repeat('a', 64));

-- ---------------------------------------------------------------------------
-- 1) OWNER: full control
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'cost.visibility'),'true','OWNER has cost.visibility');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'settings.manage'),'true','OWNER has settings.manage');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'quotation.issue'),'true','OWNER has quotation.issue');
select is((select count(*)::int from public.catalog_items where organization_id='97000000-0000-0000-0000-0000000000a1'),1,'OWNER reads cost data');

-- ---------------------------------------------------------------------------
-- 2) Presets: role default capability sets are unchanged
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'cost.visibility'),'false','SUPERVISOR preset has no cost.visibility');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'warehouse.dispatch'),'true','SUPERVISOR preset has warehouse.dispatch');
select is((select count(*)::int from public.catalog_items where organization_id='97000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR preset sees no cost data');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'stock.adjust'),'false','WAREHOUSE preset has no stock.adjust');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'consumable.manage'),'true','WAREHOUSE preset has consumable.manage');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000010","role":"authenticated"}';
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'quotation.manage'),'false','assistant SUPERVISOR preset has no quotation.manage');

-- ---------------------------------------------------------------------------
-- 3) OWNER configures the assistant; the capability grant works
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility',true)$$,'OWNER grants cost.visibility to the assistant');
select is(
  (select count(*)::int from public.member_capability_list('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010') where capability='cost.visibility' and source='OVERRIDE' and allowed),
  1, 'override is recorded with source OVERRIDE');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000010","role":"authenticated"}';
select is((select count(*)::int from public.catalog_items where organization_id='97000000-0000-0000-0000-0000000000a1'),1,'granted cost.visibility unlocks cost data');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'cost.visibility'),'true','my_capabilities reflects the override');
select throws_ok($$insert into public.catalog_items (organization_id, name, item_type, pricing_method) values ('97000000-0000-0000-0000-0000000000a1', 'sneak', 'SERVICE', 'FIXED')$$,'42501',null,'cost.visibility does not imply catalog.manage');
select lives_ok($$update public.customers set notes='dp-note' where organization_id='97000000-0000-0000-0000-0000000000a1' and id='97000000-0000-0000-0000-0000000000c1'$$,'assistant keeps preset customer.manage through the RLS boundary');

-- ---------------------------------------------------------------------------
-- 4) Revocation blocks immediately at the DB layer
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.clear_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility')$$,'OWNER revokes the override');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000010","role":"authenticated"}';
select is((select count(*)::int from public.catalog_items where organization_id='97000000-0000-0000-0000-0000000000a1'),0,'revocation blocks cost reads immediately');
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')->>'cost.visibility'),'false','my_capabilities falls back to the preset');

-- ---------------------------------------------------------------------------
-- 5) No self-escalation, OWNER-only management, immutable OWNER
-- ---------------------------------------------------------------------------
select throws_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility',true)$$,'42501','NOT_AUTHORIZED','assistant cannot self-grant via the RPC');
select throws_ok($$insert into public.org_member_permissions (organization_id, user_id, capability, allowed, set_by) values ('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility',true,'97000000-0000-0000-0000-000000000010')$$,'42501',null,'assistant cannot self-grant through the permission table');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility',true)$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot manage permissions (user.manage is OWNER-only)');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000001','cost.visibility',false)$$,'23514',null,'OWNER permissions are immutable');
select throws_ok($$update public.organization_memberships set role='MANAGER' where organization_id='97000000-0000-0000-0000-0000000000a1' and user_id='97000000-0000-0000-0000-000000000001'$$,'23514',null,'OWNER cannot demote themselves');
select throws_ok($$insert into public.organization_memberships (organization_id, user_id, role, status) values ('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000002','OWNER','ACTIVE')$$,'23514',null,'a second OWNER cannot be created');
select throws_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-000000000008','cost.visibility',true)$$,'42501','NOT_AUTHORIZED','owner cannot manage another org''s members');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000010','cost.visibility',true)$$,'42501','NOT_AUTHORIZED','org-B owner cannot manage org-A members');

-- ---------------------------------------------------------------------------
-- 6) Inactive organization freezes capabilities; inactive membership has none
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000009","role":"authenticated"}';
select is((select public.my_capabilities('97000000-0000-0000-0000-0000000000c3')->>'cost.visibility'),'false','OWNER of an inactive org has no cost.visibility');
select is((select count(*)::int from public.catalog_items where organization_id='97000000-0000-0000-0000-0000000000c3'),0,'OWNER of an inactive org reads no data');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$select public.my_capabilities('97000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','inactive membership gets no capability report');

-- ---------------------------------------------------------------------------
-- 7) UI hiding is not security: direct table writes are RLS-blocked
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$insert into public.customers (organization_id, name) values ('97000000-0000-0000-0000-0000000000a1', 'sneak-customer')$$,'42501',null,'WAREHOUSE cannot insert customers despite any UI state');

-- ---------------------------------------------------------------------------
-- 8) Invitation / claim provisioning
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_org_invitation('97000000-0000-0000-0000-0000000000a1','dp-newhire-a@test.local','SUPERVISOR')$$,'OWNER creates an invitation');
select is((select count(*)::int from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING'),1,'invitation is pending and visible to the OWNER');
select is((select length(code) from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING'),8,'invitation code is 8 characters');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1'),0,'non-OWNER members cannot see invitation codes');
select throws_ok($$select public.create_org_invitation('97000000-0000-0000-0000-0000000000a1','x@test.local','WAREHOUSE')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot create invitations');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok($$select public.revoke_org_invitation('97000000-0000-0000-0000-0000000000a1',(select id from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING'))$$,'42501','NOT_AUTHORIZED','cross-org invitation revocation is rejected');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*)::int from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1'),0,'non-members see no invitation rows');

-- A non-invitee (different email) cannot claim: the code is read as OWNER
-- inside the block, then the claim is attempted as the outsider.
select throws_ok($$
do $do$
declare v_code text;
begin
  perform set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
  v_code := (select code from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING');
  perform set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000012","role":"authenticated"}',true);
  perform public.claim_org_invitation(v_code);
end;
$do$
$$,'23514',null,'a non-invitee email cannot claim the invitation');

-- The real claim: the invitee's exact email matches.
select lives_ok($$
do $do$
declare v_code text;
begin
  perform set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
  v_code := (select code from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING');
  perform set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000011","role":"authenticated"}',true);
  perform public.claim_org_invitation(v_code);
end;
$do$
$$,'the invitee claims the invitation with the exact email');

set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select role from public.organization_memberships where organization_id='97000000-0000-0000-0000-0000000000a1' and user_id='97000000-0000-0000-0000-000000000011'),'SUPERVISOR','claim creates the membership with the preset role');
select is((select count(*)::int from public.org_invitations where organization_id='97000000-0000-0000-0000-0000000000a1' and status='PENDING'),0,'the invitation is single-use');

-- ---------------------------------------------------------------------------
-- 9) Payroll visibility is a real boundary (and does not imply payroll.pay)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.host_payout_summaries where organization_id='97000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR preset sees no payroll rows');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_member_permission('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000003','payroll.read',true)$$,'OWNER grants payroll.read to SUPERVISOR');
select is((select allowed from public.member_capability_list('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-000000000003') where capability='payroll.pay'),false,'payroll.read does not imply payroll.pay');
set local "request.jwt.claims" = '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.host_payout_summaries where organization_id='97000000-0000-0000-0000-0000000000a1'),1,'granted payroll.read unlocks the payroll read model');
select throws_ok($$select public.void_host_payout('97000000-0000-0000-0000-0000000000a1',(select payout_id from public.host_payout_summaries where organization_id='97000000-0000-0000-0000-0000000000a1'),'mistake','97400000-0000-0000-0000-000000000002')$$,'42501','NOT_AUTHORIZED','payroll.read does not allow payroll actions (void)');

select * from finish();
rollback;
