-- ============================================================================
-- SUPPLEMENTARY (Layer A) — minimal pgTAP-compatible shims for NATIVE PostgreSQL
-- ----------------------------------------------------------------------------
-- Lets the OFFICIAL supabase/tests/*.sql pgTAP suite also execute against a
-- plain native PostgreSQL server (scripts/native-db/run.mjs) as a supplementary
-- check. The authoritative pgTAP run is `supabase test db` in CI (Layer B).
--
-- SECURITY INVOKER (like real pgTAP) so that the SQL executed by throws_ok()
-- runs AS THE CALLING ROLE and is subject to RLS. Installed into `public` so
-- the unqualified calls resolve via the default search_path even after
-- `set local role authenticated`. Types are generated from a SEPARATE
-- migrations-only database, so these shims never leak into generated types.
-- ============================================================================

create table if not exists public._pgtap_results (
  id serial primary key,
  ok boolean not null,
  description text not null
);

create table if not exists public._pgtap_plan (
  n int not null
);

grant select, insert, delete on public._pgtap_results to public;
grant select, insert, delete on public._pgtap_plan to public;
grant usage on sequence public._pgtap_results_id_seq to public;

create or replace function public.plan(n int)
returns text
language plpgsql
as $$
begin
  delete from public._pgtap_results;
  delete from public._pgtap_plan;
  insert into public._pgtap_plan (n) values (n);
  return '1..' || n::text;
end;
$$;

create or replace function public.is(actual anyelement, expected anyelement, description text)
returns text
language plpgsql
as $$
declare
  ok boolean := actual is not distinct from expected;
  msg text;
begin
  if ok then
    msg := 'ok - ' || description;
  else
    msg := 'not ok - ' || description
      || ' (expected ' || coalesce(expected::text, 'NULL')
      || ', got ' || coalesce(actual::text, 'NULL') || ')';
  end if;
  insert into public._pgtap_results (ok, description) values (ok, msg);
  return msg;
end;
$$;

create or replace function public.ok(condition boolean, description text)
returns text
language plpgsql
as $$
declare
  msg text;
begin
  if coalesce(condition, false) then
    msg := 'ok - ' || description;
  else
    msg := 'not ok - ' || description;
  end if;
  insert into public._pgtap_results (ok, description)
  values (coalesce(condition, false), msg);
  return msg;
end;
$$;

create or replace function public.isnt(actual anyelement, expected anyelement, description text)
returns text
language plpgsql
as $$
declare
  ok boolean := actual is distinct from expected;
  msg text;
begin
  if ok then
    msg := 'ok - ' || description;
  else
    msg := 'not ok - ' || description
      || ' (both were ' || coalesce(actual::text, 'NULL') || ')';
  end if;
  insert into public._pgtap_results (ok, description) values (ok, msg);
  return msg;
end;
$$;

create or replace function public.lives_ok(sql text, description text)
returns text
language plpgsql
as $$
declare
  msg text;
begin
  begin
    execute sql;
  exception when others then
    msg := 'not ok - ' || description || ' (raised ' || sqlstate || ': ' || sqlerrm || ')';
    insert into public._pgtap_results (ok, description) values (false, msg);
    return msg;
  end;
  msg := 'ok - ' || description;
  insert into public._pgtap_results (ok, description) values (true, msg);
  return msg;
end;
$$;

create or replace function public.throws_ok(sql text, errcode text, errmsg text, description text)
returns text
language plpgsql
as $$
declare
  err_state text;
  msg text;
  ok boolean := false;
begin
  begin
    execute sql;
  exception when others then
    err_state := sqlstate;
    if errcode is null or err_state = errcode then
      ok := true;
      msg := 'ok - ' || description;
    else
      msg := 'not ok - ' || description
        || ' (expected SQLSTATE ' || errcode || ', got ' || err_state || ')';
    end if;
    insert into public._pgtap_results (ok, description) values (ok, msg);
    return msg;
  end;
  msg := 'not ok - ' || description || ' (no exception raised)';
  insert into public._pgtap_results (ok, description) values (false, msg);
  return msg;
end;
$$;

create or replace function public.finish()
returns setof text
language plpgsql
as $$
declare
  r record;
  failed int;
  total int;
  planned int;
begin
  select count(*) into total from public._pgtap_results;
  select count(*) into failed from public._pgtap_results where ok = false;
  select n into planned from public._pgtap_plan limit 1;
  for r in select * from public._pgtap_results order by id loop
    return next r.description;
  end loop;
  if failed > 0 then
    raise exception 'pgTAP: % of % tests failed: %',
      failed, total,
      (select string_agg(description, '; ') from public._pgtap_results where ok = false);
  end if;
  if planned is not null and total <> planned then
    raise exception 'pgTAP: plan was %, but % assertions ran', planned, total;
  end if;
  return;
end;
$$;

grant execute on function public.plan(int) to public;
grant execute on function public.is(anyelement, anyelement, text) to public;
grant execute on function public.ok(boolean, text) to public;
grant execute on function public.isnt(anyelement, anyelement, text) to public;
grant execute on function public.lives_ok(text, text) to public;
grant execute on function public.throws_ok(text, text, text, text) to public;
grant execute on function public.finish() to public;
