-- ============================================================================
-- 0048 — Supabase security-advisor hardening
--
-- Recovered verbatim from the applied production migration history so the
-- repository and production schema history are aligned again.
-- ============================================================================

-- RLS init-plan hardening.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);

-- Move relocatable btree_gist out of the exposed public schema.
create schema if not exists extensions;
do $$
declare v_schema text; v_relocatable boolean;
begin
  select n.nspname,e.extrelocatable into v_schema,v_relocatable
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
   where e.extname='btree_gist';
  if found and v_schema='public' and v_relocatable then
    alter extension btree_gist set schema extensions;
  end if;
end $$;

-- Remove anonymous execution from privileged helpers; keep explicit
-- authenticated access only where the client contract requires it.
do $$
begin
  if pg_catalog.to_regprocedure('public.is_org_member(uuid)') is not null then
    revoke execute on function public.is_org_member(uuid) from public, anon;
    grant execute on function public.is_org_member(uuid) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.has_org_role(uuid,public.app_role[])') is not null then
    revoke execute on function public.has_org_role(uuid,public.app_role[]) from public, anon;
    grant execute on function public.has_org_role(uuid,public.app_role[]) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.can_manage_commercial(uuid)') is not null then
    revoke execute on function public.can_manage_commercial(uuid) from public, anon;
    grant execute on function public.can_manage_commercial(uuid) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.can_read_cost(uuid)') is not null then
    revoke execute on function public.can_read_cost(uuid) from public, anon;
    grant execute on function public.can_read_cost(uuid) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.get_host_payroll_summary(uuid,uuid,uuid)') is not null then
    revoke execute on function public.get_host_payroll_summary(uuid,uuid,uuid) from public, anon;
    grant execute on function public.get_host_payroll_summary(uuid,uuid,uuid) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.today_attendance_gaps(uuid,timestamp with time zone)') is not null then
    revoke execute on function public.today_attendance_gaps(uuid,timestamptz) from public, anon;
    grant execute on function public.today_attendance_gaps(uuid,timestamptz) to authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.handle_new_user()') is not null then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Capture all current view definitions before replacing any of them. Empty
-- search_path forces fully-qualified deparse, so helper bodies stay safe with
-- SET search_path=''.
set local search_path = '';
create temporary table _view_hardening_plan on commit drop as
select
  c.relname as view_name,
  pg_catalog.pg_get_viewdef(c.oid,false) as view_definition,
  (
    select pg_catalog.string_agg(
      pg_catalog.format('%I %s',a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod)),', ' order by a.attnum
    )
    from pg_catalog.pg_attribute a
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  ) as return_columns,
  (
    select pg_catalog.string_agg(
      pg_catalog.format('f.%I::%s as %I',a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attname),', ' order by a.attnum
    )
    from pg_catalog.pg_attribute a
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  ) as cast_select
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v';

do $$
declare
  v record;
  v_helper text;
begin
  for v in select * from pg_temp._view_hardening_plan order by view_name loop
    v_helper := '_view_' || v.view_name;

    execute pg_catalog.format(
      'create function public.%I() returns table(%s) language sql stable security definer set search_path = '''' as $fn$ %s $fn$',
      v_helper,v.return_columns,v.view_definition
    );
    execute pg_catalog.format('revoke all on function public.%I() from public, anon, authenticated',v_helper);
    execute pg_catalog.format('grant execute on function public.%I() to authenticated',v_helper);

    execute pg_catalog.format(
      'create or replace view public.%I with (security_invoker=true) as select %s from public.%I() f',
      v.view_name,v.cast_select,v_helper
    );
    execute pg_catalog.format('revoke all on table public.%I from anon, authenticated',v.view_name);
    execute pg_catalog.format('grant select on table public.%I to authenticated',v.view_name);
  end loop;
end $$;
