-- ============================================================================
-- 0049 — R10 canonical command idempotency consolidation
--
-- Replace three physically duplicated command replay registers with one
-- canonical internal register while preserving every existing RPC contract.
-- Compatibility views keep old read-only relation names available during the
-- transition; command helpers are rewired to the canonical table.
-- ============================================================================

create table public.command_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_scope text not null check (command_scope in ('PROCUREMENT', 'PAYMENTS', 'STAFF')),
  idempotency_key uuid not null,
  command_name text not null check (length(trim(command_name)) > 0),
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  result_entity text not null check (length(trim(result_entity)) > 0),
  result_id uuid not null,
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, command_scope, idempotency_key)
);

insert into public.command_idempotency (
  organization_id, command_scope, idempotency_key, command_name,
  request_fingerprint, result_entity, result_id, response_payload, actor_id,
  created_at
)
select organization_id, 'PROCUREMENT', idempotency_key, command_name,
       request_fingerprint, result_entity, result_id, response_payload, actor_id,
       created_at
  from public.procurement_command_idempotency
union all
select organization_id, 'PAYMENTS', idempotency_key, command_name,
       request_fingerprint, result_entity, result_id, response_payload, actor_id,
       created_at
  from public.payments_command_idempotency
union all
select organization_id, 'STAFF', idempotency_key, command_name,
       request_fingerprint, result_entity, result_id, response_payload, actor_id,
       created_at
  from public.staff_payroll_command_idempotency;

create or replace function public.begin_command(
  p_org_id uuid,
  p_command_scope text,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.command_idempotency;
begin
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  if p_command_scope not in ('PROCUREMENT', 'PAYMENTS', 'STAFF') then
    raise exception 'INVALID_COMMAND_SCOPE' using errcode = '22023';
  end if;

  -- Preserve the historical cross-domain lock key. This is intentionally
  -- stricter than the scoped primary key and therefore cannot weaken existing
  -- concurrency guarantees.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
    from public.command_idempotency i
   where i.organization_id = p_org_id
     and i.command_scope = p_command_scope
     and i.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_existing.response_payload;
  end if;

  return null;
end;
$$;

create or replace function public.finish_command(
  p_org_id uuid,
  p_command_scope text,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_command_scope not in ('PROCUREMENT', 'PAYMENTS', 'STAFF') then
    raise exception 'INVALID_COMMAND_SCOPE' using errcode = '22023';
  end if;

  insert into public.command_idempotency (
    organization_id, command_scope, idempotency_key, command_name,
    request_fingerprint, result_entity, result_id, response_payload, actor_id
  ) values (
    p_org_id, p_command_scope, p_idempotency_key, p_command_name,
    p_fingerprint, p_result_entity, p_result_id, p_response, auth.uid()
  );
end;
$$;

create or replace function public.begin_procurement_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.begin_command(p_org_id, 'PROCUREMENT', p_idempotency_key, p_fingerprint)
$$;

create or replace function public.finish_procurement_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.finish_command(
    p_org_id, 'PROCUREMENT', p_idempotency_key, p_command_name,
    p_fingerprint, p_result_entity, p_result_id, p_response
  )
$$;

create or replace function public.begin_payment_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.begin_command(p_org_id, 'PAYMENTS', p_idempotency_key, p_fingerprint)
$$;

create or replace function public.finish_payment_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.finish_command(
    p_org_id, 'PAYMENTS', p_idempotency_key, p_command_name,
    p_fingerprint, p_result_entity, p_result_id, p_response
  )
$$;

create or replace function public.begin_staff_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.begin_command(p_org_id, 'STAFF', p_idempotency_key, p_fingerprint)
$$;

create or replace function public.finish_staff_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.finish_command(
    p_org_id, 'STAFF', p_idempotency_key, p_command_name,
    p_fingerprint, p_result_entity, p_result_id, p_response
  )
$$;

-- Remove duplicated physical storage.
drop table public.procurement_command_idempotency;
drop table public.payments_command_idempotency;
drop table public.staff_payroll_command_idempotency;

-- Read-only compatibility projections keep existing diagnostics and tests valid
-- without reintroducing duplicate storage.
create view public.procurement_command_idempotency with (security_invoker=true) as
select organization_id, idempotency_key, command_name, request_fingerprint,
       result_entity, result_id, response_payload, actor_id, created_at
  from public.command_idempotency
 where command_scope = 'PROCUREMENT';

create view public.payments_command_idempotency with (security_invoker=true) as
select organization_id, idempotency_key, command_name, request_fingerprint,
       result_entity, result_id, response_payload, actor_id, created_at
  from public.command_idempotency
 where command_scope = 'PAYMENTS';

create view public.staff_payroll_command_idempotency with (security_invoker=true) as
select organization_id, idempotency_key, command_name, request_fingerprint,
       result_entity, result_id, response_payload, actor_id, created_at
  from public.command_idempotency
 where command_scope = 'STAFF';

alter table public.command_idempotency enable row level security;
-- No RLS policy: this is internal replay machinery, never a client read model.

revoke all on table public.command_idempotency from anon, authenticated;
revoke all on table public.procurement_command_idempotency from anon, authenticated;
revoke all on table public.payments_command_idempotency from anon, authenticated;
revoke all on table public.staff_payroll_command_idempotency from anon, authenticated;

revoke all on function public.begin_command(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_command(uuid, text, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;

comment on table public.command_idempotency is
  'Canonical internal replay/idempotency register for transactional commands.';
comment on view public.procurement_command_idempotency is
  'Deprecated compatibility projection. Canonical storage: command_idempotency.';
comment on view public.payments_command_idempotency is
  'Deprecated compatibility projection. Canonical storage: command_idempotency.';
comment on view public.staff_payroll_command_idempotency is
  'Deprecated compatibility projection. Canonical storage: command_idempotency.';
