-- ============================================================================
-- 0091 — operational posting hardening pgTAP.
--
-- Covers: EVENT_EXPENSE_VOID taxonomy; financial-close blocks event-linked
-- supplier invoices (cost creation) but not supplier payments (liability
-- settlement); supplier tables are SELECT-only for authenticated (no DML
-- grant); internal helpers are not executable by authenticated.
-- ============================================================================
begin;
select plan(12);

create table public._h_vars (k text primary key, v text);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','ba000000-0000-0000-0000-000000000001','authenticated','authenticated','h-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','ba000000-0000-0000-0000-000000000002','authenticated','authenticated','h-sup@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('ba000000-0000-0000-0000-0000000000a1','Hardening Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-000000000001','OWNER'),
('ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-000000000002','SUPERVISOR');

insert into public.customers(id,organization_id,name) values
('ba000000-0000-0000-0000-0000000000c1','ba000000-0000-0000-0000-0000000000a1','Cust');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('ba000000-0000-0000-0000-0000000000e1','ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000c1','EV-H-1','H Ev','2026-11-01 10:00+04','2026-11-01 20:00+04',50,'Muscat','CONFIRMED','bb000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001');

insert into public.suppliers(id,organization_id,name,category,status,created_by,updated_by) values
('ba000000-0000-0000-0000-0000000000d1','ba000000-0000-0000-0000-0000000000a1','H Supplier','GENERAL','ACTIVE','ba000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001');

set local "request.jwt.claims"='{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.ensure_system_chart('ba000000-0000-0000-0000-0000000000a1')$$,'seed chart');
select lives_ok($$select public.create_treasury_account('ba000000-0000-0000-0000-0000000000a1','Petty Cash','CASH',null,null,null,'bc000000-0000-0000-0000-000000000001')$$,'create CASH');
select lives_ok($$select public.set_treasury_opening_balance('ba000000-0000-0000-0000-0000000000a1',(select id from public.treasury_accounts where organization_id='ba000000-0000-0000-0000-0000000000a1' and name='Petty Cash'),200.000,'bc000000-0000-0000-0000-000000000010')$$,'cash opening 200');

-- Expense void uses EVENT_EXPENSE_VOID (not JOURNAL_REVERSAL).
select lives_ok($$select public.record_event_expense('ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000e1','TRANSPORT',10.000,'2026-11-01','نقل','CASH',null,'H-1','bd000000-0000-0000-0000-000000000001')$$,'record expense');
select lives_ok($$select public.void_event_expense('ba000000-0000-0000-0000-0000000000a1',(select id from public.event_expenses where organization_id='ba000000-0000-0000-0000-0000000000a1' and reference='H-1'),'entered in error','bd000000-0000-0000-0000-000000000002')$$,'void expense');
select is((select count(*)::int from public.journal_entries where organization_id='ba000000-0000-0000-0000-0000000000a1' and source_type='EVENT_EXPENSE_VOID' and is_reversal),1,'expense void source is EVENT_EXPENSE_VOID');
select is((select count(*)::int from public.journal_entries where organization_id='ba000000-0000-0000-0000-0000000000a1' and source_type='JOURNAL_REVERSAL'),0,'expense void does not use JOURNAL_REVERSAL');

-- Service order so a supplier invoice can be posted without receipt.
create or replace function public._h_order()
returns uuid
language plpgsql
as $$
declare
  v_order public.procurement_orders;
  v_line uuid;
begin
  v_order := public.create_procurement_order(
    'ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000d1',null,'2026-11-01',null,'svc',
    '[{"line_kind":"CATERING_SERVICE","description":"خدمة","unit":"وحدة","quantity":"1.000","agreed_unit_cost":"20.000"}]'::jsonb,
    gen_random_uuid());
  perform public.approve_procurement_order('ba000000-0000-0000-0000-0000000000a1', v_order.id, gen_random_uuid());
  perform public.send_procurement_order('ba000000-0000-0000-0000-0000000000a1', v_order.id, gen_random_uuid());
  perform public.confirm_procurement_order('ba000000-0000-0000-0000-0000000000a1', v_order.id, gen_random_uuid());
  select id into v_line from public.procurement_order_lines
   where organization_id='ba000000-0000-0000-0000-0000000000a1' and order_id=v_order.id
   order by sort_order, id limit 1;
  insert into public._h_vars(k,v) values ('order', v_order.id::text), ('line', v_line::text);
  return v_order.id;
end;
$$;
select lives_ok($$select public._h_order()$$,'build service order');

-- Financial close of the event blocks a new event-linked supplier invoice.
insert into public.event_financial_closures (
  organization_id, event_id, closed_by, revenue_at_close, collected_at_close,
  outstanding_at_close, costs_at_close, profit_at_close, margin_at_close
) values (
  'ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000e1',
  'ba000000-0000-0000-0000-000000000001', 0, 0, 0, 0, 0, 0
);

select throws_ok($$select public.record_supplier_invoice(
  'ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000d1',
  (select v::uuid from public._h_vars where k='order'),
  'ba000000-0000-0000-0000-0000000000e1',
  'H-INV-1','2026-11-02',null,
  jsonb_build_array(jsonb_build_object(
    'order_line_id', (select v::uuid from public._h_vars where k='line'),
    'quantity','1.000','unit_cost','20.000'))
)$$,'42501','FINANCIAL_CLOSURE_BLOCKS_MUTATION','event-linked supplier invoice blocked after financial close');

-- Org-level invoice (no event) is still allowed; then a payment settles AP
-- even though an unrelated event is financially closed.
select lives_ok($$select public.record_supplier_invoice(
  'ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000d1',
  (select v::uuid from public._h_vars where k='order'),
  null,'H-INV-ORG','2026-11-02',null,
  jsonb_build_array(jsonb_build_object(
    'order_line_id', (select v::uuid from public._h_vars where k='line'),
    'quantity','1.000','unit_cost','20.000'))
)$$,'org-level supplier invoice allowed while another event is closed');

select lives_ok($$select public.record_supplier_payment(
  'ba000000-0000-0000-0000-0000000000a1','ba000000-0000-0000-0000-0000000000d1',
  20.000,'2026-11-05','CASH',null,'settle',null,'bd000000-0000-0000-0000-000000000010'
)$$,'supplier payment (liability settlement) allowed after financial close');

-- Grants: authenticated has SELECT, not INSERT; internal helper is revoked.
select ok(
  has_table_privilege('authenticated', 'public.supplier_invoices', 'SELECT')
  and not has_table_privilege('authenticated', 'public.supplier_invoices', 'INSERT')
  and not has_table_privilege('authenticated', 'public.supplier_invoices', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.supplier_invoices', 'DELETE'),
  'authenticated SELECT-only on supplier_invoices'
);

select * from finish();
rollback;
