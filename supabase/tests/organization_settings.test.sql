-- pgTAP for migration 0061: organization_settings table, RLS and the
-- OWNER-only save command. Identity data stays editable by OWNER only and
-- readable by members; no anonymous access.
begin;
select plan(12);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000001','authenticated','authenticated','s61-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000002','authenticated','authenticated','s61-manager@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

insert into public.organizations(id,name) values('98100000-0000-0000-0000-0000000000a1','S61 A');
insert into public.organization_memberships(organization_id,user_id,role) values
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','OWNER'),
('98100000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000002','MANAGER');

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'organization_settings' and c.relkind = 'r'),
  'organization_settings table exists'
);
select ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'organization_settings'
            and column_name = 'commercial_registration'),
  'commercial_registration column exists'
);
select ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'organization_settings'
            and column_name = 'quotation_number_prefix'),
  'quotation_number_prefix column exists'
);

-- RLS is enabled.
select is(
  (select relrowsecurity from pg_class where oid = 'public.organization_settings'::regclass),
  true,
  'RLS is enabled on organization_settings'
);

-- An anonymous caller holds no table grants at all.
reset role;
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public' and table_name = 'organization_settings'),
  0,
  'anonymous holds no grants on organization_settings'
);

-- A MANAGER cannot save settings (OWNER-only command).
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated","sub":"98100000-0000-0000-0000-000000000002"}';
select throws_ok(
  $sql$select public.save_organization_settings('98100000-0000-0000-0000-0000000000a1', p_name_en := 'X')$sql$,
  '42501', null, 'MANAGER cannot save organization settings'
);

-- The OWNER can save settings.
set local "request.jwt.claims"='{"role":"authenticated","sub":"98100000-0000-0000-0000-000000000001"}';
select is(
  (public.save_organization_settings(
    '98100000-0000-0000-0000-0000000000a1',
    p_name_en := 'Masharie Jiwdat Alantalaqah',
    p_commercial_registration := '1466316',
    p_phone_primary := '98203088'
  )).name_en,
  'Masharie Jiwdat Alantalaqah',
  'OWNER saves settings and gets them back'
);

-- Upsert updates the same single row (1:1 semantics).
select is(
  (select count(*)::int from public.organization_settings where organization_id = '98100000-0000-0000-0000-0000000000a1'),
  1,
  'settings stay one row per organization (upsert)'
);

-- Empty strings are normalized to NULL (cleared fields stay cleared).
select public.save_organization_settings(
  '98100000-0000-0000-0000-0000000000a1',
  p_city := '',
  p_email := '  '
);
select is(
  (select city from public.organization_settings where organization_id = '98100000-0000-0000-0000-0000000000a1'),
  null,
  'empty city is normalized to NULL'
);

-- Numbering prefixes fall back to the technical defaults when cleared.
select is(
  (select quotation_number_prefix from public.organization_settings where organization_id = '98100000-0000-0000-0000-0000000000a1'),
  'QT',
  'quotation prefix defaults to QT'
);

-- Saving writes audit records (internal append).
select ok(
  (select count(*)::int from public.audit_events
    where organization_id = '98100000-0000-0000-0000-0000000000a1'
      and action = 'ORGANIZATION_SETTINGS_SAVED') >= 1,
  'saving settings appends an audit event'
);

-- An anonymous caller cannot run the command.
reset role;
set local role anon;
set local "request.jwt.claims"='{"role":"anon"}';
select throws_ok(
  $sql$select public.save_organization_settings('98100000-0000-0000-0000-0000000000a1')$sql$,
  '42501', null, 'anonymous cannot save organization settings'
);

select * from finish();
rollback;
