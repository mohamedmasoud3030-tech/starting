-- ============================================================================
-- R10 — canonical command idempotency architecture guard
--
-- Prevent regression to per-domain physical replay tables and prove that the
-- canonical register remains internal-only while deprecated relation names are
-- read-only compatibility views rather than duplicate storage.
-- ============================================================================
begin;
select plan(12);

select is(
  (select c.relkind::text
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'command_idempotency'),
  'r',
  'command_idempotency is the one physical replay table'
);

select is(
  (select c.relkind::text
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'procurement_command_idempotency'),
  'v',
  'procurement legacy relation is a compatibility view'
);
select is(
  (select c.relkind::text
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'payments_command_idempotency'),
  'v',
  'payments legacy relation is a compatibility view'
);
select is(
  (select c.relkind::text
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'staff_payroll_command_idempotency'),
  'v',
  'staff legacy relation is a compatibility view'
);

select is(
  (select count(*)::int
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'procurement_command_idempotency',
        'payments_command_idempotency',
        'staff_payroll_command_idempotency'
      )
      and c.relkind in ('r', 'p')),
  0,
  'no legacy idempotency relation owns physical storage'
);

select ok(
  (select c.relrowsecurity
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'command_idempotency'),
  'canonical replay table has RLS enabled'
);

select is(
  (
    select string_agg(a.attname, ',' order by key_column.ordinality)
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral unnest(i.indkey) with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute a
        on a.attrelid = c.oid and a.attnum = key_column.attnum
     where n.nspname = 'public'
       and c.relname = 'command_idempotency'
       and i.indisprimary
  ),
  'organization_id,command_scope,idempotency_key',
  'canonical primary key namespaces retries by organization and command scope'
);

select ok(
  not has_table_privilege('authenticated', 'public.command_idempotency', 'SELECT'),
  'authenticated clients cannot read the canonical replay register'
);
select ok(
  not has_table_privilege('authenticated', 'public.payments_command_idempotency', 'SELECT'),
  'authenticated clients cannot read compatibility replay views'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_procurement_command(uuid,uuid,text)',
    'EXECUTE'
  ),
  'procurement replay helper remains internal-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_payment_command(uuid,uuid,text)',
    'EXECUTE'
  ),
  'payment replay helper remains internal-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_staff_command(uuid,uuid,text)',
    'EXECUTE'
  ),
  'staff replay helper remains internal-only'
);

select * from finish();
rollback;
