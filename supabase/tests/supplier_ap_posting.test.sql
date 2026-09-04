-- ============================================================================
-- 0090 — Supplier Accounts Payable + procurement posting pgTAP.
--
-- Covers: procurement order / receipt emit NO journal (commitment + delivery
-- proof only); supplier invoice Dr Procurement Cost 5100 / Cr Supplier AP 2200;
-- three-way match (PO <-> Receipt <-> Invoice) — CONSUMABLE requires receipt
-- qty >= invoice qty, invoice qty <= received <= ordered, price tolerance
-- 0.001 OMR, and owner override with reason bypasses eligibility; supplier
-- payment Dr AP / Cr Treasury (never lets AP < 0, rejects overpayment); invoice
-- and payment void reverse the original journal; idempotent replay; capability
-- gates (procurement.manage for invoice, finance.manage for payment);
-- cross-org isolation; and AP/treasury reconciliation against the journal.
--
-- Assertions inspect real ledger balances / journal relationships, not just RPC
-- return values. Runs under the definer (postgres) with jwt claims so the
-- revoked journal tables are readable.
-- ============================================================================
begin;
select plan(39);

-- Transient key/value store so order/line ids created inside helper functions
-- (plpgsql) can be referenced by later standalone test statements. Lives only
-- in this test transaction (rolled back at the end).
create table public._sp_vars (k text primary key, v text);

create or replace function public._sp_chart(p_org uuid, p_code text)
returns uuid language sql stable as $$
  select id from public.chart_of_accounts where organization_id = p_org and code = p_code;
$$;
create or replace function public._sp_debit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;
create or replace function public._sp_credit(p_org uuid, p_acc uuid)
returns numeric language sql stable as $$
  select coalesce(sum(credit) - sum(debit), 0)
    from public.journal_lines where organization_id = p_org and account_id = p_acc;
$$;

-- Helper: full order lifecycle (create/approve/send/confirm [+ receive]) and
-- remember the order id + first line id under a tag for later steps.
create or replace function public._sp_order(
  p_org uuid, p_supplier uuid, p_lines jsonb, p_receive_qty numeric default 0,
  p_tag text default 'o'
)
returns uuid
language plpgsql
as $$
declare
  v_order public.procurement_orders;
  v_order_id uuid;
  v_line_id uuid;
begin
  v_order := public.create_procurement_order(p_org, p_supplier, null, '2026-11-01', null, 'order', p_lines, gen_random_uuid());
  v_order_id := v_order.id;
  perform public.approve_procurement_order(p_org, v_order_id, gen_random_uuid());
  perform public.send_procurement_order(p_org, v_order_id, gen_random_uuid());
  perform public.confirm_procurement_order(p_org, v_order_id, gen_random_uuid());
  if p_receive_qty > 0 then
    select id into v_line_id from public.procurement_order_lines where organization_id = p_org and order_id = v_order_id order by sort_order, id limit 1;
    perform public.receive_procurement_order(p_org, v_order_id, '2026-11-01 12:00+04', 'rec', null,
      jsonb_build_array(jsonb_build_object('order_line_id', v_line_id, 'quantity', p_receive_qty::text)), gen_random_uuid());
  end if;
  insert into public._sp_vars(k, v) values (p_tag || ':order', v_order_id::text)
    on conflict (k) do update set v = excluded.v;
  select id into v_line_id from public.procurement_order_lines where organization_id = p_org and order_id = v_order_id order by sort_order, id limit 1;
  insert into public._sp_vars(k, v) values (p_tag || ':line', v_line_id::text)
    on conflict (k) do update set v = excluded.v;
  return v_order_id;
end;
$$;

-- Fixtures ----------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','aa000000-0000-0000-0000-000000000001','authenticated','authenticated','sp-owner-a@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','aa000000-0000-0000-0000-000000000002','authenticated','authenticated','sp-sup@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','aa000000-0000-0000-0000-000000000003','authenticated','authenticated','sp-owner-b@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('aa000000-0000-0000-0000-0000000000a1','Supplier Org A'),
('aa000000-0000-0000-0000-0000000000b1','Supplier Org B');
insert into public.organization_memberships(organization_id,user_id,role) values
('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-000000000001','OWNER'),
('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-000000000002','SUPERVISOR'),
('aa000000-0000-0000-0000-0000000000b1','aa000000-0000-0000-0000-000000000003','OWNER');

insert into public.customers(id,organization_id,name) values
('aa000000-0000-0000-0000-0000000000c1','aa000000-0000-0000-0000-0000000000a1','Cust A'),
('aa000000-0000-0000-0000-0000000000c2','aa000000-0000-0000-0000-0000000000b1','Cust B');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('aa000000-0000-0000-0000-0000000000e1','aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000c1','EV-SP-1','Sup Ev','2026-11-01 10:00+04','2026-11-01 20:00+04',100,'Muscat','CONFIRMED','ab000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001');

