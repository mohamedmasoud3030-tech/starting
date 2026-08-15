-- ============================================================================
-- S6 — customer payments, voiding, event balance and economics.
-- ============================================================================
begin;
select plan(44);

-- Fixture: org A has every application role; org B proves tenant boundaries.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000001','authenticated','authenticated','s6-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000002','authenticated','authenticated','s6-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000003','authenticated','authenticated','s6-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000004','authenticated','authenticated','s6-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000005','authenticated','authenticated','s6-accountant-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','96000000-0000-0000-0000-000000000006','authenticated','authenticated','s6-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('96000000-0000-0000-0000-0000000000a1','S6 Org A'),
('96000000-0000-0000-0000-0000000000b1','S6 Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-000000000001','OWNER'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-000000000002','MANAGER'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-000000000003','SUPERVISOR'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-000000000004','WAREHOUSE'),
('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-000000000005','ACCOUNTANT'),
('96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-000000000006','OWNER');
insert into public.customers(id,organization_id,name) values
('96000000-0000-0000-0000-0000000000c1','96000000-0000-0000-0000-0000000000a1','Customer A'),
('96000000-0000-0000-0000-0000000000c2','96000000-0000-0000-0000-0000000000b1','Customer B');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000c1','EV-S6-A','Event A','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','96100000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001'),
('96000000-0000-0000-0000-0000000000e2','96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000c2','EV-S6-B','Event B','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','CONFIRMED','96100000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006'),
('96000000-0000-0000-0000-0000000000e3','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000c1','EV-S6-A2','Event A2','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','DRAFT','96100000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('96000000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1','QT-S6-A',1,'ACCEPTED','Customer A','EV-S6-A','Event A',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',500.000,300.000,200.000,'96100000-0000-0000-0000-000000000011','96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001',now()),
('96000000-0000-0000-0000-0000000000f2','96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000e2','QT-S6-B',1,'ACCEPTED','Customer B','EV-S6-B','Event B',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Salalah',400.000,200.000,200.000,'96100000-0000-0000-0000-000000000012','96000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006',now());
update public.events set accepted_quotation_id='96000000-0000-0000-0000-0000000000f1' where id='96000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='96000000-0000-0000-0000-0000000000f2' where id='96000000-0000-0000-0000-0000000000e2';
insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
('96000000-0000-0000-0000-0000000000d1','96000000-0000-0000-0000-0000000000a1','S6 Supplier','ACTIVE','96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001');
insert into public.procurement_orders(id,organization_id,supplier_id,event_id,order_number,order_date,status,agreed_total_cost,supplier_name_snapshot,approved_by,approved_at,created_by,updated_by) values
('96000000-0000-0000-0000-0000000000d2','96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000d1','96000000-0000-0000-0000-0000000000e1','PO-S6-A',current_date,'APPROVED',50.000,'S6 Supplier','96000000-0000-0000-0000-000000000001',now(),'96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Exact OMR validation: reject, never silently round.
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',0.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000001')$$,'P0001','INVALID_PAYMENT_AMOUNT','zero amount is rejected');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',-1.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000002')$$,'P0001','INVALID_PAYMENT_AMOUNT','negative amount is rejected');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.0001,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000003')$$,'P0001','OMR_PRECISION_EXCEEDED','amount beyond 3dp is rejected, not rounded');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',999999999.9999,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000004')$$,'P0001','OMR_PRECISION_EXCEEDED','amount beyond numeric(12,3) domain is rejected');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.000,null,null,null,now(),'96200000-0000-0000-0000-000000000005')$$,'22023','PAYMENT_METHOD_REQUIRED','payment method is required');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e3',10.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000006')$$,'P0001','PAYMENT_REQUIRES_ACCEPTED_QUOTATION','payment requires an accepted quotation');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e2',10.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000007')$$,'P0002','EVENT_NOT_FOUND','cross-org event reference is rejected');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),null)$$,'22023','IDEMPOTENCY_KEY_REQUIRED','missing idempotency key is rejected');

