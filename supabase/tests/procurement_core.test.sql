-- ============================================================================
-- S5A — suppliers, procurement cost snapshots and transactional receiving.
-- ============================================================================
begin;
select plan(82);

-- Fixture: org A has every application role; org B proves tenant boundaries.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000001','authenticated','authenticated','s5-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000002','authenticated','authenticated','s5-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000003','authenticated','authenticated','s5-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000004','authenticated','authenticated','s5-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000005','authenticated','authenticated','s5-accountant-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000006','authenticated','authenticated','s5-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('90000000-0000-0000-0000-0000000000a1','S5 Org A'),
('90000000-0000-0000-0000-0000000000b1','S5 Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000001','OWNER'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000002','MANAGER'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000003','SUPERVISOR'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000004','WAREHOUSE'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000005','ACCOUNTANT'),
('90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-000000000006','OWNER');
insert into public.customers(id,organization_id,name) values
('90000000-0000-0000-0000-0000000000c1','90000000-0000-0000-0000-0000000000a1','Customer A'),
('90000000-0000-0000-0000-0000000000c2','90000000-0000-0000-0000-0000000000b1','Customer B');
insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('90000000-0000-0000-0000-0000000000e1','90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000c1','EV-S5-A','Event A','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','PREPARING','90100000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001'),
('90000000-0000-0000-0000-0000000000e2','90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-0000000000c2','EV-S5-B','Event B','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Salalah','PREPARING','90100000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000006');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('90000000-0000-0000-0000-0000000000d1','90000000-0000-0000-0000-0000000000a1','قهوة مشتراة','CONSUMABLE','كجم','PER_UNIT',1.000,3.000),
('90000000-0000-0000-0000-0000000000d2','90000000-0000-0000-0000-0000000000b1','قهوة ب','CONSUMABLE','كجم','PER_UNIT',1.000,3.000);
insert into public.consumable_stock_items(id,organization_id,catalog_item_id,minimum_stock_quantity,created_by) values
('90000000-0000-0000-0000-0000000000f1','90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000d1',1,'90000000-0000-0000-0000-000000000001'),
('90000000-0000-0000-0000-0000000000f2','90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-0000000000d2',1,'90000000-0000-0000-0000-000000000006');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Supplier lifecycle, idempotency and tenant safety.
select lives_ok($$select public.create_supplier('90000000-0000-0000-0000-0000000000a1','مطعم مسقط','CATERING_RESTAURANT','CR-123','أحمد','24123456','99123456','orders@example.test','commercial terms','91000000-0000-0000-0000-000000000001')$$,'OWNER creates a supplier');
select lives_ok($$select public.create_supplier('90000000-0000-0000-0000-0000000000a1','مطعم مسقط','CATERING_RESTAURANT','CR-123','أحمد','24123456','99123456','orders@example.test','commercial terms','91000000-0000-0000-0000-000000000001')$$,'same supplier create key and payload replays');
select is((select count(*)::int from public.supplier_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'),1,'supplier replay creates one supplier');
select throws_ok($$select public.create_supplier('90000000-0000-0000-0000-0000000000a1','Different','GENERAL',null,null,null,null,null,null,'91000000-0000-0000-0000-000000000001')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','same key with different payload hard-rejects');
select lives_ok($$select public.set_supplier_status('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'INACTIVE','91000000-0000-0000-0000-000000000002')$$,'supplier can be made inactive');
select is((select status from public.supplier_summaries limit 1),'INACTIVE'::public.supplier_status,'inactive lifecycle is visible');
select lives_ok($$select public.set_supplier_status('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'ACTIVE','91000000-0000-0000-0000-000000000003')$$,'supplier can be reactivated');
select lives_ok($$select public.update_supplier('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'مطعم مسقط','CATERING_RESTAURANT','CR-123','أحمد','24123456','99123456','orders@example.test','terms v2','91000000-0000-0000-0000-000000000004')$$,'supplier details can be updated');
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.update_supplier('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'مطعم مسقط','CATERING_RESTAURANT','CR-123','أحمد','24123456','99123456','orders@example.test','manager update','91000000-0000-0000-0000-000000000007')$$,'MANAGER can manage supplier master data');
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_supplier('90000000-0000-0000-0000-0000000000b1','Cross org','GENERAL',null,null,null,null,null,null,'91000000-0000-0000-0000-000000000005')$$,'42501','NOT_AUTHORIZED','org-A owner cannot write org B');

set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$select public.create_supplier('90000000-0000-0000-0000-0000000000a1','Warehouse fake','GENERAL',null,null,null,null,null,null,'91000000-0000-0000-0000-000000000006')$$,'42501','NOT_AUTHORIZED','WAREHOUSE cannot manage suppliers');
select is((select count(*)::int from public.supplier_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'),1,'WAREHOUSE sees operational supplier contact summary');
select is((select count(*)::int from public.procurement_order_summaries),0,'WAREHOUSE sees no cost-bearing order summaries');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='supplier_summaries' and column_name in ('notes','commercial_registration_number','email')),0,'SupplierSummary excludes confidential master fields');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name in ('procurement_receiving_order_summaries','procurement_receiving_line_summaries') and column_name like '%cost%'),0,'WAREHOUSE receiving projections contain no negotiated cost columns');
select throws_ok($$insert into public.suppliers(organization_id,name,created_by,updated_by) values('90000000-0000-0000-0000-0000000000a1','direct','90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000004')$$,'42501',null,'direct supplier table INSERT is denied');

-- Main mixed order: exact OMR and quantity snapshots.
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_procurement_order(
 '90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'90000000-0000-0000-0000-0000000000e1','2026-08-14','2026-10-01 08:00+04','main order',
 '[{"line_kind":"CONSUMABLE","catalog_item_id":"90000000-0000-0000-0000-0000000000d1","quantity":"10.000","agreed_unit_cost":"1.250"},{"line_kind":"CATERING_SERVICE","description":"وجبات غداء","unit":"وجبة","quantity":"2.500","agreed_unit_cost":"2.345"}]'::jsonb,
 '91000000-0000-0000-0000-000000000010')$$,'creates a draft with catalog and non-catalog lines');
select lives_ok($$select public.create_procurement_order(
 '90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'90000000-0000-0000-0000-0000000000e1','2026-08-14','2026-10-01 08:00+04','main order',
 '[{"line_kind":"CONSUMABLE","catalog_item_id":"90000000-0000-0000-0000-0000000000d1","quantity":"10.000","agreed_unit_cost":"1.250"},{"line_kind":"CATERING_SERVICE","description":"وجبات غداء","unit":"وجبة","quantity":"2.500","agreed_unit_cost":"2.345"}]'::jsonb,
 '91000000-0000-0000-0000-000000000010')$$,'same order create key and payload returns original DRAFT result');
select is((select count(*)::int from public.procurement_order_details where notes='main order'),1,'order create replay produces no duplicate aggregate');
select is((select status from public.procurement_order_details limit 1),'DRAFT'::public.procurement_order_status,'new order is DRAFT');
select is((select agreed_total_cost from public.procurement_order_line_summaries where line_kind='CATERING_SERVICE'),5.863::numeric,'OMR multiplication rounds half away from zero at 3dp');
select is((select agreed_total_cost from public.procurement_order_details limit 1),18.363::numeric,'order total is exact line-snapshot sum');
select is((select ordered_quantity from public.procurement_order_line_summaries where line_kind='CONSUMABLE'),10.000::numeric,'ordered quantity is exact numeric(12,3)');
select is((select count(*)::int from public.procurement_order_line_summaries where line_kind='CATERING_SERVICE' and catalog_item_id is null),1,'non-catalog catering is first-class and has no fake catalog link');
select throws_ok($$update public.procurement_orders set notes='direct write' where id=(select order_id from public.procurement_order_details limit 1)$$,'42501',null,'direct order table UPDATE is denied even to OWNER');
select throws_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),null,'2026-08-14',null,null,'[{"line_kind":"OTHER","description":"bad precision","unit":"x","quantity":"1.0001","agreed_unit_cost":"1.000"}]','91000000-0000-0000-0000-000000000011')$$,'P0001','QUANTITY_PRECISION_EXCEEDED','quantity beyond 3dp is rejected, not rounded');
select throws_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),null,'2026-08-14',null,null,'[{"line_kind":"OTHER","description":"bad money","unit":"x","quantity":"1.000","agreed_unit_cost":"1.0001"}]','91000000-0000-0000-0000-000000000012')$$,'P0001','OMR_PRECISION_EXCEEDED','money beyond OMR 3dp is rejected, not rounded');
select throws_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'90000000-0000-0000-0000-0000000000e2','2026-08-14',null,null,'[]','91000000-0000-0000-0000-000000000013')$$,'23503','EVENT_NOT_PROCUREABLE','cross-org Event reference is rejected');
select throws_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000f2',null,'2026-08-14',null,null,'[]','91000000-0000-0000-0000-000000000014')$$,'23503','SUPPLIER_NOT_ACTIVE','cross-org supplier reference is rejected');