insert into public.suppliers(id,organization_id,name,category,status,created_by,updated_by) values
('aa000000-0000-0000-0000-0000000000d1','aa000000-0000-0000-0000-0000000000a1','Maint Supplier','GENERAL','ACTIVE','aa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001'),
('aa000000-0000-0000-0000-0000000000d2','aa000000-0000-0000-0000-0000000000b1','Cross Supplier','GENERAL','ACTIVE','aa000000-0000-0000-0000-000000000003','aa000000-0000-0000-0000-000000000003');

-- Act as OWNER of org A.
set local "request.jwt.claims"='{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('aa000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('aa000000-0000-0000-0000-0000000000a1','Petty Cash','CASH',null,null,null,'ac000000-0000-0000-0000-000000000001')$$,'create CASH treasury');
select lives_ok($$select public.set_treasury_opening_balance('aa000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='aa000000-0000-0000-0000-0000000000a1' and name='Petty Cash'),500.000,'ac000000-0000-0000-0000-000000000010')$$,'cash opening 500');

insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('aa000000-0000-0000-0000-0000000000e1','aa000000-0000-0000-0000-0000000000a1','مادة استهلاكية','CONSUMABLE','كغم','PER_UNIT',2.000,4.000);
insert into public.consumable_stock_items(id,organization_id,catalog_item_id,minimum_stock_quantity,created_by) values
('aa000000-0000-0000-0000-0000000000f1','aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000e1',1,'aa000000-0000-0000-0000-000000000001');

-- ======================= Procurement is non-financial ======================= --
select lives_ok($$select public._sp_order('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',
  '[{"line_kind":"CONSUMABLE","catalog_item_id":"aa000000-0000-0000-0000-0000000000e1","quantity":"5.000","agreed_unit_cost":"2.000"}]'::jsonb, 2.000, 'cons')$$,'build CONSUMABLE order + partial receive');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type in ('SUPPLIER_INVOICE','SUPPLIER_PAYMENT','SUPPLIER_INVOICE_VOID','SUPPLIER_PAYMENT_VOID')),0,'no SUPPLIER_* journal from order/receipt');
select is((select public._sp_debit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','5100'))),0.000,'procurement cost unchanged by order/receipt');

-- ======================= Supplier invoice: CONSUMABLE 3-way match ======================= --
-- The cons order received 2; invoice qty 3 (CONSUMABLE) exceeds received => reject.
select throws_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='cons:order'),'aa000000-0000-0000-0000-0000000000e1','CONS-1','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='cons:line'),'quantity','3.000','unit_cost','2.000'))::jsonb)$$,'23514','SUPPLIER_INVOICE_QTY_EXCEEDS_RECEIPT','invoice qty over received rejected (CONSUMABLE)');

-- Build a CONSUMABLE order with NO receipt; invoice without receipt rejected.
select lives_ok($$select public._sp_order('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',
  '[{"line_kind":"CONSUMABLE","catalog_item_id":"aa000000-0000-0000-0000-0000000000e1","quantity":"5.000","agreed_unit_cost":"2.000"}]'::jsonb, 0, 'norec')$$,'build CONSUMABLE order, no receipt');
select throws_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='norec:order'), null, 'CONS-NR','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='norec:line'),'quantity','2.000','unit_cost','2.000'))::jsonb)$$,'23514','SUPPLIER_INVOICE_RECEIPT_REQUIRED','invoice without receipt rejected (CONSUMABLE)');

