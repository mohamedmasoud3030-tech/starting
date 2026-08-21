-- ============================================================================
-- 0074 — Secure attachments: tenant isolation, storage policies, sensitive
-- staff-evidence permission boundary (NOT can_read_cost).
-- ============================================================================
begin;
select plan(19);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000001','authenticated','authenticated','a74-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000002','authenticated','authenticated','a74-manager@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000003','authenticated','authenticated','a74-accountant@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000004','authenticated','authenticated','a74-supervisor@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000005','authenticated','authenticated','a74-warehouse@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98100000-0000-0000-0000-000000000006','authenticated','authenticated','a74-ownerb@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('98000000-0000-0000-0000-0000000000a1','Attach Org A'),
('98000000-0000-0000-0000-0000000000b1','Attach Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('98000000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000001','OWNER'),
('98000000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000002','MANAGER'),
('98000000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000003','ACCOUNTANT'),
('98000000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000004','SUPERVISOR'),
('98000000-0000-0000-0000-0000000000a1','98100000-0000-0000-0000-000000000005','WAREHOUSE'),
('98000000-0000-0000-0000-0000000000b1','98100000-0000-0000-0000-000000000006','OWNER');

insert into public.customers(id,organization_id,name) values
('98000000-0000-0000-0000-0000000000c1','98000000-0000-0000-0000-0000000000a1','Attach Customer A'),
('98000000-0000-0000-0000-0000000000c2','98000000-0000-0000-0000-0000000000b1','Attach Customer B');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000c1','EV-A1','Event A','2026-10-01 14:00+04','2026-10-01 20:00+04',10,'A','CONFIRMED','98100000-0000-0000-0000-0000000000e1','98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000e2','98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000c2','EV-B1','Event B','2026-10-02 14:00+04','2026-10-02 20:00+04',10,'B','CONFIRMED','98100000-0000-0000-0000-0000000000e2','98100000-0000-0000-0000-000000000006','98100000-0000-0000-0000-000000000006');
insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate) values
('98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1','Host A','HOST',true,'PER_EVENT',0),
('98000000-0000-0000-0000-0000000000f2','98000000-0000-0000-0000-0000000000b1','Host B','HOST',true,'PER_EVENT',0);
insert into public.event_expenses(id,organization_id,event_id,category,amount,expense_date,description,recorded_by,idempotency_key,request_fingerprint) values
('98000000-0000-0000-0000-0000000000b9','98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000e1','OTHER',12.000,'2026-10-01','expense','98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-0000000000b9','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Private bucket objects (as the storage API would create them).
insert into storage.objects(bucket_id, name, owner) values
('attachments','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/id-a.jpg','98100000-0000-0000-0000-000000000001'),
('attachments','98000000-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event_equipment_reservation/delivery-a.jpg','98100000-0000-0000-0000-000000000001'),
('attachments','98000000-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/expense-a.jpg','98100000-0000-0000-0000-000000000001'),
('attachments','98000000-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/id-b.jpg','98100000-0000-0000-0000-000000000006'),
('attachments','98000000-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/expense-b.jpg','98100000-0000-0000-0000-000000000001');

-- Metadata rows (inserted as owner, before switching role).
insert into public.attachment_evidence(organization_id,evidence_type,entity_type,entity_id,storage_path,file_name,mime_type,size_bytes,uploaded_by) values
('98000000-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/id-a.jpg','id-a.jpg','image/jpeg',100,'98100000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000a1','DELIVERY_PROOF','event_equipment_reservation','98000000-0000-0000-0000-0000000000e1','98000000-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event_equipment_reservation/delivery-a.jpg','delivery-a.jpg','image/jpeg',100,'98100000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000a1','EXPENSE_RECEIPT','event_expense','98000000-0000-0000-0000-0000000000b9','98000000-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/expense-a.jpg','expense-a.jpg','image/jpeg',100,'98100000-0000-0000-0000-000000000001'),
('98000000-0000-0000-0000-0000000000b1','STAFF_ID','staff_member','98000000-0000-0000-0000-0000000000f2','98000000-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/id-b.jpg','id-b.jpg','image/jpeg',100,'98100000-0000-0000-0000-000000000006');

-- ---------------------------------------------------------------------------
-- Metadata RLS: tenant isolation + sensitive-document boundary.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1'),3,'Org A owner sees its own 3 attachments');
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000b1'),0,'Org A owner cannot read Org B attachments');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000b1'),1,'Org B owner sees its own 1 attachment');
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1'),0,'Org B owner cannot read Org A attachments');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1' and evidence_type='EXPENSE_RECEIPT'),1,'ACCOUNTANT reads financial evidence');
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1' and evidence_type in ('STAFF_ID','STAFF_CONTRACT','ATTENDANCE_CHECKIN','ATTENDANCE_CHECKOUT')),0,'ACCOUNTANT cannot read sensitive staff evidence (not merely can_read_cost)');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1' and evidence_type='STAFF_ID'),0,'SUPERVISOR cannot read identity documents');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1' and evidence_type='DELIVERY_PROOF'),1,'WAREHOUSE reads operational delivery evidence');
select is((select count(*)::int from public.attachment_evidence where organization_id='98000000-0000-0000-0000-0000000000a1' and evidence_type='STAFF_ID'),0,'WAREHOUSE cannot read identity documents');

-- ---------------------------------------------------------------------------
-- Storage RLS: tenant isolation on the private bucket.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from storage.objects),4,'Org A owner sees only Org A objects');
select throws_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98000000-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/evil.jpg')$sql$,'42501',null,'Org A owner cannot upload into Org B path');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from storage.objects),1,'Org B owner sees only Org B objects');
select throws_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/evil.jpg')$sql$,'42501',null,'Org B owner cannot upload into Org A path');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/evil.jpg')$sql$,'42501',null,'ACCOUNTANT cannot upload identity documents');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98000000-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event_equipment_reservation/new.jpg')$sql$,'WAREHOUSE can upload operational delivery evidence');

-- ---------------------------------------------------------------------------
-- attach_evidence command: role gate + no-false-success (object must exist).
-- ---------------------------------------------------------------------------
set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($sql$select public.attach_evidence('98000000-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/id-a.jpg','id-a.jpg','image/jpeg',100,true,'98100000-0000-0000-0000-0000000000a1')$sql$,'42501','NOT_AUTHORIZED','ACCOUNTANT cannot attach identity documents');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok($sql$select public.attach_evidence('98000000-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98000000-0000-0000-0000-0000000000f1','98000000-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/id-a.jpg','id-a.jpg','image/jpeg',100,true,'98100000-0000-0000-0000-0000000000a2')$sql$,'42501','NOT_AUTHORIZED','WAREHOUSE cannot attach identity documents');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($sql$select public.attach_evidence('98000000-0000-0000-0000-0000000000a1','EXPENSE_RECEIPT','event_expense','98000000-0000-0000-0000-0000000000b9','98000000-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/does-not-exist.jpg','nope.jpg','image/jpeg',100,false,'98100000-0000-0000-0000-0000000000a3')$sql$,'P0002','ATTACHMENT_OBJECT_MISSING','a missing upload never becomes verified evidence');

set local "request.jwt.claims"='{"sub":"98100000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($sql$select public.attach_evidence('98000000-0000-0000-0000-0000000000a1','EXPENSE_RECEIPT','event_expense','98000000-0000-0000-0000-0000000000b9','98000000-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/expense-b.jpg','expense-b.jpg','image/jpeg',100,true,'98100000-0000-0000-0000-0000000000a4')$sql$,'ACCOUNTANT attaches an expense receipt');

select finish();
rollback;