select lives_ok($$select public.approve_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),'91000000-0000-0000-0000-000000000020')$$,'DRAFT approves with line and supplier snapshots');
select is((select status from public.procurement_order_details limit 1),'APPROVED'::public.procurement_order_status,'approval changes lifecycle to APPROVED');
select throws_ok($$select public.update_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),(select supplier_id from public.supplier_summaries limit 1),null,'2026-08-15',null,null,'[]','91000000-0000-0000-0000-000000000021')$$,'P0001','PROCUREMENT_ORDER_NOT_EDITABLE','approved negotiated lines cannot be edited through command');

-- Master changes after approval never restate historical commercial facts.
update public.catalog_items set name='اسم كتالوج جديد',cost_price=9.999 where id='90000000-0000-0000-0000-0000000000d1';
select lives_ok($$select public.update_supplier('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),'اسم مورد جديد','GENERAL','CR-X','شخص جديد','999',null,null,null,'91000000-0000-0000-0000-000000000022')$$,'supplier master may change after approval');
select is((select description from public.procurement_order_line_summaries where line_kind='CONSUMABLE'),'قهوة مشتراة','catalog name change does not rewrite line description snapshot');
select is((select agreed_unit_cost from public.procurement_order_line_summaries where line_kind='CONSUMABLE'),1.250::numeric,'catalog cost change does not rewrite negotiated unit cost');
select is((select supplier_name_snapshot from public.procurement_order_details limit 1),'مطعم مسقط','supplier name snapshot remains historical');
select throws_ok($$select public.confirm_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),'91000000-0000-0000-0000-000000000023')$$,'P0001','INVALID_PROCUREMENT_ORDER_TRANSITION','APPROVED cannot skip SENT');
select lives_ok($$select public.send_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),'91000000-0000-0000-0000-000000000024')$$,'APPROVED transitions to SENT');
select lives_ok($$select public.confirm_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),'91000000-0000-0000-0000-000000000025')$$,'SENT transitions to CONFIRMED');
select is((select status from public.procurement_order_details limit 1),'CONFIRMED'::public.procurement_order_status,'confirmed lifecycle state is exact');

