-- ============================================================================
-- GUARDIAN — canonical schema contract assertions
-- ----------------------------------------------------------------------------
-- Enforces the machine-readable contract in
-- guardian/contract/canonical-contract.json against the LIVE schema:
--   * RLS on every business table
--   * exact NUMERIC money (scale 3, never binary float)
--   * SECURITY DEFINER least privilege (no anon EXECUTE) + pinned search_path
--   * security_invoker views
--   * no anon grants, no DELETE policies on financial/master tables
--   * document-number uniqueness per organization
--   * org-scoped FKs, command-only tables without client write policies
--
-- These assertions are the regression tests for the Guardian's security
-- hardening: they FAIL on the pre-fix schema and must PASS on main.
-- Run via `supabase test db` (authoritative) or the native harness.
-- ============================================================================
begin;
select plan(20);

-- 1. RLS on every business table ---------------------------------------------
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and c.relname not like '\_pgtap\_%'
      and not c.relrowsecurity
  ),
  'RLS is enabled on every business table'
);

-- 2. No money column stored as binary float ----------------------------------
select ok(
  not exists (
    select 1 from information_schema.columns c
    join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
    where c.table_schema='public' and c.table_name not like '\_pgtap\_%'
      and c.column_name ~* 'price|amount|cost|total|balance|paid|due|vat|discount|rate|salary|wage|payout|fee|value|charge'
      and c.data_type in ('double precision','real')
  ),
  'no money column uses a binary float type'
);

-- 3. Money columns have scale 3 (OMR millesimal) -----------------------------
select ok(
  not exists (
    select 1 from information_schema.columns c
    join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
    where c.table_schema='public' and c.table_name not like '\_pgtap\_%'
      and c.column_name ~* 'price|amount|cost|total|balance|paid|due|vat|discount|rate|salary|wage|payout|fee|value|charge'
      and c.data_type='numeric'
      and c.numeric_scale is distinct from 3
  ),
  'every NUMERIC money column has scale 3'
);

-- 4. SECURITY DEFINER functions pin search_path ------------------------------
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and not coalesce(array_to_string(p.proconfig, ';'), '') ~* 'search_path'
  ),
  'every SECURITY DEFINER function pins search_path'
);

-- 5-10. SECURITY DEFINER least privilege (regression for G-0001/G-0002/G-0003)
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_organization_settings'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot EXECUTE save_organization_settings (SECURITY DEFINER)'
);

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='transition_event_status'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot EXECUTE transition_event_status (SECURITY DEFINER)'
);

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guard_event_financially_closed'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot EXECUTE guard_event_financially_closed (trigger helper)'
);

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_organization_settings'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated CAN EXECUTE save_organization_settings'
);

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='transition_event_status'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated CAN EXECUTE transition_event_status'
);

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guard_event_financially_closed'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'guard_event_financially_closed is internal-only (not client-callable)'
);

-- 11. Views: security_invoker OR org-filtered body (never both absent) ---------
-- The hard invariant: a view that is NOT security_invoker must filter its
-- body by organization (can_read_cost / is_org_member / has_org_role); a view
-- that is security_invoker is backstopped by RLS on its base tables. A view
-- with neither would expose every organization's rows.
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m')
      and not coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'
      and pg_get_viewdef(c.oid) !~* 'can_read_cost|is_org_member|has_org_role'
  ),
  'every non-security_invoker view filters its body by organization'
);

-- 12. No anon grants on public relations --------------------------------------
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
    lateral aclexplode(c.relacl) a
    where n.nspname='public' and c.relkind in ('r','v','m','S')
      and a.grantee='anon'::regrole
  ),
  'anon has no grants on public tables/views/sequences'
);

-- 13-14. No DELETE-capable policies on financial / master tables --------------
select ok(
  not exists (
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and p.polcmd in ('d','*')
      and c.relname in ('invoices','invoice_installments','customer_payments','host_payouts',
        'host_payout_allocations','staff_advances','staff_attendance','event_expenses',
        'event_financial_closures','procurement_orders','procurement_order_lines',
        'procurement_receipts','procurement_receipt_lines','consumable_movements',
        'event_equipment_movements','event_warehouse_reconciliations',
        'event_consumable_reconciliations','audit_events')
  ),
  'no DELETE-capable RLS policy on financial tables'
);

select ok(
  not exists (
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and p.polcmd in ('d','*')
      and c.relname in ('catalog_categories','catalog_items','packages','package_items','suppliers','customers','organizations')
  ),
  'no DELETE-capable RLS policy on master-catalog tables'
);

-- 15-18. Document-number uniqueness per organization --------------------------
select ok(
  exists (
    select 1 from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='events' and i.indisunique
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality k(attnum,ord)
           join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum)
          @> array['organization_id','event_number']
  ),
  'events unique (organization_id, event_number)'
);

select ok(
  exists (
    select 1 from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='invoices' and i.indisunique
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality k(attnum,ord)
           join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum)
          @> array['organization_id','invoice_number']
  ),
  'invoices unique (organization_id, invoice_number)'
);

select ok(
  exists (
    select 1 from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='procurement_orders' and i.indisunique
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality k(attnum,ord)
           join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum)
          @> array['organization_id','order_number']
  ),
  'procurement_orders unique (organization_id, order_number)'
);

select ok(
  exists (
    select 1 from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='quotations' and i.indisunique
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality k(attnum,ord)
           join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum)
          @> array['organization_id','quotation_number','revision']
  ),
  'quotations unique (organization_id, quotation_number, revision)'
);

-- 19. Org-scoped FKs include organization_id -----------------------------------
with fk_child as (
  select c.oid,
         (select relname from pg_class where oid=c.conrelid) tbl,
         (select relname from pg_class where oid=c.confrelid) ref_tbl,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(c.conkey) with ordinality k(attnum,ord)
            join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) child_cols
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where n.nspname='public' and c.contype='f'
)
select ok(
  not exists (
    select 1 from fk_child fc
    where fc.child_cols is not null
      and not ('organization_id' = any(fc.child_cols))
      and exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=fc.tbl and column_name='organization_id')
      and exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=fc.ref_tbl and column_name='organization_id')
  ),
  'every FK between org-scoped tables includes organization_id'
);

-- 20. Command-owned tables expose no client INSERT/UPDATE policies -------------
select ok(
  not exists (
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('invoices','invoice_installments','customer_payments','host_payouts',
        'host_payout_allocations','staff_advances','staff_attendance','event_expenses',
        'event_financial_closures','quotations','quotation_lines','event_commercial_lines',
        'procurement_orders','procurement_order_lines','procurement_receipts',
        'procurement_receipt_lines','consumable_movements','event_equipment_movements',
        'event_equipment_reservations','event_warehouse_reconciliations',
        'event_consumable_reconciliations','audit_events','suppliers','attachment_evidence',
        'event_status_history','event_transition_overrides','command_idempotency')
      and p.polcmd in ('a','w','*')
  ),
  'command-owned tables expose no client INSERT/UPDATE policies'
);

select * from finish();
rollback;
