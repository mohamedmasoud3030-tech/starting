-- ============================================================================
-- 0035 — S6 customer payments and event economics — schema
--
-- S6 records customer payments against a CONFIRMED event whose commercial
-- value has been accepted. It does NOT model invoices, a general ledger,
-- accounts payable, or a second accounting model: the accepted quotation
-- snapshot remains the single authoritative revenue basis, and event cost
-- continues to flow from the existing S2 quotations (expected cost) and S5
-- procurement (committed/delivered cost).
--
-- All money is exact OMR numeric(12,3); no binary floating-point arithmetic
-- is ever persisted. Payments are append-only financial facts: corrections
-- are recorded as a VOID transition, never a destructive delete or rewrite.
-- ============================================================================

create type public.payment_method as enum (
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'CHEQUE',
  'MOBILE_WALLET',
  'OTHER'
);

create type public.customer_payment_status as enum ('RECORDED', 'VOIDED');

-- ---------------------------------------------------------------------------
-- Global S6 command idempotency register. Mirrors the established S5 pattern:
-- every command takes an advisory transaction lock on (organization,key),
-- checks this register, and stores the exact response snapshot so a late
-- replay returns the original transition response.
-- ---------------------------------------------------------------------------
create table public.payments_command_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  command_name text not null check (length(trim(command_name)) > 0),
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  result_entity text not null check (length(trim(result_entity)) > 0),
  result_id uuid not null,
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Customer payment ledger (append-only). One payment row per financial fact.
-- `amount` is an exact OMR 3-decimal value > 0. `reference` carries the
-- operator's bank/cheque/wallet reference; `payment_method` is a closed enum.
-- Voiding is a guarded RECORDED -> VOIDED transition that preserves history.
-- ---------------------------------------------------------------------------
create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  amount numeric(12,3) not null check (amount > 0),
  payment_method public.payment_method not null,
  reference text,
  notes text,
  paid_at timestamptz not null,
  status public.customer_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),

  constraint customer_payments_org_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint customer_payments_org_id_unique unique (organization_id, id),
  constraint customer_payments_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint customer_payments_void_shape check (
    (status = 'VOIDED'
      and voided_by is not null
      and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED'
      and voided_by is null
      and voided_at is null
      and void_reason is null)
  )
);

create index customer_payments_event_idx
  on public.customer_payments (organization_id, event_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Structural history guards (defence in depth beyond RPC-only grants).
-- A payment's financial facts are immutable; the only permitted mutation is
-- the deliberate RECORDED -> VOIDED lifecycle transition performed by the
-- server-authoritative command.
-- ---------------------------------------------------------------------------
create or replace function public.customer_payment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CUSTOMER_PAYMENT_APPEND_ONLY' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
    old.status = 'RECORDED' and new.status = 'VOIDED'
  ) then
    raise exception 'INVALID_PAYMENT_TRANSITION' using errcode = '23514';
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.event_id is distinct from old.event_id
    or new.amount is distinct from old.amount
    or new.payment_method is distinct from old.payment_method
    or new.reference is distinct from old.reference
    or new.notes is distinct from old.notes
    or new.paid_at is distinct from old.paid_at
    or new.recorded_by is distinct from old.recorded_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.created_at is distinct from old.created_at
  then
    raise exception 'CUSTOMER_PAYMENT_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger customer_payments_guard
  before update or delete on public.customer_payments
  for each row execute function public.customer_payment_guard();

create or replace function public.customer_payment_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CUSTOMER_PAYMENT_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger payments_command_idempotency_append_only
  before update or delete on public.payments_command_idempotency
  for each row execute function public.customer_payment_append_only_guard();