set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select agreed_total_cost from public.procurement_order_details limit 1),18.363::numeric,'ACCOUNTANT can read negotiated procurement cost');
select throws_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details limit 1),now(),null,null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_order_line_summaries where line_kind='CONSUMABLE'),'quantity','1.000')),'91000000-0000-0000-0000-000000000026')$$,'42501','NOT_AUTHORIZED','ACCOUNTANT cannot perform operational receiving');

-- Partial physical receipt by WAREHOUSE links one authoritative S4B RECEIVE.
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),'2026-10-01 08:10+04','DN-1','partial',jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CONSUMABLE'),'quantity','4.125')),'91000000-0000-0000-0000-000000000030')$$,'WAREHOUSE receives a physical consumable partial');
select is((select status from public.procurement_receiving_order_summaries limit 1),'PARTIALLY_RECEIVED'::public.procurement_order_status,'partial receipt changes aggregate status');
select is((select received_quantity from public.procurement_receiving_line_summaries where line_kind='CONSUMABLE'),4.125::numeric,'partial quantity is cumulative and exact');
select is((select public.consumable_stock_on_hand('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000f1')),4.125::numeric,'receipt increases the single S4B balance');
select is((select count(*)::int from public.procurement_receipt_summaries where reference='DN-1' and has_stock_movements),1,'consumable receipt summary proves an authoritative stock linkage');
select throws_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),now(),null,null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CONSUMABLE'),'quantity','6.000')),'91000000-0000-0000-0000-000000000031')$$,'23514','PROCUREMENT_OVER_RECEIPT','cumulative over-receipt is rejected');
select throws_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),now(),null,null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CATERING_SERVICE'),'quantity','2.500')),'91000000-0000-0000-0000-000000000032')$$,'42501','WAREHOUSE_PHYSICAL_RECEIPT_ONLY','WAREHOUSE cannot confirm service performance');
select lives_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),'2026-10-01 12:00+04','DN-2',null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CONSUMABLE'),'quantity','5.875')),'91000000-0000-0000-0000-000000000033')$$,'WAREHOUSE completes the physical line exactly');