-- Recording and exact balance.
select lives_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',150.000,'BANK_TRANSFER','TRX-1','deposit',now(),'96200000-0000-0000-0000-000000000010')$$,'OWNER records a payment');
select lives_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',150.000,'BANK_TRANSFER','TRX-1','deposit',now(),'96200000-0000-0000-0000-000000000010')$$,'same key and payload replays');
select is((select count(*)::int from public.customer_payment_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),1,'replay creates exactly one payment');
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',175.000,'BANK_TRANSFER','TRX-1','deposit',now(),'96200000-0000-0000-0000-000000000010')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same key with different payload hard-rejects');
select is((select amount::text from public.customer_payment_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'150.000','amount is exact OMR 3dp');
select lives_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',50.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000011')$$,'second payment is recorded');
select is((select amount_paid::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'200.000','amount_paid sums RECORDED payments');
select is((select outstanding_balance::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'300.000','outstanding is accepted revenue minus paid');
select is((select accepted_revenue::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'500.000','accepted revenue is the accepted quotation total');
select is((select committed_cost::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'50.000','committed cost flows from S5 procurement');
select is((select gross_margin::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'450.000','gross margin is revenue minus committed cost');

-- Role matrix: SUPERVISOR / WAREHOUSE cannot mutate or read financial data.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000012')$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot record payments');
select is((select count(*)::int from public.customer_payment_summaries where organization_id='96000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR sees no customer payment rows');
select is((select count(*)::int from public.event_finance_summaries where organization_id='96000000-0000-0000-0000-0000000000a1'),0,'SUPERVISOR sees no event finance rows');
select throws_ok($$select count(*) from public.customer_payments where organization_id='96000000-0000-0000-0000-0000000000a1'$$,'42501',null,'SUPERVISOR cannot read the raw payment ledger');
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000013')$$,'42501','NOT_AUTHORIZED','WAREHOUSE cannot record payments');
select is((select count(*)::int from public.event_finance_summaries where organization_id='96000000-0000-0000-0000-0000000000a1'),0,'WAREHOUSE sees no event finance rows');

-- ACCOUNTANT and MANAGER may record payments.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',25.000,'CARD','CARD-9',null,now(),'96200000-0000-0000-0000-000000000014')$$,'ACCOUNTANT records a payment');
select is((select count(*)::int from public.customer_payment_summaries where organization_id='96000000-0000-0000-0000-0000000000a1'),3,'ACCOUNTANT reads payment history');
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',25.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000015')$$,'MANAGER records a payment');

-- Tenant isolation: org-B owner cannot touch org-A event.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$select public.record_customer_payment('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',10.000,'CASH',null,null,now(),'96200000-0000-0000-0000-000000000016')$$,'42501','NOT_AUTHORIZED','org-B owner cannot write org A');
select is((select count(*)::int from public.customer_payment_summaries where organization_id='96000000-0000-0000-0000-0000000000a1'),0,'org-B owner reads no org-A payment rows');

-- Append-only: clients cannot directly mutate the ledger.
set local "request.jwt.claims"='{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.customer_payments(organization_id,event_id,amount,payment_method,paid_at,recorded_by,idempotency_key,request_fingerprint) values('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000e1',1.000,'CASH',now(),'96000000-0000-0000-0000-000000000001','96200000-0000-0000-0000-000000000020',repeat('0',64))$$,'42501',null,'direct payment INSERT is denied');
select throws_ok($$update public.customer_payments set amount=999.999 where organization_id='96000000-0000-0000-0000-0000000000a1'$$,'42501',null,'direct payment UPDATE is denied');
select throws_ok($$delete from public.customer_payments where organization_id='96000000-0000-0000-0000-0000000000a1'$$,'42501',null,'direct payment DELETE is denied');
select throws_ok($$update public.payments_command_idempotency set command_name='x' where organization_id='96000000-0000-0000-0000-0000000000a1'$$,'42501',null,'idempotency register is not client-writable');

-- Voiding: guarded lifecycle transition, history preserved.
select is((select amount_paid::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'250.000','pre-void paid is exact');
select lives_ok($$select public.void_customer_payment('96000000-0000-0000-0000-0000000000a1',(select payment_id from public.customer_payment_summaries where reference='CARD-9'),'entered in error','96200000-0000-0000-0000-000000000030')$$,'ACCOUNTANT-payment can be voided by OWNER');
select is((select status::text from public.customer_payment_summaries where reference='CARD-9'),'VOIDED','voided payment is marked VOIDED');
select is((select count(*)::int from public.customer_payment_summaries where reference='CARD-9'),1,'voiding preserves history (no delete)');
select is((select amount_paid::text from public.event_finance_summaries where event_id='96000000-0000-0000-0000-0000000000e1'),'225.000','voided payment is excluded from balance');
select throws_ok($$select public.void_customer_payment('96000000-0000-0000-0000-0000000000a1',(select payment_id from public.customer_payment_summaries where reference='CARD-9'),'again','96200000-0000-0000-0000-000000000031')$$,'P0001','PAYMENT_ALREADY_VOIDED','re-voiding an already-voided payment errors');
select throws_ok($$select public.void_customer_payment('96000000-0000-0000-0000-0000000000a1',(select payment_id from public.customer_payment_summaries limit 1),'x','96200000-0000-0000-0000-000000000032')$$,'22023','PAYMENT_VOID_REASON_REQUIRED','void requires a reason of at least 3 chars');
select throws_ok($$select public.void_customer_payment('96000000-0000-0000-0000-0000000000b1',(select payment_id from public.customer_payment_summaries limit 1),'cross org','96200000-0000-0000-0000-000000000033')$$,'42501','NOT_AUTHORIZED','cross-org void is rejected');

-- Read models exclude confidential columns for operational roles.
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='customer_payment_summaries' and column_name='idempotency_key'),0,'payment summary exposes no idempotency machinery');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='event_finance_summaries' and column_name='gross_margin'),1,'finance summary exposes gross margin for cost readers');

select * from finish();
rollback;
