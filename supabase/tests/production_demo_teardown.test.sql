-- pgTAP — production must not inherit the temporary public-demo capability.
begin;
select plan(7);

select ok(
  not pg_has_role('anon', 'public_demo_admin', 'MEMBER'),
  'anon no longer inherits public_demo_admin'
);

select ok(
  not has_table_privilege('anon', 'public.events', 'SELECT'),
  'anon cannot read events through inherited demo grants'
);

select ok(
  not has_table_privilege('anon', 'public.events', 'INSERT'),
  'anon cannot create events through inherited demo grants'
);

select ok(
  not has_table_privilege('public_demo_admin', 'public.events', 'SELECT'),
  'legacy public_demo_admin role is inert for tables'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.event_readiness(uuid,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'anon cannot execute application RPCs through the retired demo role'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.event_readiness(uuid,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'authenticated application RPC access remains available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.is_org_member(uuid)'::regprocedure,
    'EXECUTE'
  ),
  'authenticated authorization helper access remains available'
);

select * from finish();
rollback;
