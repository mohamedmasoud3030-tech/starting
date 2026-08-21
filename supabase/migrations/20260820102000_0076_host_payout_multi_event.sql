-- ============================================================================
-- 0076 — Host payout across multiple events
--
-- A single host payout can settle earnings from multiple events. The payout
-- header stays in `host_payouts` (append-only financial fact); the per-event
-- split is an explicit, append-only allocation ledger. The whole operation
-- (payout + allocations + optional receipt evidence) is ONE server-authoritative
-- transaction — a payout can never be recorded with missing/failed allocations.
--
-- Canonical relationship: allocations reference the payout; per-event "paid"
-- totals are DERIVED from the allocation ledger + the legacy single-event
-- payout `event_id`. There are no allocation columns on host_payouts itself.
-- ============================================================================

create table public.host_payout_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payout_id uuid not null,
  event_id uuid not null,
  amount numeric(12,3) not null check (amount > 0),
  created_at timestamptz not null default now(),

  constraint host_payout_allocations_org_payout_fk
    foreign key (organization_id, payout_id)
    references public.host_payouts(organization_id, id) on delete restrict,
  constraint host_payout_allocations_org_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint host_payout_allocations_org_id_unique unique (organization_id, id),
  constraint host_payout_allocations_org_payout_event_unique
    unique (organization_id, payout_id, event_id)
);

create index host_payout_allocations_payout_idx
  on public.host_payout_allocations (organization_id, payout_id, id);
create index host_payout_allocations_event_idx
  on public.host_payout_allocations (organization_id, event_id, id);

-- Allocations are immutable append-only facts.
create or replace function public.host_payout_allocation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'HOST_PAYOUT_ALLOCATION_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger host_payout_allocations_guard
  before update or delete on public.host_payout_allocations
  for each row execute function public.host_payout_allocation_guard();

-- Financial closure blocks allocation mutation exactly like the payout header.
create trigger host_payout_allocations_financial_guard
  before insert or update or delete on public.host_payout_allocations
  for each row execute function public.guard_event_financially_closed();

alter table public.host_payout_allocations enable row level security;

create policy "host_payout_allocations_cost_reader_select" on public.host_payout_allocations
  for select using (public.can_read_cost(organization_id));

