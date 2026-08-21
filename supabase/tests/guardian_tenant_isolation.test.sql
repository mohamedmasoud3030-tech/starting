-- ============================================================================
-- GUARDIAN — real tenant-isolation behavior probes
-- ----------------------------------------------------------------------------
-- Company A must neither read nor modify Company B through ANY path:
--   * SELECT / INSERT / UPDATE / DELETE on tables (RLS, with real JWT claims)
--   * RPC commands (SECURITY DEFINER, org_id as first argument)
--   * views / read models (invoice_summaries, event_finance_summaries)
--   * SECURITY DEFINER functions called by the anonymous role
--   * database-level triggers (append-only guards, bypassing RLS as owner)
-- Run via `supabase test db` (authoritative) or the native harness.
-- ============================================================================
begin;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, before any role switch)
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000001','authenticated','authenticated','g-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000002','authenticated','authenticated','g-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000003','authenticated','authenticated','g-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97100000-0000-0000-0000-000000000004','authenticated','authenticated','g-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('97100000-0000-0000-0000-0000000000a1','Guardian Org A'),
('97100000-0000-0000-0000-0000000000b1','Guardian Org B');

insert into public.organization_memberships(organization_id,user_id,role,status) values
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-000000000001','OWNER','ACTIVE'),
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-000000000002','MANAGER','ACTIVE'),
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-000000000003','SUPERVISOR','ACTIVE'),
('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-000000000004','OWNER','ACTIVE');

insert into public.customers(id,organization_id,name) values
('97100000-0000-0000-0000-0000000000c1','97100000-0000-0000-0000-0000000000a1','Guardian Customer A'),
('97100000-0000-0000-0000-0000000000c2','97100000-0000-0000-0000-0000000000b1','Guardian Customer B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('97100000-0000-0000-0000-0000000000e1','97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-0000000000c1','EV-G-A','Guardian Event A','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','97100000-0000-0000-0000-000000000011','97100000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000001'),
('97100000-0000-0000-0000-0000000000e2','97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000c2','EV-G-B','Guardian Event B','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','97100000-0000-0000-0000-000000000012','97100000-0000-0000-0000-000000000004','97100000-0000-0000-0000-000000000004');

insert into public.invoices(id,organization_id,event_id,invoice_number,issued_at,due_at,total_amount,currency,status,created_by,created_at,pre_vat_total,vat_registered,vat_percent,vat_amount) values
('97100000-0000-0000-0000-0000000000a4','97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-0000000000e1','INV-G-A',now(),now()+interval '14 days',500.000,'OMR','ISSUED','97100000-0000-0000-0000-000000000001',now(),500.000,false,0.000,0.000),
('97100000-0000-0000-0000-0000000000a5','97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000e2','INV-G-B',now(),now()+interval '14 days',400.000,'OMR','ISSUED','97100000-0000-0000-0000-000000000004',now(),400.000,false,0.000,0.000);

insert into public.customer_payments(organization_id,event_id,amount,payment_method,paid_at,status,recorded_by,idempotency_key,request_fingerprint,created_at) values
('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-0000000000e1',100.000,'CASH',now(),'RECORDED','97100000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000021',repeat('a',64),now()),
('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000e2',80.000,'CASH',now(),'RECORDED','97100000-0000-0000-0000-000000000004','97100000-0000-0000-0000-000000000022',repeat('b',64),now());

-- ---------------------------------------------------------------------------
-- Owner A: table-level SELECT / INSERT / UPDATE / DELETE
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.events where organization_id='97100000-0000-0000-0000-0000000000a1'),1,'owner A reads its own events');
select is((select count(*)::int from public.events where organization_id='97100000-0000-0000-0000-0000000000b1'),0,'owner A cannot SELECT org-B events');
select throws_ok($$insert into public.events(organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by)
   values('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000c2','EV-G-B2','sneaky','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'X','DRAFT','97100000-0000-0000-0000-000000000099','97100000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000001')$$,'42501',null,'owner A cannot INSERT into org-B events');
update public.events set title='hacked' where id='97100000-0000-0000-0000-0000000000e2';
set local role postgres;
select is((select title from public.events where id='97100000-0000-0000-0000-0000000000e2'),'Guardian Event B','owner A UPDATE of org-B event changes nothing');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$delete from public.events where id='97100000-0000-0000-0000-0000000000e1'$$,'42501',null,'owner A cannot DELETE its own event (no client DELETE policy)');

select throws_ok($$insert into public.customers(organization_id,name) values('97100000-0000-0000-0000-0000000000b1','sneaky')$$,'42501',null,'owner A cannot INSERT into org-B customers');
update public.customers set name='hacked' where id='97100000-0000-0000-0000-0000000000c2';
set local role postgres;
select is((select name from public.customers where id='97100000-0000-0000-0000-0000000000c2'),'Guardian Customer B','owner A UPDATE of org-B customer changes nothing');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.customer_payment_summaries where organization_id='97100000-0000-0000-0000-0000000000b1'),0,'owner A cannot SELECT org-B payments (via read model)');

