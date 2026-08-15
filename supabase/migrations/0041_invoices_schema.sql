-- ============================================================================
-- 0041 — S6+ invoicing: invoices, deposit and installment schedule
--
-- The authoritative revenue and the immutable customer payment ledger already
-- live in S6 (customer_payments). This slice adds the OWNER-FACING invoice
-- artifact the business asked for: a formal invoice with a deposit (العربون)
-- and multiple installments (الدفعات المتعددة), linked to the accepted
-- quotation and the event. Installment PAID state is DERIVED from the
-- immutable customer_payments ledger (cumulative paid vs cumulative scheduled)
-- in the read model — no second money source of truth is introduced.
--
-- All money is exact OMR numeric(14,3); no binary float is ever persisted.
-- ============================================================================

create type public.invoice_status as enum ('ISSUED', 'CANCELLED');
create type public.invoice_installment_kind as enum ('DEPOSIT', 'INSTALLMENT', 'FINAL');
create type public.installment_status as enum ('PENDING', 'PAID', 'CANCELLED');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  quotation_id uuid,
  invoice_number text not null,
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  total_amount numeric(14,3) not null check (total_amount >= 0),
  currency text not null default 'OMR',
  note text,
  status public.invoice_status not null default 'ISSUED',
  created_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),

  constraint invoices_org_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint invoices_org_quotation_fk
    foreign key (organization_id, quotation_id)
    references public.quotations(organization_id, id) on delete restrict,
  constraint invoices_org_id_unique unique (organization_id, id),
  constraint invoices_org_number_unique unique (organization_id, invoice_number),
  constraint invoices_void_shape check (
    (status = 'CANCELLED'
      and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'ISSUED'
      and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index invoices_event_idx on public.invoices (organization_id, event_id, id);

create table public.invoice_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  seq integer not null,
  kind public.invoice_installment_kind not null,
  due_date date not null,
  amount numeric(14,3) not null check (amount >= 0),
  status public.installment_status not null default 'PENDING',
  created_at timestamptz not null default now(),

  constraint invoice_installments_org_fk
    foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete restrict,
  constraint invoice_installments_org_id_unique unique (organization_id, id),
  constraint invoice_installments_org_invoice_seq_unique unique (organization_id, invoice_id, seq)
);

create index invoice_installments_invoice_idx
  on public.invoice_installments (organization_id, invoice_id, seq);

-- ---------------------------------------------------------------------------
-- Structural history guards. Invoices and their installment schedule are
-- immutable once issued (they are the agreed plan); corrections happen by
-- cancelling the invoice, which cascades to its installments. A destructive
-- DELETE is always rejected.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INVOICE_APPEND_ONLY' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'ISSUED' and new.status = 'CANCELLED') then
    raise exception 'INVALID_INVOICE_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.event_id is distinct from old.event_id
    or new.quotation_id is distinct from old.quotation_id
    or new.invoice_number is distinct from old.invoice_number
    or new.issued_at is distinct from old.issued_at
    or new.due_at is distinct from old.due_at
    or new.total_amount is distinct from old.total_amount
    or new.currency is distinct from old.currency
    or new.note is distinct from old.note
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'INVOICE_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoices_guard
  before update or delete on public.invoices
  for each row execute function public.invoice_guard();

create or replace function public.invoice_installment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INVOICE_INSTALLMENT_APPEND_ONLY' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'PENDING' and new.status = 'CANCELLED') then
    raise exception 'INVALID_INSTALLMENT_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.invoice_id is distinct from old.invoice_id
    or new.seq is distinct from old.seq
    or new.kind is distinct from old.kind
    or new.due_date is distinct from old.due_date
    or new.amount is distinct from old.amount
    or new.created_at is distinct from old.created_at
  then
    raise exception 'INVOICE_INSTALLMENT_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoice_installments_guard
  before update or delete on public.invoice_installments
  for each row execute function public.invoice_installment_guard();
