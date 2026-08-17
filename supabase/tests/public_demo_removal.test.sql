-- pgTAP for migration 0059: the public demo surface is gone and anonymous
-- callers have no business capability (defect D2).
begin;
select plan(7);

select ok(
  not exists (select 1 from pg_roles where rolname = 'public_demo_admin'),
  'public_demo_admin role removed'
);
select ok(
  not exists (select 1 from pg_namespace where nspname = 'app_private'),
  'app_private helper schema removed'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0,
  'anonymous role holds no table grants'
);
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where grantee = 'anon' and routine_schema = 'public' and privilege_type = 'EXECUTE'),
  0,
  'anonymous role holds no function grants'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-000000000001','authenticated','authenticated','r59-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values('98000000-0000-0000-0000-0000000000a1','R59 A');
insert into public.organization_memberships(organization_id,user_id,role) values('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-000000000001','OWNER');
insert into public.customers(id,organization_id,name) values('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000a1','C1');

set local role anon;
set local "request.jwt.claims"='{"role":"anon"}';
select ok(
  not has_function_privilege('anon', 'public.is_org_member(uuid)', 'EXECUTE'),
  'anonymous role cannot even call the membership helper'
);
select throws_ok(
  $sql$select public.is_org_member('98000000-0000-0000-0000-0000000000a1')$sql$,
  '42501', null, 'anonymous membership check is rejected'
);
select throws_ok(
  $sql$select public.create_event('98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1','X','X','2026-10-01 10:00+04','2026-10-01 12:00+04',5,'M',null,null,null,null,'98100000-0000-0000-0000-000000000001')$sql$,
  '42501', null, 'anonymous caller cannot run business commands'
);

select * from finish();
rollback;