-- ---------------------------------------------------------------------------
-- Owner A: RPC commands must reject org-B targets
-- ---------------------------------------------------------------------------
select throws_ok($$select public.create_event('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000c2','sneaky','WEDDING','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'X',null,null,null,null,'97100000-0000-0000-0000-000000000051')$$,'42501','NOT_AUTHORIZED','create_event for org B is rejected');
select throws_ok($$select public.transition_event_status('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000e2','PREPARING',null,null)$$,'42501','NOT_AUTHORIZED','transition_event_status on org-B event is rejected');
select throws_ok($$select public.record_customer_payment('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000e2',10.000,'CASH',null,null,now(),'97100000-0000-0000-0000-000000000052')$$,'42501','NOT_AUTHORIZED','record_customer_payment on org-B event is rejected');
select throws_ok($$select public.void_invoice('97100000-0000-0000-0000-0000000000b1','97100000-0000-0000-0000-0000000000a5','cross org', '97100000-0000-0000-0000-000000000053')$$,null,null,'void_invoice on org-B invoice is rejected');
set local role postgres;
select is((select status::text from public.invoices where id='97100000-0000-0000-0000-0000000000a5'),'ISSUED','org-B invoice untouched after cross-org void attempt');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_organization_settings('97100000-0000-0000-0000-0000000000b1','Hacked Name')$$,'42501','NOT_AUTHORIZED','save_organization_settings for org B is rejected');

-- ---------------------------------------------------------------------------
-- Views / read models: org-A rows only
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.invoice_summaries where organization_id='97100000-0000-0000-0000-0000000000a1'),1,'owner A reads own invoice summaries');
select is((select count(*)::int from public.invoice_summaries where organization_id='97100000-0000-0000-0000-0000000000b1'),0,'owner A reads no org-B invoice summaries');
select is((select count(*)::int from public.event_finance_summaries where organization_id='97100000-0000-0000-0000-0000000000a1'),1,'owner A reads own finance summaries');
select is((select count(*)::int from public.event_finance_summaries where organization_id='97100000-0000-0000-0000-0000000000b1'),0,'owner A reads no org-B finance summaries');

-- ---------------------------------------------------------------------------
-- Owner B: legitimate commands still work after ACL hardening (regression)
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select public.save_organization_settings('97100000-0000-0000-0000-0000000000b1','Guardian Org B')$$,'owner B can still save own organization settings');
select throws_ok($$select public.transition_event_status('97100000-0000-0000-0000-0000000000a1','97100000-0000-0000-0000-0000000000e1','PREPARING',null,null)$$,'42501','NOT_AUTHORIZED','owner B cannot transition org-A events');

-- ---------------------------------------------------------------------------
-- Anonymous role
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from public.events$$,'42501',null,'anon cannot SELECT business tables');
select throws_ok($$select public.save_organization_settings('97100000-0000-0000-0000-0000000000a1','anon')$$,'42501',null,'anon cannot call SECURITY DEFINER save_organization_settings');

-- ---------------------------------------------------------------------------
-- Database-level append-only guards (bypass RLS as owner)
-- ---------------------------------------------------------------------------
set local role postgres;
select throws_ok($$update public.customer_payments set amount=999.000 where id is not null and organization_id='97100000-0000-0000-0000-0000000000a1'$$,'42501','CUSTOMER_PAYMENT_FINANCIAL_IMMUTABLE','payment ledger is immutable even for the owner');
select throws_ok($$delete from public.invoices where organization_id='97100000-0000-0000-0000-0000000000a1'$$,'42501','INVOICE_APPEND_ONLY','invoices cannot be hard-deleted even by the owner');

-- ---------------------------------------------------------------------------
-- Cost separation through views
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.invoice_summaries where organization_id='97100000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR sees no invoice summaries (cost separation)');

select * from finish();
rollback;
