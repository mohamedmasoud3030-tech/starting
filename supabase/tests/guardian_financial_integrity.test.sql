-- ============================================================================
-- GUARDIAN — financial integrity behavior
-- ----------------------------------------------------------------------------
--   * reconciliation: payments ↔ invoice balance ↔ finance summaries
--   * overpayment prevention
--   * double-posting detection scan
--   * approved-document immutability (invoices, payments)
--   * hard-delete prevention on financial records (expenses, closures, audit)
--   * exact NUMERIC money
--   * document-number uniqueness
--
-- The hard-delete assertions (expenses/closures/audit) are the regression
-- tests for the Guardian hardening migration: they FAIL on the pre-fix schema
-- and must PASS on main. Run via `supabase test db` or the native harness.
-- ============================================================================
begin;
select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97200000-0000-0000-0000-000000000001','authenticated','authenticated','gfin-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values('97200000-0000-0000-0000-0000000000a1','Guardian Fin A');
insert into public.organization_memberships(organization_id,user_id,role,status) values('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-000000000001','OWNER','ACTIVE');
insert into public.customers(id,organization_id,name) values('97200000-0000-0000-0000-0000000000c1','97200000-0000-0000-0000-0000000000a1','Fin C');
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('97200000-0000-0000-0000-0000000000e1','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000c1','EV-FIN-A','Fin Event','X','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'M','CONFIRMED','97200000-0000-0000-0000-000000000011','97200000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000001');
insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('97200000-0000-0000-0000-0000000000f1','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1','QT-FIN-A',1,'ACCEPTED','Fin C','EV-FIN-A','Fin Event',50,'2026-10-01 10:00+04','2026-10-01 20:00+04','M',300.000,180.000,120.000,'97200000-0000-0000-0000-000000000012','97200000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='97200000-0000-0000-0000-0000000000f1' where id='97200000-0000-0000-0000-0000000000e1';

insert into public.invoices(id,organization_id,event_id,quotation_id,invoice_number,issued_at,due_at,total_amount,currency,status,created_by,created_at,pre_vat_total,vat_registered,vat_percent,vat_amount) values
('97200000-0000-0000-0000-0000000000a4','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1','97200000-0000-0000-0000-0000000000f1','INV-FIN-A',now(),now()+interval '14 days',300.000,'OMR','ISSUED','97200000-0000-0000-0000-000000000001',now(),300.000,false,0.000,0.000);
insert into public.invoice_installments(organization_id,invoice_id,seq,kind,due_date,amount) values
('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000a4',1,'DEPOSIT',now()+interval '7 days',100.000),
('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000a4',2,'FINAL',now()+interval '14 days',200.000);

insert into public.customer_payments(organization_id,event_id,amount,payment_method,reference,paid_at,status,recorded_by,idempotency_key,request_fingerprint,created_at) values
('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1',100.000,'CASH','PAY-FIN-1',now(),'RECORDED','97200000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000021',repeat('1',64),now());

insert into public.event_expenses(id,organization_id,event_id,category,amount,expense_date,description,status,recorded_by,idempotency_key,request_fingerprint) values
('97200000-0000-0000-0000-0000000000a6','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1','OTHER',15.000,current_date,'guardian expense','RECORDED','97200000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000022',repeat('2',64));

insert into public.audit_events(organization_id,user_id,action,entity,entity_id,metadata) values
('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-000000000001','GUARDIAN_TEST','x','x',null);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"97200000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 1-4. Reconciliation: payments ↔ invoice ↔ finance summaries
-- ---------------------------------------------------------------------------
select is((select amount_paid::text from public.event_finance_summaries where event_id='97200000-0000-0000-0000-0000000000e1'),'100.000','amount_paid equals sum of RECORDED payments');
select is((select outstanding_balance::text from public.event_finance_summaries where event_id='97200000-0000-0000-0000-0000000000e1'),'200.000','outstanding = accepted revenue - amount_paid');
select is((select remaining_balance::text from public.invoice_summaries where invoice_id='97200000-0000-0000-0000-0000000000a4'),'200.000','invoice remaining balance reconciles');
select is((select coalesce(sum(amount),0)::text from public.invoice_installment_summaries where invoice_id='97200000-0000-0000-0000-0000000000a4'),'300.000','installments reconcile to invoice total (via read model)');

-- ---------------------------------------------------------------------------
-- 5-6. OMR precision and overpayment prevention
-- ---------------------------------------------------------------------------
select throws_ok($$select public.record_customer_payment('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1',10.0001,'CASH',null,null,now(),'97200000-0000-0000-0000-000000000031')$$,'P0001','OMR_PRECISION_EXCEEDED','amounts beyond 3dp are rejected, not rounded');
select throws_ok($$select public.record_customer_payment('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1',250.000,'CASH','OVERPAY-1',null,now(),'97200000-0000-0000-0000-000000000032')$$,'P0001','OVERPAYMENT_EXCEEDS_ACCEPTED','overpayment beyond accepted revenue is rejected');

-- ---------------------------------------------------------------------------
-- 7. Document-number uniqueness
-- ---------------------------------------------------------------------------
set local role postgres;
select throws_ok($$insert into public.invoices(id,organization_id,event_id,invoice_number,issued_at,total_amount,currency,status,created_by,created_at,pre_vat_total,vat_registered,vat_percent,vat_amount)
  values('97200000-0000-0000-0000-0000000000a5','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1','INV-FIN-A',now(),1.000,'OMR','ISSUED','97200000-0000-0000-0000-000000000001',now(),1.000,false,0.000,0.000)$$,'23505',null,'duplicate invoice number per org is rejected');

-- ---------------------------------------------------------------------------
-- 8-11. Approved-document immutability + hard-delete prevention
-- ---------------------------------------------------------------------------
select throws_ok($$update public.invoices set total_amount=999.000 where id='97200000-0000-0000-0000-0000000000a4'$$,'42501','INVOICE_FINANCIAL_IMMUTABLE','issued invoice total is immutable');
select throws_ok($$delete from public.invoices where id='97200000-0000-0000-0000-0000000000a4'$$,'42501','INVOICE_APPEND_ONLY','invoices cannot be hard-deleted');
select throws_ok($$update public.customer_payments set amount=999.000 where id is not null and organization_id='97200000-0000-0000-0000-0000000000a1'$$,'42501','CUSTOMER_PAYMENT_FINANCIAL_IMMUTABLE','payment ledger is immutable');
select throws_ok($$delete from public.customer_payments where organization_id='97200000-0000-0000-0000-0000000000a1'$$,'42501','CUSTOMER_PAYMENT_APPEND_ONLY','payment ledger cannot be hard-deleted');

-- ---------------------------------------------------------------------------
-- 12-14. Event expenses: append-only for OPEN events too (regression)
-- ---------------------------------------------------------------------------
select throws_ok($$delete from public.event_expenses where id='97200000-0000-0000-0000-0000000000a6'$$,'42501','EXPENSE_APPEND_ONLY','event expenses cannot be hard-deleted even while the event is open');
select throws_ok($$update public.event_expenses set amount=999.000 where id='97200000-0000-0000-0000-0000000000a6'$$,'42501','EXPENSE_FINANCIAL_IMMUTABLE','expense amount is immutable');
select lives_ok($$update public.event_expenses set status='VOIDED', voided_by='97200000-0000-0000-0000-000000000001', voided_at=now(), void_reason='guardian test void' where id='97200000-0000-0000-0000-0000000000a6'$$,'the documented VOIDED transition stays allowed');
select is((select status::text from public.event_expenses where id='97200000-0000-0000-0000-0000000000a6'),'VOIDED','expense voided (history preserved, not deleted)');

-- ---------------------------------------------------------------------------
-- 16-19. Financial closures: append-only + reopen-only transition (regression)
-- ---------------------------------------------------------------------------
insert into public.event_financial_closures(id,organization_id,event_id,closed_by,closed_at) values
('97200000-0000-0000-0000-0000000000a7','97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1','97200000-0000-0000-0000-000000000001',now());
select throws_ok($$delete from public.event_financial_closures where id='97200000-0000-0000-0000-0000000000a7'$$,'42501','CLOSURE_APPEND_ONLY','financial closures cannot be hard-deleted');
select throws_ok($$update public.event_financial_closures set costs_at_close=0.000 where id='97200000-0000-0000-0000-0000000000a7'$$,'42501','CLOSURE_IMMUTABLE','financial closure numbers are immutable');
select lives_ok($$update public.event_financial_closures set reopened_at=now(), reopened_by='97200000-0000-0000-0000-000000000001', reopen_reason='guardian test reopen' where id='97200000-0000-0000-0000-0000000000a7'$$,'the documented REOPEN transition stays allowed');
select is((select reopened_at is not null from public.event_financial_closures where id='97200000-0000-0000-0000-0000000000a7'),true,'closure reopened through the documented transition');

-- ---------------------------------------------------------------------------
-- 20-21. Audit trail: append-only (regression)
-- ---------------------------------------------------------------------------
select throws_ok($$delete from public.audit_events where entity_id='x'$$,'42501','AUDIT_APPEND_ONLY','audit trail cannot be hard-deleted');
select throws_ok($$update public.audit_events set action='tampered' where entity_id='x'$$,'42501','AUDIT_APPEND_ONLY','audit trail cannot be updated');

-- ---------------------------------------------------------------------------
-- 22. Double-posting detection scan
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97200000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.record_customer_payment('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1',50.000,'CASH','DUP-FIN-1',null,now(),'97200000-0000-0000-0000-000000000033')$$,'first 50 OMR payment with reference DUP-FIN-1');
select lives_ok($$select public.record_customer_payment('97200000-0000-0000-0000-0000000000a1','97200000-0000-0000-0000-0000000000e1',50.000,'CASH','DUP-FIN-1',null,now(),'97200000-0000-0000-0000-000000000034')$$,'second identical 50 OMR payment (distinct key)');
select is((select count(*)::int from (
  select organization_id, event_id, reference, amount, payment_method
  from public.customer_payment_summaries
  where status='RECORDED' and reference='DUP-FIN-1'
  group by 1,2,3,4,5 having count(*)>1) d),1,'double-posting scan detects identical payment pairs (via read model)');

-- ---------------------------------------------------------------------------
-- 23-24. Exactness and void accounting
-- ---------------------------------------------------------------------------
select is((select amount::text from public.customer_payment_summaries where reference='PAY-FIN-1'),'100.000','payment amount stored as exact OMR 3dp (via read model)');
select lives_ok($$select public.void_customer_payment('97200000-0000-0000-0000-0000000000a1',(select payment_id from public.customer_payment_summaries where reference='PAY-FIN-1'),'guardian test void','97200000-0000-0000-0000-000000000035')$$,'payment can still be voided (non-destructive)');
select is((select amount_paid::text from public.event_finance_summaries where event_id='97200000-0000-0000-0000-0000000000e1'),'100.000','voided payment excluded from amount_paid (100 = 50+50 remaining)');

select * from finish();
rollback;
