-- pgTAP for migration 0098: OWNER-only audit retention purge (defect D20).
-- The purge is per-organization, deletes only rows older than the cutoff,
-- records its own audit trail entry, and is denied to MANAGER, to other
-- organizations' owners, and to anonymous callers.
begin;
select plan(10);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000001','authenticated','authenticated','d20-owner-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000002','authenticated','authenticated','d20-manager-a@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000003','authenticated','authenticated','d20-owner-b@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values
('98100000-0000-0000-0000-0000000000a1','D20 Org A'),
('98100000-0000-0000-0000-0000000000b1','D20 Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','OWNER'),
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000002','MANAGER'),
('98100000-0000-0000-0000-0000000000b1','98100000-0000-0000-0000-000000000003','OWNER');

-- Two expired rows and one recent row for org A; one expired row for org B.
insert into public.audit_events(organization_id,user_id,action,entity,entity_id,created_at) values
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','OLD_A1','events','e1', now() - interval '3 years'),
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','OLD_A2','events','e2', now() - interval '25 months'),
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','RECENT_A','events','e3', now() - interval '1 day'),
('98100000-0000-0000-0000-0000000000b1','98100000-0000-0000-0000-000000000003','OLD_B1','events','e4', now() - interval '3 years');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'purge_old_audit_events'),
  'purge_old_audit_events exists'
);

-- Anonymous callers hold no execute grant.
reset role;
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where grantee = 'anon' and routine_schema = 'public'
      and routine_name = 'purge_old_audit_events'),
  0,
  'anonymous holds no execute grant on purge_old_audit_events'
);

-- Authenticated users hold execute (authorization is enforced inside).
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where grantee = 'authenticated' and routine_schema = 'public'
      and routine_name = 'purge_old_audit_events'),
  1,
  'authenticated holds execute grant on purge_old_audit_events'
);

-- A MANAGER of org A cannot purge.
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98100000-0000-0000-0000-000000000002"}';
select throws_ok(
  $sql$select public.purge_old_audit_events('98100000-0000-0000-0000-0000000000a1')$sql$,
  '42501', null, 'MANAGER cannot purge audit events'
);

-- Org B's OWNER cannot purge org A's audit log (cross-organization denial).
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98100000-0000-0000-0000-000000000003"}';
select throws_ok(
  $sql$select public.purge_old_audit_events('98100000-0000-0000-0000-0000000000a1')$sql$,
  '42501', null, 'other organization OWNER cannot purge org A audit events'
);

-- Org A's OWNER purges with the default 24-month cutoff.
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98100000-0000-0000-0000-000000000001"}';
select is(
  public.purge_old_audit_events('98100000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'OWNER purge deletes exactly the two expired rows'
);
-- Count assertions run as postgres (RLS-bypassing) so the row counts reflect
-- the physical tables, not the purging owner's restricted view.
reset role;
select is(
  (select count(*)::int from public.audit_events
    where organization_id = '98100000-0000-0000-0000-0000000000a1'
      and created_at < now() - interval '24 months'),
  0,
  'no rows older than the cutoff remain in org A'
);
select is(
  (select count(*)::int from public.audit_events
    where organization_id = '98100000-0000-0000-0000-0000000000a1'),
  2,
  'org A keeps the recent row plus the purge record itself'
);
select is(
  (select count(*)::int from public.audit_events
    where organization_id = '98100000-0000-0000-0000-0000000000b1'),
  1,
  'org B audit rows are untouched'
);
select ok(
  exists (select 1 from public.audit_events
          where organization_id = '98100000-0000-0000-0000-0000000000a1'
            and action = 'AUDIT_RETENTION_PURGE'),
  'the purge action is itself recorded in the audit trail'
);

select * from finish();
rollback;
