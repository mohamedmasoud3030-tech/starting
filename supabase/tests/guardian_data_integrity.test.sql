-- ============================================================================
-- GUARDIAN — data integrity behavior
-- ----------------------------------------------------------------------------
--   * orphan / broken-reference prevention (FKs)
--   * cross-company relationship prevention (composite org-scoped FKs)
--   * duplicate business records prevention (unique constraints)
--   * impossible states (negative money, invalid transitions)
--   * invalid status transitions (event lifecycle matrix)
--   * the Guardian's detection scans return zero rows on clean data
-- Run via `supabase test db` or the native harness.
-- ============================================================================
begin;
select plan(16);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','97300000-0000-0000-0000-000000000001','authenticated','authenticated','gdi-owner@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('97300000-0000-0000-0000-0000000000a1','Guardian Data A'),
('97300000-0000-0000-0000-0000000000b1','Guardian Data B');
insert into public.organization_memberships(organization_id,user_id,role,status) values
('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-000000000001','OWNER','ACTIVE'),
('97300000-0000-0000-0000-0000000000b1','97300000-0000-0000-0000-000000000001','OWNER','ACTIVE');
insert into public.customers(id,organization_id,name) values
('97300000-0000-0000-0000-0000000000c1','97300000-0000-0000-0000-0000000000a1','Data C A'),
('97300000-0000-0000-0000-0000000000c2','97300000-0000-0000-0000-0000000000b1','Data C B');
insert into public.events(id,organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('97300000-0000-0000-0000-0000000000e1','97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000c1','EV-D-A','Data Event A','X','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'M','CONFIRMED','97300000-0000-0000-0000-000000000011','97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000001'),
('97300000-0000-0000-0000-0000000000e2','97300000-0000-0000-0000-0000000000b1','97300000-0000-0000-0000-0000000000c2','EV-D-B','Data Event B','X','2026-10-01 10:00+04','2026-10-01 20:00+04',50,'M','CONFIRMED','97300000-0000-0000-0000-000000000012','97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000001');
insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
('97300000-0000-0000-0000-0000000000d1','97300000-0000-0000-0000-0000000000a1','Data Supplier','ACTIVE','97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000001');
insert into public.procurement_orders(id,organization_id,supplier_id,event_id,order_number,order_date,status,agreed_total_cost,supplier_name_snapshot,created_by,updated_by) values
('97300000-0000-0000-0000-0000000000b2','97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000d1','97300000-0000-0000-0000-0000000000e1','PO-D-A',current_date,'DRAFT',10.000,'Data Supplier','97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000001');
insert into public.catalog_categories(id,organization_id,name,sort_order) values
('97300000-0000-0000-0000-0000000000b3','97300000-0000-0000-0000-0000000000a1','Category A',1);
insert into public.invoices(id,organization_id,event_id,invoice_number,issued_at,total_amount,currency,status,created_by,created_at,pre_vat_total,vat_registered,vat_percent,vat_amount) values
('97300000-0000-0000-0000-0000000000a4','97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','INV-D-A',now(),100.000,'OMR','ISSUED','97300000-0000-0000-0000-000000000001',now(),100.000,false,0.000,0.000),
('97300000-0000-0000-0000-0000000000a5','97300000-0000-0000-0000-0000000000b1','97300000-0000-0000-0000-0000000000e2','INV-D-B',now(),50.000,'OMR','ISSUED','97300000-0000-0000-0000-000000000001',now(),50.000,false,0.000,0.000);
insert into public.customer_payments(organization_id,event_id,amount,payment_method,paid_at,status,recorded_by,idempotency_key,request_fingerprint,created_at) values
('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1',40.000,'CASH',now(),'RECORDED','97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000021',repeat('3',64),now());

-- 1-3. Orphan / broken-reference prevention -----------------------------------
set local role postgres;
select throws_ok($$insert into public.event_equipment_movements(organization_id,event_id,reservation_id,equipment_capacity_id,movement_kind,dispatched_quantity,actor_id,idempotency_key,request_fingerprint)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','97300000-0000-0000-0000-0000000000a6','97300000-0000-0000-0000-0000000000a9','DISPATCH',1,'97300000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000031','x')$$,'23503',null,'movement with missing reservation (orphan) is rejected');
select throws_ok($$insert into public.procurement_order_lines(organization_id,order_id,line_kind,description,quantity,unit,agreed_unit_cost,agreed_total_cost,sort_order)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000a7','CONSUMABLE','x',1,'x',1,1,1)$$,'23503',null,'order line with missing order is rejected');
select throws_ok($$insert into public.invoice_installments(organization_id,invoice_id,seq,kind,due_date,amount)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000a8',1,'DEPOSIT',now(),10.000)$$,'23503',null,'installment with missing invoice is rejected');

-- 4-5. Cross-company relationship prevention (composite org-scoped FK) ---------
select throws_ok($$insert into public.event_commercial_lines(organization_id,event_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e2','cross','OTHER','piece','FIXED',1,1.000,0.500,1.000,0.500,true,1)$$,'23503',null,'org-A line referencing org-B event is rejected (composite FK)');
select throws_ok($$insert into public.invoice_installments(organization_id,invoice_id,seq,kind,due_date,amount)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000a5',1,'DEPOSIT',now(),10.000)$$,'23503',null,'org-A installment referencing org-B invoice is rejected (composite FK)');

-- 6-7. Impossible states -------------------------------------------------------
select throws_ok($$insert into public.invoice_installments(organization_id,invoice_id,seq,kind,due_date,amount)
  values('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000a4',3,'FINAL',now(),-5.000)$$,'23514',null,'negative installment amount (impossible state) is rejected');
select throws_ok($$insert into public.catalog_categories(id,organization_id,name,sort_order)
  values('97300000-0000-0000-0000-0000000000b4','97300000-0000-0000-0000-0000000000a1','Category A',2)$$,'23505',null,'duplicate category name per org is rejected');

-- 8-9. Invalid status transitions ----------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"97300000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.transition_event_status('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','CANCELLED',null,null)$$,'P0001','USE_CANCEL_EVENT','CANCELLED via transition is rejected (use cancel_event)');
select throws_ok($$select public.transition_event_status('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','CLOSED',null,null)$$,'P0001','INVALID_EVENT_TRANSITION','CONFIRMED → CLOSED (skipping states) is rejected');
select lives_ok($$select public.transition_event_status('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','PREPARING',null,null)$$,'PREPARING is a valid step of the transition matrix');
select lives_ok($$select public.transition_event_status('97300000-0000-0000-0000-0000000000a1','97300000-0000-0000-0000-0000000000e1','DISPATCHED',null,null)$$,'DISPATCH allowed when readiness is READY (override gate covered by event_transition_override.test.sql)');

-- 10c. State reached through the guarded matrix
set local role postgres;
select is((select status::text from public.events where id='97300000-0000-0000-0000-0000000000e1'),'DISPATCHED','event reached DISPATCHED through the guarded transition matrix');

-- 11-12. Master data no hard delete -------------------------------------------
set local role postgres;
select throws_ok($$delete from public.suppliers where id='97300000-0000-0000-0000-0000000000d1'$$,'42501','PROCUREMENT_MASTER_DELETE_FORBIDDEN','master supplier records cannot be hard-deleted');

-- 12-14. Guardian detection scans return zero rows on clean data ---------------
set local role postgres;
select is((select count(*)::int from public.events e where e.status='CLOSED' and exists (
    select 1 from public.event_equipment_reservations r
    where r.organization_id=e.organization_id and r.event_id=e.id and r.status='ACTIVE')),0,'no closed event with outstanding equipment');
select is((select count(*)::int from (
    select c.organization_id, c.id, c.amount, c.reference from public.customer_payments c
    left join public.events e on e.organization_id=c.organization_id and e.id=c.event_id
    where e.id is null) orphans),0,'no orphan payments');
select is((select count(*)::int from (
    select organization_id, lower(trim(name)) name from public.customers group by 1,2 having count(*)>1) d),0,'no duplicate customer records per org');

select * from finish();
rollback;
