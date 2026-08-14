-- pgTAP — hardening invariants added by 0018_quick_quote_hardening.sql
begin;
select plan(10);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'qq-owner@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'qq-supervisor@test.local', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);

insert into public.organizations (id,name,is_active)
values ('10000000-0000-0000-0000-0000000000a1','Quick Quote Hardening Org',true);

insert into public.organization_memberships (organization_id,user_id,role,status) values
  ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','OWNER','ACTIVE'),
  ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002','SUPERVISOR','ACTIVE');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1. Minimal create succeeds.
select lives_ok($$
  select public.create_quick_quote(
    '10000000-0000-0000-0000-0000000000a1','Prospect A',null,null,null,
    null,null,null,null,null,null,null,
    '10000000-0000-0000-0000-000000000101'
  )
$$,'quick quote create succeeds');

-- 2. Same idempotency key + same normalized payload is a stable replay.
select lives_ok($$
  select public.create_quick_quote(
    '10000000-0000-0000-0000-0000000000a1','  Prospect A  ',null,null,null,
    null,null,null,null,null,null,null,
    '10000000-0000-0000-0000-000000000101'
  )
$$,'same idempotency payload replays');

-- 3. Replay did not duplicate the draft.
select is(
  (select count(*)::int from public.quick_quotes
    where organization_id='10000000-0000-0000-0000-0000000000a1'
      and idempotency_key='10000000-0000-0000-0000-000000000101'),
  1,
  'idempotent create stores one draft'
);

-- 4. Same key + different payload is rejected rather than silently replayed.
select throws_ok($$
  select public.create_quick_quote(
    '10000000-0000-0000-0000-0000000000a1','Different Prospect',null,null,null,
    null,null,null,null,null,null,null,
    '10000000-0000-0000-0000-000000000101'
  )
$$,'IDEMPOTENCY_KEY_REUSED',null,'idempotency key reuse with different payload rejected');

-- 5. Add one fixed-price line.
select lives_ok($$
  select public.save_quick_quote_line(
    '10000000-0000-0000-0000-0000000000a1',
    (select id from public.quick_quotes where idempotency_key='10000000-0000-0000-0000-000000000101'),
    null,'Hospitality service','SERVICE','event','FIXED',1,25.000,true
  )
$$,'fixed line saved');

-- 6. Issue the pre-event quotation.
select lives_ok($$
  select public.issue_quick_quote(
    '10000000-0000-0000-0000-0000000000a1',
    (select id from public.quick_quotes where idempotency_key='10000000-0000-0000-0000-000000000101'),
    null,null,'10000000-0000-0000-0000-000000000111'
  )
$$,'pre-event quotation issued');

-- 7. No fake Event number is written into a pre-event quotation snapshot.
select is(
  (select event_number_snapshot is null
     from public.quotations
    where id=(select quotation_id from public.quick_quotes
               where idempotency_key='10000000-0000-0000-0000-000000000101')),
  true,
  'pre-event quotation keeps event_number_snapshot null'
);

-- 8. Normal ISSUED -> ACCEPTED transition remains supported.
select lives_ok($$
  select public.accept_quick_quote(
    '10000000-0000-0000-0000-0000000000a1',
    (select quotation_id from public.quick_quotes where idempotency_key='10000000-0000-0000-0000-000000000101'),
    '10000000-0000-0000-0000-000000000121'
  )
$$,'quick quotation acceptance succeeds');

-- 9. Even privileged SQL cannot move an accepted immutable quotation backward.
reset role;
select throws_ok($$
  update public.quotations
     set status='ISSUED'
   where id=(select quotation_id from public.quick_quotes
              where idempotency_key='10000000-0000-0000-0000-000000000101')
$$,'QUOTATION_IMMUTABLE',null,'accepted quotation cannot revert to ISSUED');

-- 10. Operational staff cannot directly read commercial quick-quote drafts.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.quick_quotes
    where organization_id='10000000-0000-0000-0000-0000000000a1'),
  0,
  'SUPERVISOR cannot read quick-quote drafts'
);

select * from finish();
rollback;
