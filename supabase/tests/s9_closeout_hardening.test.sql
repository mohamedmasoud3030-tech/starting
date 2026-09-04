-- ============================================================================
-- S9 closeout hardening: attendance identity, payroll semantics and invoicing
-- ============================================================================
begin;
select plan(30);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-0000000000a1','authenticated','authenticated','s9-hard-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-0000000000a2','authenticated','authenticated','s9-hard-supervisor@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','97000000-0000-0000-0000-0000000000b1','authenticated','authenticated','s9-hard-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('97000000-0000-0000-0000-0000000000a1','S9 Hardening Org A'),
('97000000-0000-0000-0000-0000000000b1','S9 Hardening Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1','OWNER'),
('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a2','SUPERVISOR'),
('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000b1','OWNER');

insert into public.customers(id,organization_id,name) values
('97000000-0000-0000-0000-0000000000c1','97000000-0000-0000-0000-0000000000a1','Hardening Customer A'),
('97000000-0000-0000-0000-0000000000c2','97000000-0000-0000-0000-0000000000b1','Hardening Customer B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-HARD-1','Hard Event 1','2026-10-01 14:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','97100000-0000-0000-0000-000000000001','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1'),
('97000000-0000-0000-0000-0000000000e2','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-HARD-2','No Quote Event','2026-10-02 14:00+04','2026-10-02 20:00+04',100,'Muscat','CONFIRMED','97100000-0000-0000-0000-000000000002','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1'),
('97000000-0000-0000-0000-0000000000e3','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000c1','EV-HARD-3','Hard Event 3','2026-10-03 14:00+04','2026-10-03 20:00+04',100,'Muscat','CONFIRMED','97100000-0000-0000-0000-000000000003','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
('97000000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','QT-HARD-1',1,'ACCEPTED','Hardening Customer A','EV-HARD-1','Hard Event 1',100,'2026-10-01 14:00+04','2026-10-01 20:00+04','Muscat',100.000,50.000,50.000,'97100000-0000-0000-0000-000000000011','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1',now()),
('97000000-0000-0000-0000-0000000000f2','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e3','QT-HARD-3',1,'ACCEPTED','Hardening Customer A','EV-HARD-3','Hard Event 3',100,'2026-10-03 14:00+04','2026-10-03 20:00+04','Muscat',50.000,25.000,25.000,'97100000-0000-0000-0000-000000000012','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a1',now());

update public.events set accepted_quotation_id='97000000-0000-0000-0000-0000000000f1' where id='97000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='97000000-0000-0000-0000-0000000000f2' where id='97000000-0000-0000-0000-0000000000e3';

insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('97000000-0000-0000-0000-0000000000a6','97000000-0000-0000-0000-0000000000a1','Hard Host 1','HOST',true,'PER_HOUR',10.000),
('97000000-0000-0000-0000-0000000000a7','97000000-0000-0000-0000-0000000000a1','Hard Host 2','HOST',true,'PER_HOUR',10.000);

insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by) values
('97000000-0000-0000-0000-0000000000d1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a6','HOST','2026-10-01 14:00+04','2026-10-01 20:00+04','PER_HOUR',10.000,60.000,'ACTIVE','97100000-0000-0000-0000-000000000021','97000000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"97000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Attendance: omitted assignment is resolved; duplicate business slot is blocked.
select lives_ok($$select public.record_staff_attendance('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a6',null,'2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:00+04',0,'PRESENT','hardening','97200000-0000-0000-0000-000000000001')$$,'omitted assignment resolves for a single active assignment');
select is((select assignment_id::text from public.staff_attendance_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and record_status <> 'VOIDED' limit 1),'97000000-0000-0000-0000-0000000000d1','attendance stores the resolved assignment');
select throws_ok($$select public.record_staff_attendance('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a6','97000000-0000-0000-0000-0000000000d1','2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:00+04',0,'PRESENT','duplicate slot','97200000-0000-0000-0000-000000000002')$$,'23505','ATTENDANCE_SLOT_ALREADY_RECORDED','different key cannot duplicate the same live attendance slot');
select throws_ok($$select public.record_staff_attendance('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a7','97000000-0000-0000-0000-0000000000d1','2026-10-02','MORNING','2026-10-02 14:00+04','2026-10-02 19:00+04',0,'PRESENT','wrong assignment','97200000-0000-0000-0000-000000000003')$$,'23503','ASSIGNMENT_MISMATCH','assignment must match the same event and staff member');
select lives_ok($$select public.void_staff_attendance('97000000-0000-0000-0000-0000000000a1',(select attendance_id from public.staff_attendance_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and record_status <> 'VOIDED' limit 1),'correction','97200000-0000-0000-0000-000000000004')$$,'live attendance can be voided');
select lives_ok($$select public.record_staff_attendance('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','97000000-0000-0000-0000-0000000000a6',null,'2026-10-01','MORNING','2026-10-01 14:00+04','2026-10-01 19:00+04',0,'PRESENT','corrected','97200000-0000-0000-0000-000000000005')$$,'void releases the business slot for a corrected repost');
select is((select attendance_count::int from public.host_event_payroll_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and staff_member_id='97000000-0000-0000-0000-0000000000a6'),1,'event attendance count excludes voided history');

-- Advances are staff-global; event payroll must not subtract the same advance per event.
select lives_ok($$select public.record_staff_advance('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a6',10.000,'2026-10-01','global advance','97200000-0000-0000-0000-000000000006')$$,'global staff advance records');
select lives_ok($$select public.record_host_payout('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a6','97000000-0000-0000-0000-0000000000e1',20.000,'2026-10-01','CASH',null,'event payout','97200000-0000-0000-0000-000000000007')$$,'event-linked host payout records');
select is((select advances_total::text from public.host_event_payroll_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and staff_member_id='97000000-0000-0000-0000-0000000000a6'),'0.000','event payroll does not duplicate global advances');
select is((select payouts_total::text from public.host_event_payroll_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and staff_member_id='97000000-0000-0000-0000-0000000000a6'),'20.000','event payroll includes only event-linked payout');
select is((select late_total::text from public.host_event_payroll_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and staff_member_id='97000000-0000-0000-0000-0000000000a6'),'30.000','event balance is due minus event payout');
select is((select advances_total::text from public.get_host_payroll_summary('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a6',null)),'10.000','global payroll applies the staff advance exactly once');
select is((select paid_total::text from public.get_host_payroll_summary('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a6',null)),'30.000','global paid total is advance plus payout exactly once');
select is((select late_total::text from public.get_host_payroll_summary('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a6',null)),'20.000','global balance is 50 due minus 10 advance minus 20 payout');

-- Invoice authority + idempotency.
select lives_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','INV-HARD-1',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000001')$$,'invoice is created from the accepted quotation total');
select lives_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','INV-HARD-1',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000001')$$,'identical invoice request replays successfully');
select is((select count(*)::int from public.invoice_summaries where event_id='97000000-0000-0000-0000-0000000000e1'),1,'invoice replay creates exactly one row');
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','INV-HARD-DIFFERENT',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000001')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same invoice key with a different payload hard-rejects');
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','INV-HARD-2',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000002')$$,'23505','INVOICE_ALREADY_EXISTS','a second live invoice for the event is rejected');
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e2','INV-NO-QUOTE',null,10.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"0.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"10.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000003')$$,'23514','INVOICE_REQUIRES_ACCEPTED_QUOTATION','invoice requires an accepted quotation');
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e3','INV-WRONG-TOTAL',null,49.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"9.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"40.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000004')$$,'23514','INVOICE_TOTAL_MISMATCH','invoice total must equal the accepted quotation total');
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e3','INV-BAD-SEQ',null,50.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"10.000"},{"seq":2,"kind":"FINAL","due_date":"2026-10-01","amount":"40.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000005')$$,'22023','INVALID_INSTALLMENT_SEQUENCE','installment sequence must be contiguous and canonical');