set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),'2026-10-01 13:00+04','SERVICE-OK',null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CATERING_SERVICE'),'quantity','2.500')),'91000000-0000-0000-0000-000000000034')$$,'SUPERVISOR confirms service performance');
select is((select status from public.procurement_receiving_order_summaries limit 1),'RECEIVED'::public.procurement_order_status,'all lines exact makes order RECEIVED');
select is((select count(*)::int from public.consumable_movements where stock_item_id='90000000-0000-0000-0000-0000000000f1'),2,'two physical partials produce exactly two RECEIVE facts');
select is((select public.consumable_stock_on_hand('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000f1')),10.000::numeric,'full physical receipt produces exact on-hand 10.000');
select lives_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),'2026-10-01 13:00+04','SERVICE-OK',null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CATERING_SERVICE'),'quantity','2.500')),'91000000-0000-0000-0000-000000000034')$$,'identical receipt retry returns original result after order is final');
select is((select count(*)::int from public.procurement_receipt_summaries),3,'receipt replay creates no duplicate receipt');
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.audit_events where metadata->>'idempotency_key'='91000000-0000-0000-0000-000000000034'),1,'receipt replay creates one parent audit event');
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries limit 1),'2026-10-01 13:00+04','DIFFERENT',null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where line_kind='CATERING_SERVICE'),'quantity','2.500')),'91000000-0000-0000-0000-000000000034')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','receipt retry mismatch hard-rejects');

-- Cancellation before and after physical receipt; history is never erased.
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.cancel_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where status='RECEIVED'),'cannot','91000000-0000-0000-0000-000000000040')$$,'P0001','PROCUREMENT_ORDER_NOT_CANCELLABLE','fully received order cannot be cancelled');
select lives_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),null,'2026-08-14',null,'cancel draft','[]','91000000-0000-0000-0000-000000000041')$$,'creates a second draft for pre-approval cancellation');
select lives_ok($$select public.cancel_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='cancel draft'),'not needed','91000000-0000-0000-0000-000000000042')$$,'draft order cancels safely');
select is((select status from public.procurement_order_details where notes='cancel draft'),'CANCELLED'::public.procurement_order_status,'draft cancellation is terminal');

