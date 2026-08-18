-- ============================================================================
-- 0069 — Financial closure cycles (Phase D7/D8/D9)
--
-- Financial closure is a BUSINESS EVENT, independent of the operational event
-- status. It is recorded as an append-only cycle history, not a boolean:
--
--   OPEN → FINANCIALLY CLOSED → REOPENED → CLOSED AGAIN → …
--
-- Each row is one closure episode; reopening sets reopened_at/by/reason and
-- NEVER erases the fact that the event was previously closed. The current
-- financial state is DERIVED: an event is financially closed iff it has a row
-- with reopened_at IS NULL. A partial unique index guarantees at most one
-- active closure per event.
--
-- After a financial close, every cost/collection mutation is blocked at the
-- database layer (triggers on customer_payments, host_payouts, staff_attendance
-- and event_expenses) until an explicit reopen — hiding buttons is never the
-- security boundary.
-- ============================================================================

create table public.event_financial_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id),
  close_note text,
  revenue_at_close numeric(14,3),
  collected_at_close numeric(14,3),
  outstanding_at_close numeric(14,3),
  costs_at_close numeric(14,3),
  profit_at_close numeric(14,3),
  margin_at_close numeric(14,3),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  constraint event_financial_closures_org_event_fk
    foreign key (organization_id, event_id) references public.events(organization_id, id) on delete cascade,
  constraint event_financial_closures_org_id_unique unique (organization_id, id),
  constraint event_financial_closures_reopen_shape check (
    (reopened_at is null and reopened_by is null and reopen_reason is null)
    or (reopened_at is not null and reopened_by is not null
        and length(trim(reopen_reason)) >= 3)
  )
);

-- At most one ACTIVE closure (not reopened) per event.
create unique index event_financial_closures_active_unique
  on public.event_financial_closures (event_id)
  where reopened_at is null;

create index event_financial_closures_event_idx
  on public.event_financial_closures (organization_id, event_id, created_at);

alter table public.event_financial_closures enable row level security;

create policy "event_financial_closures_select_cost_role" on public.event_financial_closures
  for select using (public.can_read_cost(organization_id));

revoke all on table public.event_financial_closures from anon;
grant select on table public.event_financial_closures to authenticated;

-- ---------------------------------------------------------------------------
-- Readiness: explainable checklist (soft) + hard gate (revenue & outstanding).
-- ---------------------------------------------------------------------------
create or replace function public.event_financial_readiness(p_org_id uuid, p_event_id uuid)
returns table(check_key text, ok boolean, detail text)
language sql stable security definer set search_path = ''
as $$
  with fin as (
    select * from public.event_finance_summaries
     where organization_id = p_org_id and event_id = p_event_id
  ),
  has_staff as (
    select exists (
      select 1 from public.event_staff_assignments a
       where a.event_id = p_event_id and a.status = 'ACTIVE'
    ) as flag
  )
  select 'revenue', coalesce(f.accepted_revenue, 0) > 0,
    case when coalesce(f.accepted_revenue, 0) > 0
      then 'قيمة المناسبة مثبتة من عرض سعر معتمد'
      else 'لا يوجد عرض سعر معتمد للمناسبة' end
  from fin f
  union all
  select 'outstanding', coalesce(f.outstanding_balance, 0) <= 0,
    case when coalesce(f.outstanding_balance, 0) <= 0
      then 'لا يوجد مبلغ متبقٍ على العميل'
      else 'يوجد مبلغ متبقٍ على العميل: ' || coalesce(f.outstanding_balance, 0)::text || ' OMR' end
  from fin f
  union all
  select 'staff_cost', (not hs.flag) or coalesce(f.staff_cost, 0) > 0,
    case when not hs.flag then 'لا توجد عمالة مخصصة'
         when coalesce(f.staff_cost, 0) > 0 then 'مصاريف العمالة مسجلة: ' || coalesce(f.staff_cost, 0)::text || ' OMR'
         else 'عمالة مخصصة لكن لم تُسجَّل تكلفتها بعد' end
  from fin f cross join has_staff hs;
$$;

revoke all on function public.event_financial_readiness(uuid, uuid) from public, anon, authenticated;
grant execute on function public.event_financial_readiness(uuid, uuid) to authenticated;

