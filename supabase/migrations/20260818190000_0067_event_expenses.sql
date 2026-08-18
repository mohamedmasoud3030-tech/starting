-- ============================================================================
-- 0067 — Unified direct-expense model (Phase D1)
--
-- A single, append-only ledger for event direct costs that are NOT already the
-- source of truth in another domain:
--   * PURCHASE cost  → procurement orders (delivered/committed cost)  [not here]
--   * STAFF/SUPERVISION cost → staff payroll earned amounts          [not here]
--   * everything else (transport, fuel, rental, third-party, consumable,
--     damage/loss, other) → event_expenses                          [here]
--
-- This split is deliberate: recording the same purchase again as an expense
-- would double-count it in profitability. The unified profitability view
-- (0068) sums the three sources ONCE each.
--
-- Money is exact OMR numeric(14,3); writes are OWNER/MANAGER/ACCOUNTANT via
-- an idempotent command; every row is append-only with a VOID (non-destructive)
-- lifecycle, matching the customer_payments ledger.
-- ============================================================================

create type public.expense_category as enum (
  'TRANSPORT', 'FUEL', 'RENTAL', 'THIRD_PARTY', 'CONSUMABLE', 'DAMAGE_LOSS', 'OTHER'
);

create table public.event_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  category public.expense_category not null,
  amount numeric(14,3) not null check (amount > 0),
  expense_date date not null,
  description text not null check (length(trim(description)) > 0),
  payment_method public.payment_method,
  payee text,
  reference text,
  status public.customer_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint event_expenses_org_event_fk
    foreign key (organization_id, event_id) references public.events(organization_id, id) on delete restrict,
  constraint event_expenses_org_id_unique unique (organization_id, id),
  constraint event_expenses_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint event_expenses_void_shape check (
    (status = 'VOIDED' and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED' and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index event_expenses_event_idx on public.event_expenses (organization_id, event_id, created_at);

alter table public.event_expenses enable row level security;

create policy "event_expenses_select_cost_role" on public.event_expenses
  for select using (public.can_read_cost(organization_id));

revoke all on table public.event_expenses from anon;
grant select on table public.event_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- record_event_expense — idempotent, append-only, cost-role gated.
-- ---------------------------------------------------------------------------
create or replace function public.record_event_expense(
  p_org_id uuid,
  p_event_id uuid,
  p_category public.expense_category,
  p_amount numeric,
  p_expense_date date,
  p_description text,
  p_payment_method public.payment_method default null,
  p_payee text default null,
  p_reference text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.event_expenses;
  v_event public.events;
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
  perform public.assert_payment_omr(p_amount);
  if length(trim(coalesce(p_description, ''))) = 0 then
    raise exception 'EXPENSE_DESCRIPTION_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_EVENT_EXPENSE',
    'event_id', p_event_id,
    'category', p_category,
    'amount', p_amount::text,
    'expense_date', p_expense_date,
    'description', trim(p_description),
    'payment_method', p_payment_method,
    'payee', nullif(trim(coalesce(p_payee, '')), ''),
    'reference', nullif(trim(coalesce(p_reference, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_expenses, v_replay);
  end if;

  select * into v_event from public.events
   where organization_id = p_org_id and id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_event.status = 'CANCELLED' then raise exception 'EVENT_NOT_EXPENSABLE'; end if;

  insert into public.event_expenses (
    organization_id, event_id, category, amount, expense_date, description,
    payment_method, payee, reference, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_category, p_amount, p_expense_date, trim(p_description),
    p_payment_method, nullif(trim(coalesce(p_payee, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''), auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_expense;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_EVENT_EXPENSE', v_fingerprint,
    'event_expense', v_expense.id, to_jsonb(v_expense)
  );
  perform public.record_audit(p_org_id, 'EVENT_EXPENSE_RECORDED', 'event_expense', v_expense.id::text,
    jsonb_build_object('event_id', p_event_id, 'category', p_category, 'amount', p_amount::text));
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_event_expense — non-destructive void (reason required).
-- ---------------------------------------------------------------------------
create or replace function public.void_event_expense(
  p_org_id uuid,
  p_expense_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.event_expenses;
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
    raise exception 'EXPENSE_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_EVENT_EXPENSE', 'expense_id', p_expense_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_expenses, v_replay);
  end if;

  select * into v_expense from public.event_expenses
   where organization_id = p_org_id and id = p_expense_id for update;
  if not found then raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_expense.status = 'VOIDED' then raise exception 'EXPENSE_ALREADY_VOIDED'; end if;

  update public.event_expenses set
    status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_expense_id returning * into v_expense;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_EVENT_EXPENSE', v_fingerprint,
    'event_expense', v_expense.id, to_jsonb(v_expense)
  );
  perform public.record_audit(p_org_id, 'EVENT_EXPENSE_VOIDED', 'event_expense', v_expense.id::text,
    jsonb_build_object('reason', trim(p_reason)));
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read model: cost-gated, non-sensitive-safe projection of event expenses.
-- ---------------------------------------------------------------------------
create or replace function public._view_event_expense_summaries()
returns table(
  id uuid, organization_id uuid, event_id uuid, event_number text,
  category public.expense_category, amount numeric, expense_date date,
  description text, payment_method public.payment_method, payee text,
  reference text, status public.customer_payment_status,
  void_reason text, voided_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.organization_id, e.event_id, ev.event_number,
    e.category, e.amount, e.expense_date, e.description, e.payment_method,
    e.payee, e.reference, e.status, e.void_reason, e.voided_at, e.created_at
  from public.event_expenses e
  join public.events ev on ev.organization_id = e.organization_id and ev.id = e.event_id
  where public.can_read_cost(e.organization_id);
$$;
create view public.event_expense_summaries with (security_invoker=true)
  as select * from public._view_event_expense_summaries();

revoke all on function public._view_event_expense_summaries() from public, anon, authenticated;
grant execute on function public._view_event_expense_summaries() to authenticated;
revoke all on table public.event_expense_summaries from anon, authenticated;
grant select on table public.event_expense_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (browser roles only; no anon).
-- ---------------------------------------------------------------------------
revoke all on function public.record_event_expense(uuid,uuid,public.expense_category,numeric,date,text,public.payment_method,text,text,uuid) from public, anon;
revoke all on function public.void_event_expense(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.record_event_expense(uuid,uuid,public.expense_category,numeric,date,text,public.payment_method,text,text,uuid) to authenticated;
grant execute on function public.void_event_expense(uuid,uuid,text,uuid) to authenticated;