set local "request.jwt.claims"='{"sub":"97000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e3','INV-SUPERVISOR',null,50.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"10.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"40.000"}]'::jsonb,null,'97300000-0000-0000-0000-000000000006')$$,'42501','NOT_AUTHORIZED','supervisor cannot issue financial invoices');

set local "request.jwt.claims"='{"sub":"97000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.void_invoice('97000000-0000-0000-0000-0000000000a1',(select invoice_id from public.invoice_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and invoice_status='ISSUED' limit 1),'customer correction','97300000-0000-0000-0000-000000000007')$$,'invoice can be cancelled');
select lives_ok($$select public.void_invoice('97000000-0000-0000-0000-0000000000a1',(select invoice_id from public.invoice_summaries where event_id='97000000-0000-0000-0000-0000000000e1' limit 1),'customer correction','97300000-0000-0000-0000-000000000007')$$,'identical invoice cancellation replays successfully');
select is((select distinct effective_status from public.invoice_installment_summaries where event_id='97000000-0000-0000-0000-0000000000e1'),'CANCELLED','cancelled installment plan reads as CANCELLED');
select lives_ok($$select public.create_event_invoice('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000e1','INV-HARD-REISSUE',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-01","amount":"20.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"80.000"}]'::jsonb,'replacement','97300000-0000-0000-0000-000000000008')$$,'a cancelled invoice can be replaced by one new issued invoice');
select is((select count(*)::int from public.invoice_summaries where event_id='97000000-0000-0000-0000-0000000000e1' and invoice_status='ISSUED'),1,'exactly one issued invoice exists after replacement');
select is((select count(*)::int from public.invoice_summaries where event_id='97000000-0000-0000-0000-0000000000e1'),2,'cancelled invoice history is preserved alongside replacement');

select * from finish();
rollback;
