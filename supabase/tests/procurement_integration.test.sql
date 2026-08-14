-- ============================================================================
-- S5 Integration — supplier details and receipt line projections
-- ============================================================================
begin;
select plan(16);

-- Fixture: org A has every application role; org B proves tenant boundaries.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000001','authenticated','authenticated','s5i-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000002','authenticated','authenticated','s5i-manager-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000003','authenticated','authenticated','s5i-supervisor-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000004','authenticated','authenticated','s5i-warehouse-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000005','authenticated','authenticated','s5i-accountant-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000006','authenticated','authenticated','s5i-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('90000000-0000-0000-0000-0000000000a1','S5I Org A'),
('90000000-0000-0000-0000-0000000000b1','S5I Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000001','OWNER'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000002','MANAGER'),
('90000000-0000-0000-0000-000000000000a1','90000000-0000-0000-0000-000000000003','SUPERVISOR'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000004','WAREHOUSE'),
('90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-000000000005','ACCOUNTANT'),
('90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-000000000006','OWNER');

insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('90000000-0000-0000-0000-0000000000d1','90000000-0000-0000-0000-0000000000a1','قهوة تكامل','CONSUMABLE','كجم','PER_UNIT',1.000,3.000);

insert into public.consumable_stock_items(id,organization_id,catalog_item_id,minimum_stock_quantity,created_by) values
('90000000-0000-0000-0000-0000000000f1','90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000d1',1,'90000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Create supplier with full notes and commercial registration
select lives_ok($$select public.create_supplier(
  '90000000-0000-0000-0000-0000000000a1',
  'مورد التكامل الرئيسي',
  'CONSUMABLES',
  'CR-999',
  'سعيد',
  '24000000',
  '99000000',
  'saeed@supplier.test',
  'ملاحظات سرية تجارية',
  '92000000-0000-0000-0000-000000000001'
)$$, 'OWNER creates supplier with commercial details');

-- Create an order and receive it to test receipt line projection
select lives_ok($$select public.create_procurement_order(
  '90000000-0000-0000-0000-0000000000a1',
  (select supplier_id from public.supplier_summaries where name='مورد التكامل الرئيسي'),
  null,
  '2026-08-14',
  null,
  'integration receipt test',
  '[{"line_kind":"CONSUMABLE","catalog_item_id":"90000000-0000-0000-0000-0000000000d1","quantity":"5.000","agreed_unit_cost":"1.200"}]'::jsonb,
  '92000000-0000-0000-0000-000000000010'
)$$, 'creates order');

select lives_ok($$select public.approve_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='integration receipt test'),'92000000-0000-0000-0000-000000000011')$$,'approves order');
select lives_ok($$select public.send_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='integration receipt test'),'92000000-0000-0000-0000-000000000012')$$,'sends order');
select lives_ok($$select public.confirm_procurement_order('90000000-0000-0000-0000-0000000000a1',(select order_id from public.procurement_order_details where notes='integration receipt test'),'92000000-0000-0000-0000-000000000013')$$,'confirms order');

-- Receive partial
select lives_ok($$select public.receive_procurement_order(
  '90000000-0000-0000-0000-0000000000a1',
  (select order_id from public.procurement_order_details where notes='integration receipt test'),
  '2026-08-14 10:00+04',
  'RC-INT-1',
  'note 1',
  jsonb_build_array(jsonb_build_object('order_line_id',(select order_line_id from public.procurement_order_line_summaries where description='قهوة تكامل'),'quantity','3.000')),
  '92000000-0000-0000-0000-000000000014'
)$$, 'records receipt');

-- 1. OWNER reads supplier_details with confidential notes and CRN
select is((select notes from public.supplier_details where name='مورد التكامل الرئيسي'), 'ملاحظات سرية تجارية', 'OWNER reads supplier notes from supplier_details');
select is((select commercial_registration_number from public.supplier_details where name='مورد التكامل الرئيسي'), 'CR-999', 'OWNER reads CRN from supplier_details');

-- 2. MANAGER reads supplier_details
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.supplier_details where name='مورد التكامل الرئيسي'), 1, 'MANAGER reads supplier_details');

-- 3. ACCOUNTANT reads supplier_details
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.supplier_details where name='مورد التكامل الرئيسي'), 1, 'ACCOUNTANT reads supplier_details');

-- 4. WAREHOUSE sees 0 rows in supplier_details
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.supplier_details where name='مورد التكامل الرئيسي'), 0, 'WAREHOUSE sees no supplier_details rows');

-- 5. SUPERVISOR sees 0 rows in supplier_details
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.supplier_details where name='مورد التكامل الرئيسي'), 0, 'SUPERVISOR sees no supplier_details rows');

-- 6. WAREHOUSE can read procurement_receipt_line_summaries
select is((select count(*)::int from public.procurement_receipt_line_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'), 1, 'WAREHOUSE reads receipt line summaries');
select is((select quantity from public.procurement_receipt_line_summaries limit 1), 3.000::numeric, 'receipt line quantity matches 3.000');

-- 7. Org B tenant isolation on supplier_details and receipt lines
set local "request.jwt.claims"='{"sub":"90000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.supplier_details where organization_id='90000000-0000-0000-0000-0000000000a1'), 0, 'Org B reads 0 Org A supplier details');
select is((select count(*)::int from public.procurement_receipt_line_summaries where organization_id='90000000-0000-0000-0000-0000000000a1'), 0, 'Org B reads 0 Org A receipt line summaries');

select * from finish();
rollback;