-- Owner override bypasses the receipt requirement.
select lives_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='norec:order'), null, 'CONS-OR','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='norec:line'),'quantity','2.000','unit_cost','2.000'))::jsonb,null,true,'business accepted without receipt')$$,'owner override allows CONSUMABLE invoice');
select is((select public._sp_credit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','2200'))),4.000,'AP credited 4.000 (2 x 2.000)');
select is((select public._sp_debit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','5100'))),4.000,'procurement cost debited 4.000');

-- ======================= Price tolerance ======================= --
select lives_ok($$select public._sp_order('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',
  '[{"line_kind":"CATERING_SERVICE","description":"خدمة","unit":"وحدة","quantity":"3.000","agreed_unit_cost":"100.000"}]'::jsonb, 0, 'price')$$,'build service order');
select throws_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='price:order'), null, 'PRICE-1','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='price:line'),'quantity','3.000','unit_cost','100.500'))::jsonb)$$,'23514','SUPPLIER_INVOICE_PRICE_TOLERANCE_EXCEEDED','price tolerance exceeded rejected');
select lives_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='price:order'), null, 'PRICE-OR','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='price:line'),'quantity','3.000','unit_cost','100.500'))::jsonb,'x',true,'agreed to higher price')$$,'owner override allows price tolerance');
select is((select public._sp_credit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','2200'))),305.500,'AP credited 4.000 + 301.500 = 305.500');

-- ======================= Supplier payment ======================= --
select lives_ok($$select public.record_supplier_payment('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',50.000,'2026-11-05','CASH',null,'partial payment',null,'ad000000-0000-0000-0000-000000000001')$$,'record supplier payment 50');
select is((select public._sp_credit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','2200'))),255.500,'AP balance after 50 payment = 255.500');
select is((select public._sp_debit('aa000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='aa000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),450.000,'cash 500 - 50 = 450');
select is((select public._supplier_ap_position('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1') >= 0),true,'supplier AP >= 0');

select throws_ok($$select public.record_supplier_payment('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',5000.000,'2026-11-05','CASH',null,'too big',null,'ad000000-0000-0000-0000-000000000002')$$,'23514','SUPPLIER_PAYMENT_EXCEEDS_AP','overpayment beyond AP rejected');

select lives_ok($$select public.record_supplier_payment('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',50.000,'2026-11-05','CASH',null,'partial payment',null,'ad000000-0000-0000-0000-000000000001')$$,'replay supplier payment');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type='SUPPLIER_PAYMENT' and not is_reversal),1,'no duplicate payment journal on replay');

-- ======================= Supplier payment void ======================= --
select lives_ok($$select public.void_supplier_payment('aa000000-0000-0000-0000-0000000000a1',(select id from public.supplier_payments where organization_id='aa000000-0000-0000-0000-0000000000a1' and amount=50.000),'wrong amount','ad000000-0000-0000-0000-000000000003')$$,'void supplier payment');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type='SUPPLIER_PAYMENT_VOID' and is_reversal),1,'one payment reversal');
select is((select public._sp_credit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','2200'))),305.500,'AP restored to 305.500 after payment void');
select is((select public._sp_debit('aa000000-0000-0000-0000-0000000000a1',(select chart_account_id from public.treasury_accounts where organization_id='aa000000-0000-0000-0000-0000000000a1' and name='Petty Cash'))),500.000,'cash restored to 500');
select throws_ok($$select public.void_supplier_payment('aa000000-0000-0000-0000-0000000000a1',(select id from public.supplier_payments where organization_id='aa000000-0000-0000-0000-0000000000a1' and amount=50.000),'again','ad000000-0000-0000-0000-000000000004')$$,'P0001','SUPPLIER_PAYMENT_ALREADY_VOIDED','repeat payment void rejected');

-- ======================= Supplier invoice void ======================= --
select lives_ok($$select public.void_supplier_invoice('aa000000-0000-0000-0000-0000000000a1',(select id from public.supplier_invoices where organization_id='aa000000-0000-0000-0000-0000000000a1' and invoice_number='CONS-OR'),'not needed','ad000000-0000-0000-0000-000000000005')$$,'void CONSUMABLE invoice');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type='SUPPLIER_INVOICE_VOID' and is_reversal),1,'one invoice reversal');
select is((select public._sp_credit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','2200'))),301.500,'AP restored to 301.500 after invoice void');
select is((select public._sp_debit('aa000000-0000-0000-0000-0000000000a1',public._sp_chart('aa000000-0000-0000-0000-0000000000a1','5100'))),301.500,'procurement cost restored to 301.500');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type='SUPPLIER_INVOICE' and not is_reversal),2,'original invoice journals remain (immutable)');
select is((select count(*)::int from public.journal_entries where organization_id='aa000000-0000-0000-0000-0000000000a1' and source_type='SUPPLIER_INVOICE_VOID' and reversal_of is not null),1,'invoice reversal references an original');
select throws_ok($$select public.void_supplier_invoice('aa000000-0000-0000-0000-0000000000a1',(select id from public.supplier_invoices where organization_id='aa000000-0000-0000-0000-0000000000a1' and invoice_number='CONS-OR'),'again','ad000000-0000-0000-0000-000000000006')$$,'P0001','SUPPLIER_INVOICE_ALREADY_VOIDED','repeat invoice void rejected');

-- ======================= Reconciliation ======================= --
select is((select public._supplier_ap_position('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1')),301.500,'reconciled supplier AP = 301.500');
select is((select coalesce(sum(amount),0) from public.supplier_invoices where organization_id='aa000000-0000-0000-0000-0000000000a1' and status='RECORDED'),301.500,'operational RECORDED invoice total');

-- ======================= Authorization / cross-org ======================= --
set local "request.jwt.claims"='{"sub":"aa000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.record_supplier_invoice('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',(select v::uuid from public._sp_vars where k='price:order'), null, 'AUTH-1','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id', (select v::uuid from public._sp_vars where k='price:line'),'quantity','1.000','unit_cost','100.000'))::jsonb)$$,'42501','NOT_AUTHORIZED','SUPERVISOR cannot create supplier invoice');
set local "request.jwt.claims"='{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.record_supplier_payment('aa000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000d1',10.000,'2026-11-05','CASH',null,'cross',null,gen_random_uuid())$$,'42501','NOT_AUTHORIZED','cross-org supplier payment rejected');

select * from finish();
rollback;
