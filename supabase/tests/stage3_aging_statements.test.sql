-- ============================================================================
-- 0096 — Stage 3 read models: AR / AP / contract-asset aging + supplier
-- statement + customer statement enhanced with allocation (contract §20).
--
-- Pre-0096 run: fails with undefined functions (missing-surface proof).
-- Post-0096: proves gross semantics, lifecycle, voids, buckets, pagination,
-- ordering, allocation detail, organization isolation and authorization.
-- ============================================================================
begin;
select plan(79);

create or replace function public._s3_raw(p_org uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
   where l.organization_id = p_org
     and l.account_id = (select id from public.chart_of_accounts
                          where organization_id = p_org and code = p_code);
$$;
create or replace function public._s3_trial_zero(p_org uuid)
returns numeric language sql stable as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines where organization_id = p_org;
$$;
create table if not exists public._s3_vars(k text primary key, v text);

-- Supplier order lifecycle helper (mirrors supplier_ap_posting.test.sql).
create or replace function public._s3_order(
  p_org uuid, p_supplier uuid, p_lines jsonb, p_tag text default 'o'
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
  select id into v_line_id from public.procurement_order_lines
   where organization_id = p_org and order_id = v_order_id
   order by sort_order, id limit 1;
  insert into public._s3_vars(k, v) values (p_tag || ':order', v_order_id::text), (p_tag || ':line', v_line_id::text)
    on conflict (k) do update set v = excluded.v;
  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. O1 VAT org (5%), O2 non-VAT, O3 empty. u2 = outsider.
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','9c000000-0000-0000-0000-000000000001','authenticated','authenticated','s3-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','9c000000-0000-0000-0000-000000000002','authenticated','authenticated','s3-outsider@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('9c000000-0000-0000-0000-0000000000a1','S3 VAT Org'),
('9c000000-0000-0000-0000-0000000000b1','S3 NonVAT Org'),
('9c000000-0000-0000-0000-0000000000c1','S3 Empty Org');
insert into public.organization_memberships(organization_id,user_id,role) values
('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-000000000001','OWNER'),
('9c000000-0000-0000-0000-0000000000b1','9c000000-0000-0000-0000-000000000001','OWNER'),
('9c000000-0000-0000-0000-0000000000c1','9c000000-0000-0000-0000-000000000001','OWNER');

insert into public.customers(id,organization_id,name) values
('9c000000-0000-0000-0000-0000000000c2','9c000000-0000-0000-0000-0000000000a1','Cust S3V'),
('9c000000-0000-0000-0000-0000000000c3','9c000000-0000-0000-0000-0000000000b1','Cust S3N');
insert into public.suppliers(id,organization_id,name,category,status,created_by,updated_by) values
('9c000000-0000-0000-0000-0000000000d1','9c000000-0000-0000-0000-0000000000a1','Supplier S3','CATERING_RESTAURANT','ACTIVE','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001');

insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
('9c000000-0000-0000-0000-0000000000e1','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000c2','EV-S3-1','Invoiced','2026-10-01 10:00+04','2026-10-01 20:00+04',10,'Muscat','CONFIRMED','9c100000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001'),
('9c000000-0000-0000-0000-0000000000e2','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000c2','EV-S3-2','ClosedUnbilled','2026-10-02 10:00+04','2026-10-02 20:00+04',10,'Muscat','CONFIRMED','9c100000-0000-0000-0000-000000000002','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001'),
('9c000000-0000-0000-0000-0000000000e3','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000c2','EV-S3-3','VoidedDeposit','2026-10-03 10:00+04','2026-10-03 20:00+04',10,'Muscat','CONFIRMED','9c100000-0000-0000-0000-000000000003','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001'),
('9c000000-0000-0000-0000-0000000000e4','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000c2','EV-S3-4','Pagination','2026-10-04 10:00+04','2026-10-04 20:00+04',10,'Muscat','CONFIRMED','9c100000-0000-0000-0000-000000000004','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001'),
('9c000000-0000-0000-0000-0000000000e5','9c000000-0000-0000-0000-0000000000b1','9c000000-0000-0000-0000-0000000000c3','EV-S3-NV','NonVAT AR','2026-10-05 10:00+04','2026-10-05 20:00+04',10,'Muscat','CONFIRMED','9c100000-0000-0000-0000-000000000005','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001');

insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,pre_vat_total,vat_registered,vat_percent,vat_amount,idempotency_key,issued_by,accepted_by,accepted_at) values
('9c000000-0000-0000-0000-0000000000f1','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e1','QT-S3-1',1,'ACCEPTED','Cust','EV-S3-1','Invoiced',10,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',2100.000,1000.000,1100.000,2000.000,true,5.000,100.000,'9c100000-0000-0000-0000-000000000011','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001',now()),
('9c000000-0000-0000-0000-0000000000f2','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','QT-S3-2',1,'ACCEPTED','Cust','EV-S3-2','ClosedUnbilled',10,'2026-10-02 10:00+04','2026-10-02 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9c100000-0000-0000-0000-000000000012','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001',now()),
('9c000000-0000-0000-0000-0000000000f3','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e3','QT-S3-3',1,'ACCEPTED','Cust','EV-S3-3','VoidedDeposit',10,'2026-10-03 10:00+04','2026-10-03 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9c100000-0000-0000-0000-000000000013','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001',now()),
('9c000000-0000-0000-0000-0000000000f4','9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e4','QT-S3-4',1,'ACCEPTED','Cust','EV-S3-4','Pagination',10,'2026-10-04 10:00+04','2026-10-04 20:00+04','Muscat',1050.000,500.000,550.000,1000.000,true,5.000,50.000,'9c100000-0000-0000-0000-000000000014','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001',now()),
('9c000000-0000-0000-0000-0000000000f5','9c000000-0000-0000-0000-0000000000b1','9c000000-0000-0000-0000-0000000000e5','QT-S3-5',1,'ACCEPTED','Cust','EV-S3-NV','NonVAT AR',10,'2026-10-05 10:00+04','2026-10-05 20:00+04','Muscat',100.000,40.000,60.000,100.000,false,0,0.000,'9c100000-0000-0000-0000-000000000015','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001',now());
update public.events set accepted_quotation_id='9c000000-0000-0000-0000-0000000000f1' where id='9c000000-0000-0000-0000-0000000000e1';
update public.events set accepted_quotation_id='9c000000-0000-0000-0000-0000000000f2' where id='9c000000-0000-0000-0000-0000000000e2';
update public.events set accepted_quotation_id='9c000000-0000-0000-0000-0000000000f3' where id='9c000000-0000-0000-0000-0000000000e3';
update public.events set accepted_quotation_id='9c000000-0000-0000-0000-0000000000f4' where id='9c000000-0000-0000-0000-0000000000e4';
update public.events set accepted_quotation_id='9c000000-0000-0000-0000-0000000000f5' where id='9c000000-0000-0000-0000-0000000000e5';

set local "request.jwt.claims"='{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.ensure_system_chart('9c000000-0000-0000-0000-0000000000a1')$$,'chart O1');                    -- 1
select lives_ok($$select public.create_treasury_account('9c000000-0000-0000-0000-0000000000a1','Main Cash','CASH',null,null,null,'9c200000-0000-0000-0000-000000000001')$$,'treasury O1'); -- 2
select lives_ok($$select public.ensure_system_chart('9c000000-0000-0000-0000-0000000000b1')$$,'chart O2');                    -- 3
select lives_ok($$select public.ensure_system_chart('9c000000-0000-0000-0000-0000000000c1')$$,'chart O3');                    -- 4

-- ===========================================================================
-- E1 (VAT): deposit 1050 -> invoice 2100 -> settle 1050.
-- ===========================================================================
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e1',1050.000,'CASH','D-1',null,now(),'9c200000-0000-0000-0000-000000000011')$$,'E1 deposit');   -- 5
select is((select count(*)::int from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1')),0,'no AR before invoicing');   -- 6
select lives_ok($$select public.create_event_invoice('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e1','INV-S3-1',null,2100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-10","amount":"1050.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-01","amount":"1050.000"}]'::jsonb,null,'9c200000-0000-0000-0000-000000000012')$$,'E1 invoice');   -- 7
select is((select ar_gross from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-1'),1050.000,'AR gross 1050 after invoice (net+rem VAT-alloc)');   -- 8
select is((select aging_bucket from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-1'),'CURRENT','AR bucket CURRENT at age 0');   -- 9
select is((select age_days from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-1'),0,'AR age 0 on invoice day');   -- 10

-- Customer statement: payment, invoice, deposit-applied. Running = 1050.
select is((select count(*)::int from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1')),3,'E1 statement rows: payment+invoice+applied');   -- 11
select is((select array_agg(source_type::text order by entry_date, created_at, entry_number) from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1'))::text,
  '{CUSTOMER_PAYMENT,INVOICE,CUSTOMER_DEPOSIT_APPLIED}','E1 statement chronological order');   -- 12
select is((select impact_on_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='CUSTOMER_PAYMENT'),-1000.000,'deposit impact = net (raw identity)');   -- 13
select is((select impact_on_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='INVOICE'),2050.000,'invoice impact = net + remaining VAT');   -- 14
select is((select running_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='CUSTOMER_DEPOSIT_APPLIED'),1050.000,'running outstanding 1050 after allocation');   -- 15

-- Allocation enhancement carries gross/net/vat + invoice number.
select is((select (allocations->0->>'gross_amount')::numeric from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='INVOICE'),1050.000,'allocation gross 1050');   -- 16
select is((select (allocations->0->>'net_amount')::numeric from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='INVOICE'),1000.000,'allocation net 1000');   -- 17
select is((select (allocations->0->>'vat_amount')::numeric from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='INVOICE'),50.000,'allocation VAT 50');   -- 18
select is((select allocations->0->>'invoice_number' from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') where source_type='CUSTOMER_PAYMENT'),'INV-S3-1','payment row enhanced with invoice allocation');   -- 19

select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e1',1050.000,'CASH','D-1F',null,now(),'9c200000-0000-0000-0000-000000000013')$$,'E1 settle');   -- 20
select is((select count(*)::int from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-1'),0,'AR gone after settlement');   -- 21
select is((select running_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e1') order by entry_date desc, created_at desc, entry_number desc limit 1),0.000,'E1 running outstanding ends 0');   -- 22
select is((select public._s3_trial_zero('9c000000-0000-0000-0000-0000000000a1')),0.000,'trial balance zero after E1 lifecycle');   -- 23

-- ===========================================================================
-- E2 (VAT): deposit 525 -> CLOSED unbilled -> contract asset aging.
-- ===========================================================================
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2',525.000,'CASH','D-2',null,now(),'9c200000-0000-0000-0000-000000000014')$$,'E2 deposit');   -- 24
select lives_ok($$select public.transition_event_status('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','PREPARING')$$,'E2 preparing');   -- 25
select lives_ok($$select public.transition_event_status('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','DISPATCHED')$$,'E2 dispatched');   -- 26
select lives_ok($$select public.transition_event_status('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','IN_PROGRESS')$$,'E2 in progress');   -- 27
select lives_ok($$select public.transition_event_status('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','RETURNING')$$,'E2 returning');   -- 28
select lives_ok($$select public.transition_event_status('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','CLOSED')$$,'E2 closed');   -- 29
select is((select contract_asset_gross from public.accounting_contract_asset_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-2'),525.000,'CA gross 525 (remaining earned; deposit consumed at close)');   -- 30
select is((select aging_bucket from public.accounting_contract_asset_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-2'),'CURRENT','CA bucket CURRENT');   -- 31
select is((select count(*)::int from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-2'),0,'CLOSED unbilled is CA not AR');   -- 32
select is((select running_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e2') order by entry_date desc, created_at desc, entry_number desc limit 1),525.000,'E2 running outstanding 525 (CA 525, deposit consumed at close)');   -- 33

-- CA reclassification: invoice E2 after CLOSED -> CA to AR.
select lives_ok($$select public.create_event_invoice('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e2','INV-S3-2',null,1050.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-10-15","amount":"525.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-20","amount":"525.000"}]'::jsonb,null,'9c200000-0000-0000-0000-000000000015')$$,'E2 invoice after close');   -- 34
select is((select count(*)::int from public.accounting_contract_asset_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-2'),0,'CA gone after reclassification to AR');   -- 35
select is((select ar_gross from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1') where event_number='EV-S3-2'),525.000,'AR 525 after reclass (remaining gross)');   -- 36

-- ===========================================================================
-- E3 (VAT): deposit then full void — statement restores to 0.
-- ===========================================================================
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e3',630.000,'CASH','D-3',null,now(),'9c200000-0000-0000-0000-000000000016')$$,'E3 deposit');   -- 37
select is((select running_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e3') order by entry_date desc, created_at desc, entry_number desc limit 1),-600.000,'E3 net prepayment running -600');   -- 38
select lives_ok($$select public.void_customer_payment('9c000000-0000-0000-0000-0000000000a1',(select id from public.customer_payments where organization_id='9c000000-0000-0000-0000-0000000000a1' and event_id='9c000000-0000-0000-0000-0000000000e3'),'wrong','9c200000-0000-0000-0000-000000000017')$$,'E3 void');   -- 39
select is((select count(*)::int from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e3')),2,'E3 statement shows payment + void');   -- 40
select is((select running_outstanding from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e3') order by entry_date desc, created_at desc, entry_number desc limit 1),0.000,'E3 running back to 0 after void');   -- 41

-- ===========================================================================
-- E4: three deposits — pagination determinism.
-- ===========================================================================
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e4',105.000,'CASH','P1',null,now(),'9c200000-0000-0000-0000-000000000018')$$,'E4 p1');   -- 42
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e4',105.000,'CASH','P2',null,now(),'9c200000-0000-0000-0000-000000000019')$$,'E4 p2');   -- 43
select lives_ok($$select public.record_customer_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000e4',105.000,'CASH','P3',null,now(),'9c200000-0000-0000-0000-00000000001a')$$,'E4 p3');   -- 44
select is((select count(*)::int from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e4')),3,'E4 three statement rows');   -- 45
select is((select count(*)::int from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e4',null,null,2,0)),2,'E4 page 1 limit 2');   -- 46
select is((select count(*)::int from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e4',null,null,2,2)),1,'E4 page 2 offset 2');   -- 47
select is((select count(distinct entry_number)::int from (
  select entry_number from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e4',null,null,2,0)
  union all
  select entry_number from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1',null,'9c000000-0000-0000-0000-0000000000e4',null,null,2,2)
) p),3,'pagination pages are disjoint and cover all rows');   -- 48

-- ===========================================================================
-- Supplier (O1): service PO -> invoice 100 -> payment 40 -> voids.
-- ===========================================================================
select lives_ok($$select public._s3_order('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1','[{"line_kind":"CATERING_SERVICE","description":"svc","unit":"u","quantity":"2.000","agreed_unit_cost":"50.000"}]'::jsonb,'s3')$$,'service order');   -- 49
select lives_ok($$select public.record_supplier_invoice('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1',(select v::uuid from public._s3_vars where k='s3:order'),null,'SUP-INV-1','2026-11-02',null,jsonb_build_array(jsonb_build_object('order_line_id',(select v::uuid from public._s3_vars where k='s3:line'),'quantity','2.000','unit_cost','50.000'))::jsonb)$$,'supplier invoice 100');   -- 50
select is((select ap_balance from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1') where supplier_name='Supplier S3'),100.000,'AP aging balance 100');   -- 51
select is((select aging_bucket from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1') where supplier_name='Supplier S3'),'CURRENT','AP bucket CURRENT');   -- 52
select is((select count(*)::int from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1')),1,'supplier statement 1 row');   -- 53
select is((select running_balance from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1') order by entry_date desc, created_at desc, entry_number desc limit 1),100.000,'supplier running 100');   -- 54
select is((select document_number from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1') where source_type='SUPPLIER_INVOICE'),'SUP-INV-1','supplier statement document label');   -- 55
select lives_ok($$select public.record_supplier_payment('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1',40.000,'2026-11-05','CASH',null,'partial',null,'9c200000-0000-0000-0000-00000000001b')$$,'supplier payment 40');   -- 56
select is((select ap_balance from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1') where supplier_name='Supplier S3'),60.000,'AP aging balance 60 after partial payment');   -- 57
select is((select running_balance from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1') order by entry_date desc, created_at desc, entry_number desc limit 1),60.000,'supplier running 60');   -- 58
select lives_ok($$select public.void_supplier_payment('9c000000-0000-0000-0000-0000000000a1',(select id from public.supplier_payments where organization_id='9c000000-0000-0000-0000-0000000000a1'),'revert','9c200000-0000-0000-0000-00000000001c')$$,'void supplier payment');   -- 59
select is((select ap_balance from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1') where supplier_name='Supplier S3'),100.000,'AP back to 100 after payment void');   -- 60
select is((select count(*)::int from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1')),3,'supplier statement 3 rows after void');   -- 61
select lives_ok($$select public.void_supplier_invoice('9c000000-0000-0000-0000-0000000000a1',(select id from public.supplier_invoices where organization_id='9c000000-0000-0000-0000-0000000000a1'),'revert invoice','9c200000-0000-0000-0000-00000000001d')$$,'void supplier invoice');   -- 62
select is((select count(*)::int from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1')),0,'AP aging empty after full void');   -- 63
select is((select running_balance from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1') order by entry_date desc, created_at desc, entry_number desc limit 1),0.000,'supplier running 0 after full void');   -- 64
select is((select public._s3_trial_zero('9c000000-0000-0000-0000-0000000000a1')),0.000,'trial balance zero after supplier lifecycle');   -- 65

-- ===========================================================================
-- O2 non-VAT: invoice 100 unpaid — aging value + bucket boundaries.
-- ===========================================================================
select lives_ok($$select public.create_event_invoice('9c000000-0000-0000-0000-0000000000b1','9c000000-0000-0000-0000-0000000000e5','INV-S3-NV',null,100.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-10-15","amount":"50.000"},{"seq":1,"kind":"FINAL","due_date":"2026-10-20","amount":"50.000"}]'::jsonb,null,'9c200000-0000-0000-0000-00000000001e')$$,'O2 invoice');   -- 66
select is((select ar_gross from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000b1') where event_number='EV-S3-NV'),100.000,'non-VAT AR 100');   -- 67
select is((select aging_bucket from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000b1', current_date + 45) where event_number='EV-S3-NV'),'DAYS_31_60','bucket boundary at +45d');   -- 68
select is((select aging_bucket from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000b1', current_date + 100) where event_number='EV-S3-NV'),'OVER_90','bucket boundary at +100d');   -- 69
select is((select count(*)::int from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000b1') where event_number like 'EV-S3-%' and event_number <> 'EV-S3-NV'),0,'no cross-org leakage in AR aging');   -- 70

-- Empty org O3: all aging surfaces empty.
select is((select count(*)::int from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000c1')),0,'empty org AR aging');   -- 71
select is((select count(*)::int from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000c1')),0,'empty org AP aging');   -- 72
select is((select count(*)::int from public.accounting_contract_asset_aging('9c000000-0000-0000-0000-0000000000c1')),0,'empty org CA aging');   -- 73

-- ===========================================================================
-- Security: outsider denied on all five; ledger tables RLS-opaque.
-- ===========================================================================
set local "request.jwt.claims"='{"sub":"9c000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select * from public.accounting_ar_aging('9c000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','ar aging gated');   -- 74
select throws_ok($$select * from public.accounting_ap_aging('9c000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','ap aging gated');   -- 75
select throws_ok($$select * from public.accounting_contract_asset_aging('9c000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','ca aging gated');   -- 76
select throws_ok($$select * from public.accounting_supplier_statement('9c000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-0000000000d1')$$,'42501','NOT_AUTHORIZED','supplier statement gated');   -- 77
select throws_ok($$select * from public.accounting_customer_statement('9c000000-0000-0000-0000-0000000000a1')$$,'42501','NOT_AUTHORIZED','customer statement gated');   -- 78

set local "request.jwt.claims"='{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select count(*) from public.journal_lines$$,'42501',null,'journal_lines direct read stays revoked from authenticated');   -- 79
set local role postgres;

select * from finish();
rollback;