-- Hard gate used by the close command: revenue established AND nothing outstanding.
create or replace function public.event_financially_ready(p_org_id uuid, p_event_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(accepted_revenue, 0) > 0 and coalesce(outstanding_balance, 0) <= 0
  from public.event_finance_summaries
  where organization_id = p_org_id and event_id = p_event_id;
$$;

revoke all on function public.event_financially_ready(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- close_event_financially — atomic, idempotent, audited, snapshot-capturing.
-- ---------------------------------------------------------------------------
create or replace function public.close_event_financially(
  p_org_id uuid,
  p_event_id uuid,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_financial_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.event_financial_closures;
  v_fin public.event_finance_summaries;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOSE_EVENT_FINANCIALLY', 'event_id', p_event_id,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_financial_closures, v_replay);
  end if;

  -- Lock the event and re-verify readiness INSIDE the transaction.
  perform 1 from public.events where organization_id = p_org_id and id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Double-close guard: an active closure already exists.
  if exists (
    select 1 from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null
  ) then
    select * into v_closure from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null;
    return v_closure;
  end if;

  select * into v_fin from public.event_finance_summaries
   where organization_id = p_org_id and event_id = p_event_id;
  if not found or coalesce(v_fin.accepted_revenue, 0) <= 0 then
    raise exception 'FINANCIAL_CLOSE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if coalesce(v_fin.outstanding_balance, 0) > 0 then
    raise exception 'FINANCIAL_CLOSE_OUTSTANDING_BALANCE' using errcode = '23514';
  end if;

  insert into public.event_financial_closures (
    organization_id, event_id, closed_at, closed_by, close_note,
    revenue_at_close, collected_at_close, outstanding_at_close,
    costs_at_close, profit_at_close, margin_at_close
  ) values (
    p_org_id, p_event_id, now(), auth.uid(),
    nullif(trim(coalesce(p_note, '')), ''),
    v_fin.accepted_revenue, v_fin.amount_paid, v_fin.outstanding_balance,
    v_fin.actual_cost, v_fin.actual_profit, v_fin.margin_percent
  ) returning * into v_closure;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CLOSE_EVENT_FINANCIALLY', v_fingerprint,
    'event_financial_closure', v_closure.id, to_jsonb(v_closure)
  );
  perform public.record_audit(p_org_id, 'EVENT_FINANCIALLY_CLOSED', 'event', p_event_id::text,
    jsonb_build_object('closure_id', v_closure.id, 'profit', v_closure.profit_at_close::text,
      'revenue', v_closure.revenue_at_close::text));
  return v_closure;
end;
$$;

-- ---------------------------------------------------------------------------
-- reopen_event_financially — explicit, audited, reason required.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_event_financially(
  p_org_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_financial_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.event_financial_closures;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REOPEN_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'REOPEN_EVENT_FINANCIALLY', 'event_id', p_event_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_financial_closures, v_replay);
  end if;

  select * into v_closure from public.event_financial_closures
   where organization_id = p_org_id and event_id = p_event_id and reopened_at is null
   for update;
  if not found then raise exception 'EVENT_NOT_FINANCIALLY_CLOSED' using errcode = 'P0002'; end if;

  update public.event_financial_closures set
    reopened_at = now(), reopened_by = auth.uid(), reopen_reason = trim(p_reason)
  where id = v_closure.id
  returning * into v_closure;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'REOPEN_EVENT_FINANCIALLY', v_fingerprint,
    'event_financial_closure', v_closure.id, to_jsonb(v_closure)
  );
  perform public.record_audit(p_org_id, 'EVENT_FINANCIALLY_REOPENED', 'event', p_event_id::text,
    jsonb_build_object('closure_id', v_closure.id, 'reason', trim(p_reason)));
  return v_closure;
end;
$$;

-- ---------------------------------------------------------------------------
-- D8: block every cost/collection mutation while the event is financially
-- closed. Enforced by BEFORE triggers on the four financial tables — the
-- database, not the UI, is the boundary.
-- ---------------------------------------------------------------------------
create or replace function public.guard_event_financially_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  v_event_id := case TG_OP when 'DELETE' then old.event_id else new.event_id end;
  if v_event_id is not null and exists (
    select 1 from public.event_financial_closures c
     where c.event_id = v_event_id and c.reopened_at is null
  ) then
    raise exception 'FINANCIAL_CLOSURE_BLOCKS_MUTATION' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger customer_payments_financial_guard
  before insert or update or delete on public.customer_payments
  for each row execute function public.guard_event_financially_closed();

create trigger host_payouts_financial_guard
  before insert or update or delete on public.host_payouts
  for each row execute function public.guard_event_financially_closed();

create trigger staff_attendance_financial_guard
  before insert or update or delete on public.staff_attendance
  for each row execute function public.guard_event_financially_closed();

create trigger event_expenses_financial_guard
  before insert or update or delete on public.event_expenses
  for each row execute function public.guard_event_financially_closed();

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
revoke all on function public.close_event_financially(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.reopen_event_financially(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.close_event_financially(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.reopen_event_financially(uuid, uuid, text, uuid) to authenticated;