revoke all on table public.host_payout_allocations from anon, authenticated;
grant select on table public.host_payout_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- record_host_payout_multi — payout + allocations + optional receipt receipt,
-- all in one transaction. OWNER/MANAGER/ACCOUNTANT.
-- ---------------------------------------------------------------------------
create or replace function public.record_host_payout_multi(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_payout_date date,
  p_payment_method public.payment_method,
  p_reference text,
  p_reason text,
  p_allocations jsonb,
  p_evidence_path text default null,
  p_evidence_file_name text default null,
  p_evidence_mime_type text default null,
  p_evidence_size_bytes bigint default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.host_payouts;
  v_fingerprint text;
  v_replay jsonb;
  v_len integer;
  v_item jsonb;
  v_event_id uuid;
  v_amount numeric;
  v_sum numeric(12,3) := 0;
  v_alloc_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payout_date is null then
    raise exception 'PAYOUT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'PAYOUT_ALLOCATIONS_INVALID' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_HOST_PAYOUT_MULTI',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'payout_date', p_payout_date,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'allocations', p_allocations,
    'evidence_path', nullif(trim(coalesce(p_evidence_path, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  -- Serialize payouts for the same host so the allocation total can never
  -- race a concurrent payout.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_staff_member_id::text, 2)
  );

  v_len := jsonb_array_length(p_allocations);
  for i in 0..v_len - 1 loop
    v_item := p_allocations -> i;
    v_event_id := nullif(v_item ->> 'event_id', '')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    if v_event_id is null then
      raise exception 'PAYOUT_ALLOCATION_EVENT_REQUIRED' using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'PAYOUT_ALLOCATION_AMOUNT_INVALID' using errcode = '22023';
    end if;
    -- Precision check on the RAW value before it is ever cast to numeric(12,3),
    -- so a 4-decimal JSON amount is rejected rather than silently rounded.
    if round(v_amount, 3) <> v_amount then
      raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
    end if;
    if v_amount > 999999999.999 then
      raise exception 'OMR_AMOUNT_OUT_OF_RANGE' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.events e
       where e.organization_id = p_org_id and e.id = v_event_id
    ) then
      raise exception 'PAYOUT_ALLOCATION_EVENT_NOT_IN_ORG' using errcode = '23503';
    end if;
    v_sum := v_sum + v_amount;
    v_alloc_count := v_alloc_count + 1;
  end loop;

  if v_alloc_count > 0 and round(v_sum, 3) <> round(p_amount, 3) then
    raise exception 'PAYOUT_ALLOCATION_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.host_payouts (
    organization_id, staff_member_id, event_id, amount, payout_date,
    payment_method, reference, reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, null, p_amount, p_payout_date,
    p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  for i in 0..v_len - 1 loop
    v_item := p_allocations -> i;
    insert into public.host_payout_allocations (
      organization_id, payout_id, event_id, amount
    ) values (
      p_org_id, v_row.id,
      nullif(v_item ->> 'event_id', '')::uuid,
      (v_item ->> 'amount')::numeric(12,3)
    );
  end loop;

  -- Receipt is evidence attached to the payout (optional; explicit when absent).
  if nullif(trim(coalesce(p_evidence_path, '')), '') is not null then
    perform public.link_evidence(
      p_org_id, 'HOST_PAYOUT_RECEIPT', 'host_payout', v_row.id,
      p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
    );
  end if;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_RECORDED', 'host_payout', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text,
      'allocations', p_allocations
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_HOST_PAYOUT_MULTI', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-event "paid" totals now include allocations (derived relationship).
-- ---------------------------------------------------------------------------
create or replace view public.host_event_payroll_summaries as
select
  a.organization_id,
  a.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  a.event_id,
  e.event_number,
  e.title as event_title,
  count(*) filter (where a.status <> 'VOIDED')::int as attendance_count,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as earned_total,
  0::numeric(14,3) as advances_total,
  (
    coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
    + coalesce((
      select sum(al.amount) from public.host_payout_allocations al
       join public.host_payouts ph
         on ph.organization_id = al.organization_id and ph.id = al.payout_id
       where al.organization_id = a.organization_id
         and al.event_id = a.event_id
         and ph.staff_member_id = a.staff_member_id
         and ph.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as payouts_total,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as due_total,
  (
    coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
    + coalesce((
      select sum(al.amount) from public.host_payout_allocations al
       join public.host_payouts ph
         on ph.organization_id = al.organization_id and ph.id = al.payout_id
       where al.organization_id = a.organization_id
         and al.event_id = a.event_id
         and ph.staff_member_id = a.staff_member_id
         and ph.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as paid_total,
  (
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)
    - (
      coalesce((
        select sum(p.amount) from public.host_payouts p
         where p.organization_id = a.organization_id
           and p.staff_member_id = a.staff_member_id
           and p.event_id = a.event_id
           and p.status = 'RECORDED'
      ), 0)
      + coalesce((
        select sum(al.amount) from public.host_payout_allocations al
         join public.host_payouts ph
           on ph.organization_id = al.organization_id and ph.id = al.payout_id
         where al.organization_id = a.organization_id
           and al.event_id = a.event_id
           and ph.staff_member_id = a.staff_member_id
           and ph.status = 'RECORDED'
      ), 0)
    )
  )::numeric(14,3) as late_total
from public.staff_attendance a
join public.staff_members s
  on s.organization_id = a.organization_id and s.id = a.staff_member_id
join public.events e
  on e.organization_id = a.organization_id and e.id = a.event_id
where public.can_read_cost(a.organization_id)
group by a.organization_id, a.staff_member_id, s.name, s.staff_type,
         a.event_id, e.event_number, e.title;

-- ---------------------------------------------------------------------------
-- get_host_payroll_summary — include allocations in the authoritative rollup.
-- ---------------------------------------------------------------------------
create or replace function public.get_host_payroll_summary(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid default null
)
returns table (
  staff_member_id uuid,
  event_id uuid,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  due_total numeric(14,3),
  paid_total numeric(14,3),
  late_total numeric(14,3),
  attendance_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_read_cost(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  with totals as (
    select
      coalesce(sum(a.earned_amount) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      ), 0)::numeric(14,3) as earned,
      case when p_event_id is null then coalesce((
        select sum(adv.amount)
          from public.staff_advances adv
         where adv.organization_id = p_org_id
           and adv.staff_member_id = p_staff_member_id
           and adv.status = 'RECORDED'
      ), 0) else 0 end::numeric(14,3) as advances,
      coalesce((
        select sum(p.amount)
          from public.host_payouts p
         where p.organization_id = p_org_id
           and p.staff_member_id = p_staff_member_id
           and (p_event_id is null or p.event_id = p_event_id)
           and p.status = 'RECORDED'
      ), 0)::numeric(14,3)
      + coalesce((
        select sum(al.amount)
          from public.host_payout_allocations al
          join public.host_payouts ph
            on ph.organization_id = al.organization_id and ph.id = al.payout_id
         where al.organization_id = p_org_id
           and ph.staff_member_id = p_staff_member_id
           and (p_event_id is null or al.event_id = p_event_id)
           and ph.status = 'RECORDED'
      ), 0)::numeric(14,3) as payouts,
      count(a.id) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      )::int as attendance_count
    from public.staff_attendance a
    where a.organization_id = p_org_id
      and a.staff_member_id = p_staff_member_id
  )
  select
    p_staff_member_id,
    p_event_id,
    t.earned,
    t.advances,
    t.payouts,
    t.earned,
    (t.advances + t.payouts)::numeric(14,3),
    (t.earned - t.advances - t.payouts)::numeric(14,3),
    t.attendance_count
  from totals t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Allocation read model for the payout UI.
-- ---------------------------------------------------------------------------
create view public.host_payout_allocation_summaries as
select
  al.id as allocation_id,
  al.organization_id,
  al.payout_id,
  p.staff_member_id,
  p.payout_date,
  p.status as payout_status,
  al.event_id,
  e.event_number,
  e.title as event_title,
  al.amount,
  al.created_at
from public.host_payout_allocations al
join public.host_payouts p
  on p.organization_id = al.organization_id and p.id = al.payout_id
left join public.events e
  on e.organization_id = al.organization_id and e.id = al.event_id
where public.can_read_cost(al.organization_id);

revoke all on table public.host_payout_allocation_summaries from anon, authenticated;
grant select on table public.host_payout_allocation_summaries to authenticated;

revoke all on function public.host_payout_allocation_guard() from public, anon, authenticated;
revoke all on function public.record_host_payout_multi(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid)
  from public, anon;
grant execute on function public.record_host_payout_multi(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid)
  to authenticated;
