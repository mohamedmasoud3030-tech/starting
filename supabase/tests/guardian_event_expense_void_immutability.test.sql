-- ============================================================================
-- GUARDIAN regression — event-expense VOID metadata is write-once
--
-- Proves the independent-review fix in migration 0079:
--   RECORDED -> VOIDED remains valid, but voided_by / voided_at / void_reason
--   cannot be rewritten afterwards.
-- ============================================================================
begin;
select plan(4);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '97900000-0000-0000-0000-000000000001',
  'authenticated','authenticated','guardian-void@test.local','x',now(),
  now(),now(),'{}','{}',false
);

insert into public.organizations(id,name)
values ('97900000-0000-0000-0000-0000000000a1','Guardian Void Org');

insert into public.customers(id,organization_id,name)
values (
  '97900000-0000-0000-0000-0000000000c1',
  '97900000-0000-0000-0000-0000000000a1',
  'Guardian Void Customer'
);

insert into public.events(
  id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,
  guest_count,venue_name,status,idempotency_key,created_by,updated_by
) values (
  '97900000-0000-0000-0000-0000000000e1',
  '97900000-0000-0000-0000-0000000000a1',
  '97900000-0000-0000-0000-0000000000c1',
  'EV-GUARD-VOID','Guardian Void Event','X',
  '2026-10-02 10:00+04','2026-10-02 20:00+04',20,'M','CONFIRMED',
  '97900000-0000-0000-0000-000000000011',
  '97900000-0000-0000-0000-000000000001',
  '97900000-0000-0000-0000-000000000001'
);

insert into public.event_expenses(
  id,organization_id,event_id,category,amount,expense_date,description,status,
  recorded_by,idempotency_key,request_fingerprint
) values (
  '97900000-0000-0000-0000-0000000000a6',
  '97900000-0000-0000-0000-0000000000a1',
  '97900000-0000-0000-0000-0000000000e1',
  'OTHER',15.000,current_date,'guardian void immutability','RECORDED',
  '97900000-0000-0000-0000-000000000001',
  '97900000-0000-0000-0000-000000000022',repeat('9',64)
);

select lives_ok($$
  update public.event_expenses
     set status='VOIDED',
         voided_by='97900000-0000-0000-0000-000000000001',
         voided_at='2026-08-21 20:35:00+00',
         void_reason='original guardian void reason'
   where id='97900000-0000-0000-0000-0000000000a6'
$$, 'RECORDED -> VOIDED writes audit metadata once');

select throws_ok($$
  update public.event_expenses
     set void_reason='tampered reason'
   where id='97900000-0000-0000-0000-0000000000a6'
$$, '42501', 'EXPENSE_VOID_METADATA_IMMUTABLE',
'expense void_reason cannot be rewritten after void');

select throws_ok($$
  update public.event_expenses
     set voided_at='2026-08-21 21:35:00+00'
   where id='97900000-0000-0000-0000-0000000000a6'
$$, '42501', 'EXPENSE_VOID_METADATA_IMMUTABLE',
'expense voided_at cannot be rewritten after void');

select is(
  (select void_reason from public.event_expenses
    where id='97900000-0000-0000-0000-0000000000a6'),
  'original guardian void reason',
  'original VOID audit evidence remains unchanged'
);

select * from finish();
rollback;