-- Build a third order and cancel after a partial stock receipt.
select lives_ok($$select public.create_procurement_order('90000000-0000-0000-0000-0000000000a1',(select supplier_id from public.supplier_summaries limit 1),null,'2026-08-14',null,'cancel partial','[{"line_kind":"CONSUMABLE","catalog_item_id":"90000000-0000-0000-0000-0000000000d1","quantity":"5.000","agreed_unit_cost":"1.100"}]','91000000-0000-0000-0000-000000000043')$$,'creates order for partial-cancel proof');
select lives_ok($$select public.approve_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='cancel partial'),'91000000-0000-0000-0000-000000000044')$$,'partial-cancel order approves');
select lives_ok($$select public.send_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='cancel partial'),'91000000-0000-0000-0000-000000000045')$$,'partial-cancel order sends');
select lives_ok($$select public.confirm_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='cancel partial'),'91000000-0000-0000-0000-000000000046')$$,'partial-cancel order confirms');

set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select public.receive_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_receiving_order_summaries where status='CONFIRMED'),now(),'DN-CANCEL',null,jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_receiving_line_summaries where order_id=(select order_id from public.procurement_receiving_order_summaries where status='CONFIRMED')),'quantity','2.000')),'91000000-0000-0000-0000-000000000047')$$,'stock is physically received before cancellation');
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.cancel_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='cancel partial'),'supplier cannot complete','91000000-0000-0000-0000-000000000048')$$,'partially received order can be cancelled explicitly');
select is((select count(*)::int from public.procurement_receipt_summaries where reference='DN-CANCEL'),1,'cancellation preserves receipt history');
select is((select count(*)::int from public.consumable_movements m where m.reference like 'PO-% / DN-CANCEL'),1,'cancellation preserves linked S4B RECEIVE movement');
select is((select delivered_cost from public.event_procurement_cost_summaries where event_id='90000000-0000-0000-0000-0000000000e1'),18.363::numeric,'Event cost read model reports exact delivered cost for Event-linked order');

-- Final security and immutable-history checks.
set local role postgres;
select throws_ok($$update public.procurement_order_lines set agreed_unit_cost=99 where order_id=(select id from public.procurement_orders where notes='main order')$$,'42501','PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE','privileged line mutation after approval is structurally blocked');
select throws_ok($$update public.procurement_orders set agreed_total_cost=0 where notes='main order'$$,'42501','PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE','privileged order cost mutation after approval is structurally blocked');
select throws_ok($$update public.procurement_receipts set reference='rewritten'$$,'42501','PROCUREMENT_HISTORY_APPEND_ONLY','receipt history is append-only');
select throws_ok($$update public.procurement_orders set status='RECEIVED' where notes='cancel draft'$$,'23514','INVALID_PROCUREMENT_ORDER_TRANSITION','terminal cancelled history cannot be reopened or skip lifecycle states');
select is((select count(*)::int from public.audit_events where action='SUPPLIER_STATUS_CHANGED'),2,'supplier lifecycle changes are audited exactly once each');
select is((select count(*)::int from public.audit_events where action='PROCUREMENT_ORDER_APPROVED'),2,'every approved order has one approval audit');
select is((select count(*)::int from public.audit_events where action='PROCUREMENT_ORDER_CANCELLED'),2,'draft and partial cancellation are both audited');
select is((select count(*)::int from public.audit_events where action='PROCUREMENT_ORDER_PARTIALLY_RECEIVED'),3,'partial receipts have explicit audit actions');
select is((select count(*)::int from public.audit_events where action='PROCUREMENT_ORDER_RECEIVED'),1,'final receipt has an explicit final audit action');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.supplier_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'),0,'org-B user reads no org-A supplier rows');
select is((select count(*)::int from public.procurement_receiving_order_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'),0,'org-B user reads no org-A order rows');

select * from finish();
rollback;
