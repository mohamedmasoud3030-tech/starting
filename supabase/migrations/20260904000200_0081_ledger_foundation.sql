-- ============================================================================
-- 0081 — A1 Ledger Foundation
--
-- Implements canonical double-entry ledger infrastructure per A0 corrected:
--   * chart_of_accounts with 16 active + 6 deferred system accounts
--   * journal_entries immutable, entry_number via document_sequences
--   * journal_lines immutable, OMR 3dp, exactly one side positive
--   * balancing via explicit validation + DEFERRABLE CONSTRAINT TRIGGER on lines
--   * idempotency via org+key unique + fingerprint + advisory xact lock
--   * reversal primitive swapping debit/credit, unique reversal_of
--   * balance APIs raw = SUM(debit)-SUM(credit), normalized per normal_balance
--   * tenant isolation, RLS, no direct table grants, capability-gated reads
--   * internal_post_journal SECURITY DEFINER no grants to anon/authenticated
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend document_sequences kind to include JOURNAL_ENTRY
-- ---------------------------------------------------------------------------
alter table public.document_sequences
  drop constraint if exists document_sequences_kind_check;
alter table public.document_sequences
  add constraint document_sequences_kind_check
  check (kind in ('EVENT','QUOTATION','PROCUREMENT_ORDER','JOURNAL_ENTRY'));

-- ---------------------------------------------------------------------------
-- 2) document_number_prefix now returns JE for JOURNAL_ENTRY
-- ---------------------------------------------------------------------------
create or replace function public.document_number_prefix(p_org_id uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'QUOTATION' then coalesce(nullif(trim((select s.quotation_number_prefix from public.organization_settings s where s.organization_id = p_org_id)), ''), 'QT')
    when 'EVENT' then coalesce(nullif(trim((select s.event_number_prefix from public.organization_settings s where s.organization_id = p_org_id)), ''), 'EV')
    when 'PROCUREMENT_ORDER' then 'PO'
    when 'JOURNAL_ENTRY' then 'JE'
    else 'DOC'
  end;
$$;
revoke all on function public.document_number_prefix(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Enums for ledger
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.account_type as enum ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.normal_balance as enum ('DEBIT','CREDIT');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.journal_source_type as enum (
    'OPENING_BALANCE',
    'CUSTOMER_PAYMENT',
    'CUSTOMER_PAYMENT_VOID',
    'CUSTOMER_DEPOSIT_APPLIED',
    'CUSTOMER_DEPOSIT_RELEASED',
    'EVENT_INVOICE',
    'EVENT_INVOICE_VOID',
    'INVOICE',
    'INVOICE_VOID',
    'REVENUE_RECOGNITION',
    'UNBILLED_RECOGNITION',
    'CONTRACT_ASSET_RECLASSIFICATION',
    'CONTRACT_ASSET_RECOGNITION',
    'REVENUE_REVERSAL',
    'EVENT_EXPENSE',
    'EVENT_EXPENSE_VOID',
    'HOST_EARNING',
    'HOST_EARNING_VOID',
    'STAFF_EARNING',
    'STAFF_EARNING_VOID',
    'HOST_PAYOUT',
    'HOST_PAYOUT_VOID',
    'STAFF_ADVANCE',
    'STAFF_ADVANCE_VOID',
    'STAFF_ADVANCE_SETTLEMENT',
    'STAFF_RECEIVABLE_RECOGNITION',
    'SUPPLIER_INVOICE',
    'SUPPLIER_INVOICE_VOID',
    'SUPPLIER_PAYMENT',
    'SUPPLIER_PAYMENT_VOID',
    'TREASURY_TRANSFER',
    'JOURNAL_REVERSAL',
    'ADJUSTMENT'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 4) chart_of_accounts
-- ---------------------------------------------------------------------------
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  name text not null check (char_length(trim(name)) > 0),
  account_type public.account_type not null,
  normal_balance public.normal_balance not null,
  is_active boolean not null default true,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chart_of_accounts_org_code_unique unique (organization_id, code),
  constraint chart_of_accounts_org_id_unique unique (organization_id, id)
);

create index chart_of_accounts_org_idx on public.chart_of_accounts (organization_id);
create index chart_of_accounts_org_code_idx on public.chart_of_accounts (organization_id, code);

create trigger chart_of_accounts_set_updated_at
before update on public.chart_of_accounts
for each row execute function public.set_updated_at();

alter table public.chart_of_accounts enable row level security;
revoke all on table public.chart_of_accounts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) ensure_ledger_accounts — idempotent per-org seeding
-- ---------------------------------------------------------------------------
create or replace function public.ensure_ledger_accounts(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then return; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    return;
  end if;

  insert into public.chart_of_accounts (organization_id, code, name, account_type, normal_balance, is_active, is_system)
  values
    (p_org_id, '1000', 'Cash', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '1010', 'Bank', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '1020', 'Other Treasury', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '1100', 'Accounts Receivable', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '1120', 'Unbilled Receivable / Contract Asset', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '1150', 'Staff Advances & Receivables', 'ASSET', 'DEBIT', true, true),
    (p_org_id, '2000', 'Customer Deposits', 'LIABILITY', 'CREDIT', true, true),
    (p_org_id, '2100', 'Deferred Revenue', 'LIABILITY', 'CREDIT', true, true),
    (p_org_id, '2150', 'VAT Payable', 'LIABILITY', 'CREDIT', true, true),
    (p_org_id, '2200', 'Accounts Payable', 'LIABILITY', 'CREDIT', true, true),
    (p_org_id, '2300', 'Payroll Payable', 'LIABILITY', 'CREDIT', true, true),
    (p_org_id, '3000', 'Opening Balance Equity', 'EQUITY', 'CREDIT', true, true),
    (p_org_id, '4000', 'Event Revenue', 'REVENUE', 'CREDIT', true, true),
    (p_org_id, '5000', 'Staff Cost', 'EXPENSE', 'DEBIT', true, true),
    (p_org_id, '5100', 'Procurement Cost', 'EXPENSE', 'DEBIT', true, true),
    (p_org_id, '5200', 'Direct Expenses', 'EXPENSE', 'DEBIT', true, true),
    -- deferred placeholders
    (p_org_id, '1155', 'Input VAT / VAT Receivable', 'ASSET', 'DEBIT', false, true),
    (p_org_id, '1200', 'Inventory', 'ASSET', 'DEBIT', false, true),
    (p_org_id, '1300', 'Equipment', 'ASSET', 'DEBIT', false, true),
    (p_org_id, '2400', 'GRNI - Goods Received Not Invoiced', 'LIABILITY', 'CREDIT', false, true),
    (p_org_id, '3100', 'Retained Earnings', 'EQUITY', 'CREDIT', false, true),
    (p_org_id, '5300', 'Damage / Loss', 'EXPENSE', 'DEBIT', false, true)
  on conflict (organization_id, code) do update set
    name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = excluded.is_active,
    is_system = true,
    updated_at = now();
end;
$$;
revoke all on function public.ensure_ledger_accounts(uuid) from public, anon, authenticated;

create or replace function public.trg_ensure_ledger_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_ledger_accounts(new.id);
  return new;
end;
$$;
revoke all on function public.trg_ensure_ledger_accounts() from public, anon, authenticated;

drop trigger if exists organizations_ensure_ledger_accounts on public.organizations;
create trigger organizations_ensure_ledger_accounts
after insert on public.organizations
for each row execute function public.trg_ensure_ledger_accounts();

-- backfill existing orgs
do $$
declare
  org record;
begin
  for org in select id from public.organizations
  loop
    perform public.ensure_ledger_accounts(org.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) journal_entries
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_number text not null check (char_length(trim(entry_number)) > 0),
  entry_date date not null,
  event_at timestamptz not null,
  source_type public.journal_source_type not null,
  source_id uuid,
  idempotency_key uuid not null,
  fingerprint text not null check (char_length(trim(fingerprint)) >= 10),
  created_by uuid not null references auth.users(id),
  reversal_of uuid references public.journal_entries(id) on delete restrict,
  is_reversal boolean not null default false,
  memo text check (memo is null or char_length(trim(memo)) > 0),
  event_id uuid,
  created_at timestamptz not null default now(),
  constraint journal_entries_org_id_unique unique (organization_id, id),
  constraint journal_entries_org_number_unique unique (organization_id, entry_number),
  constraint journal_entries_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint journal_entries_reversal_shape check (
    is_reversal = (reversal_of is not null)
  ),
  constraint journal_entries_reversal_source check (
    (is_reversal and source_type = 'JOURNAL_REVERSAL'::public.journal_source_type)
    or (not is_reversal and source_type <> 'JOURNAL_REVERSAL'::public.journal_source_type)
  ),
  constraint journal_entries_org_event_fk
    foreign key (organization_id, event_id) references public.events(organization_id, id) on delete restrict
);

create index journal_entries_org_date_idx on public.journal_entries (organization_id, entry_date);
create index journal_entries_org_event_at_idx on public.journal_entries (organization_id, event_at);
create index journal_entries_org_source_idx on public.journal_entries (organization_id, source_type);
create unique index journal_entries_org_reversal_unique on public.journal_entries (organization_id, reversal_of) where reversal_of is not null;

alter table public.journal_entries enable row level security;
revoke all on table public.journal_entries from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) journal_lines
-- ---------------------------------------------------------------------------
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  debit numeric(14,3) not null default 0
    check (debit >= 0 and debit <= 999999999.999 and round(debit,3) = debit),
  credit numeric(14,3) not null default 0
    check (credit >= 0 and credit <= 999999999.999 and round(credit,3) = credit),
  memo text check (memo is null or char_length(trim(memo)) > 0),
  created_at timestamptz not null default now(),
  constraint journal_lines_one_side check (
    (debit > 0 and credit = 0) or (debit = 0 and credit > 0)
  ),
  constraint journal_lines_org_entry_fk
    foreign key (organization_id, entry_id) references public.journal_entries(organization_id, id) on delete restrict,
  constraint journal_lines_org_account_fk
    foreign key (organization_id, account_id) references public.chart_of_accounts(organization_id, id) on delete restrict
);

create index journal_lines_org_entry_idx on public.journal_lines (organization_id, entry_id);
create index journal_lines_org_account_idx on public.journal_lines (organization_id, account_id);
create index journal_lines_entry_idx on public.journal_lines (entry_id);

alter table public.journal_lines enable row level security;
revoke all on table public.journal_lines from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Immutability triggers
-- ---------------------------------------------------------------------------
create or replace function public.prevent_journal_entry_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'JOURNAL_IMMUTABLE' using errcode = '23514';
  return null;
end;
$$;
revoke all on function public.prevent_journal_entry_mutation() from public, anon, authenticated;

create or replace function public.prevent_journal_line_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'JOURNAL_LINE_IMMUTABLE' using errcode = '23514';
  return null;
end;
$$;
revoke all on function public.prevent_journal_line_mutation() from public, anon, authenticated;

drop trigger if exists trg_journal_entries_immutable on public.journal_entries;
create trigger trg_journal_entries_immutable
before update or delete on public.journal_entries
for each row execute function public.prevent_journal_entry_mutation();

drop trigger if exists trg_journal_lines_immutable on public.journal_lines;
create trigger trg_journal_lines_immutable
before update or delete on public.journal_lines
for each row execute function public.prevent_journal_line_mutation();

-- ---------------------------------------------------------------------------
-- 9) Balanced + min lines enforcement via DEFERRABLE CONSTRAINT TRIGGER on lines
-- ---------------------------------------------------------------------------
create or replace function public.assert_journal_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit numeric(14,3);
  v_credit numeric(14,3);
  v_count int;
begin
  select coalesce(sum(debit),0)::numeric(14,3),
         coalesce(sum(credit),0)::numeric(14,3),
         count(*)::int
    into v_debit, v_credit, v_count
  from public.journal_lines
  where entry_id = NEW.entry_id;

  if v_count < 2 then
    raise exception 'JOURNAL_MIN_LINES' using errcode = '23514';
  end if;

  if v_debit <> v_credit then
    raise exception 'JOURNAL_UNBALANCED' using errcode = '23514';
  end if;

  return NEW;
end;
$$;
revoke all on function public.assert_journal_balanced() from public, anon, authenticated;

drop trigger if exists trg_journal_lines_balanced on public.journal_lines;
create constraint trigger trg_journal_lines_balanced
after insert on public.journal_lines
deferrable initially deferred
for each row
execute function public.assert_journal_balanced();

-- ---------------------------------------------------------------------------
-- 10) OMR assertion helpers
-- ---------------------------------------------------------------------------
create or replace function public.assert_ledger_omr(p_amount numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null then
    raise exception 'OMR_AMOUNT_NULL' using errcode = '22023';
  end if;
  if p_amount < 0 then
    raise exception 'NEGATIVE_AMOUNT_NOT_ALLOWED' using errcode = '22023';
  end if;
  if round(p_amount,3) <> p_amount then
    raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
  end if;
  if p_amount > 999999999.999 then
    raise exception 'OMR_AMOUNT_OUT_OF_RANGE' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.assert_ledger_omr(numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11) internal_post_journal — canonical posting primitive
-- ---------------------------------------------------------------------------
create or replace function public.internal_post_journal(
  p_org_id uuid,
  p_entry_date date,
  p_event_at timestamptz,
  p_source_type public.journal_source_type,
  p_source_id uuid,
  p_memo text,
  p_event_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_fingerprint text,
  p_created_by uuid default auth.uid(),
  p_reversal_of uuid default null,
  p_is_reversal boolean default false
) returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.journal_entries;
  v_entry public.journal_entries;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric(14,3);
  v_credit numeric(14,3);
  v_debit_total numeric(14,3) := 0;
  v_credit_total numeric(14,3) := 0;
  v_count int := 0;
  v_entry_number text;
  v_memo text;
  v_account public.chart_of_accounts;
  v_event public.events;
begin
  if p_org_id is null then raise exception 'ORG_REQUIRED' using errcode='22023'; end if;
  if p_entry_date is null then raise exception 'ENTRY_DATE_REQUIRED' using errcode='22023'; end if;
  if p_event_at is null then raise exception 'EVENT_AT_REQUIRED' using errcode='22023'; end if;
  if p_source_type is null then raise exception 'SOURCE_TYPE_REQUIRED' using errcode='22023'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  if p_fingerprint is null or char_length(trim(p_fingerprint)) < 10 then raise exception 'FINGERPRINT_REQUIRED' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'LINES_REQUIRED' using errcode='22023'; end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 2 then raise exception 'JOURNAL_MIN_LINES' using errcode='23514'; end if;
  if p_created_by is null then raise exception 'CREATED_BY_REQUIRED' using errcode='22023'; end if;

  -- reversal shape validation
  if p_is_reversal then
    if p_reversal_of is null then raise exception 'REVERSAL_OF_REQUIRED' using errcode='22023'; end if;
    if p_source_type <> 'JOURNAL_REVERSAL'::public.journal_source_type then
      raise exception 'REVERSAL_SOURCE_MISMATCH' using errcode='23514';
    end if;
  else
    if p_reversal_of is not null then raise exception 'REVERSAL_OF_UNEXPECTED' using errcode='22023'; end if;
    if p_source_type = 'JOURNAL_REVERSAL'::public.journal_source_type then
      raise exception 'JOURNAL_REVERSAL_ONLY_FOR_REVERSAL' using errcode='23514';
    end if;
  end if;

  -- advisory lock for idempotency (same pattern as payments)
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  -- idempotency check
  select * into v_existing from public.journal_entries
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode='23505';
    end if;
    return v_existing;
  end if;

  -- event_id org check if provided
  if p_event_id is not null then
    select * into v_event from public.events where organization_id = p_org_id and id = p_event_id;
    if not found then
      raise exception 'EVENT_NOT_IN_ORG' using errcode='23503';
    end if;
  end if;

  -- validate lines shape, org, active, precision, balance
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := nullif((v_line->>'account_id'), '')::uuid;
    if v_account_id is null then raise exception 'ACCOUNT_ID_REQUIRED' using errcode='22023'; end if;
    v_debit := coalesce((v_line->>'debit')::numeric, 0)::numeric(14,3);
    v_credit := coalesce((v_line->>'credit')::numeric, 0)::numeric(14,3);

    if v_debit < 0 or v_credit < 0 then raise exception 'NEGATIVE_AMOUNT_NOT_ALLOWED' using errcode='22023'; end if;
    if v_debit = 0 and v_credit = 0 then raise exception 'ZERO_LINE_NOT_ALLOWED' using errcode='22023'; end if;
    if v_debit > 0 and v_credit > 0 then raise exception 'BOTH_DEBIT_CREDIT_NOT_ALLOWED' using errcode='22023'; end if;
    if round(v_debit,3) <> v_debit or round(v_credit,3) <> v_credit then
      raise exception 'OMR_PRECISION_EXCEEDED' using errcode='22023';
    end if;
    if v_debit > 999999999.999 or v_credit > 999999999.999 then
      raise exception 'OMR_AMOUNT_OUT_OF_RANGE' using errcode='22023';
    end if;

    select * into v_account from public.chart_of_accounts
     where id = v_account_id and organization_id = p_org_id;
    if not found then
      raise exception 'ACCOUNT_NOT_IN_ORG' using errcode='23503';
    end if;
    if not v_account.is_active then
      raise exception 'ACCOUNT_INACTIVE' using errcode='23514';
    end if;

    v_debit_total := v_debit_total + v_debit;
    v_credit_total := v_credit_total + v_credit;
  end loop;

  if v_debit_total <> v_credit_total then
    raise exception 'JOURNAL_UNBALANCED' using errcode='23514';
  end if;
  if v_debit_total <= 0 then
    raise exception 'JOURNAL_ZERO_TOTAL' using errcode='23514';
  end if;

  -- generate entry_number concurrency-safe via document_sequences
  v_entry_number := public.next_document_number(p_org_id, 'JOURNAL_ENTRY', 'JE');

  -- insert header
  insert into public.journal_entries (
    organization_id, entry_number, entry_date, event_at,
    source_type, source_id, memo, event_id,
    idempotency_key, fingerprint, created_by,
    is_reversal, reversal_of
  ) values (
    p_org_id, v_entry_number, p_entry_date, p_event_at,
    p_source_type, p_source_id, nullif(trim(coalesce(p_memo,'')),''), p_event_id,
    p_idempotency_key, p_fingerprint, p_created_by,
    coalesce(p_is_reversal,false), p_reversal_of
  ) returning * into v_entry;

  -- insert lines
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::numeric, 0)::numeric(14,3);
    v_credit := coalesce((v_line->>'credit')::numeric, 0)::numeric(14,3);
    v_memo := nullif(trim(coalesce(v_line->>'memo','')), '');

    insert into public.journal_lines (
      organization_id, entry_id, account_id, debit, credit, memo
    ) values (
      p_org_id, v_entry.id, v_account_id, v_debit, v_credit, v_memo
    );
  end loop;

  return v_entry;
end;
$$;
revoke all on function public.internal_post_journal(uuid,date,timestamptz,public.journal_source_type,uuid,text,uuid,jsonb,uuid,text,uuid,uuid,boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12) reverse_journal_entry — reversal primitive
-- ---------------------------------------------------------------------------
create or replace function public.reverse_journal_entry(
  p_org_id uuid,
  p_entry_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_created_by uuid default auth.uid()
) returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entries;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_fingerprint text;
  v_existing public.journal_entries;
begin
  if p_org_id is null then raise exception 'ORG_REQUIRED' using errcode='22023'; end if;
  if p_entry_id is null then raise exception 'ENTRY_ID_REQUIRED' using errcode='22023'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'REVERSAL_REASON_REQUIRED' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object('command','REVERSE_JOURNAL','entry_id',p_entry_id,'reason',trim(p_reason)));

  select * into v_existing from public.journal_entries
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode='23505';
    end if;
    return v_existing;
  end if;

  select * into v_original from public.journal_entries
   where organization_id = p_org_id and id = p_entry_id
   for update;
  if not found then
    raise exception 'JOURNAL_NOT_FOUND' using errcode='P0002';
  end if;

  if exists (select 1 from public.journal_entries where organization_id = p_org_id and reversal_of = p_entry_id) then
    raise exception 'JOURNAL_ALREADY_REVERSED' using errcode='23514';
  end if;

  for v_line in select * from public.journal_lines where organization_id = p_org_id and entry_id = p_entry_id
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_line.account_id,
      'debit', v_line.credit,
      'credit', v_line.debit,
      'memo', 'Reversal of ' || v_original.entry_number
    );
  end loop;

  if jsonb_array_length(v_lines) < 2 then
    raise exception 'JOURNAL_MIN_LINES' using errcode='23514';
  end if;

  return public.internal_post_journal(
    p_org_id := p_org_id,
    p_entry_date := (now() at time zone 'Asia/Muscat')::date,
    p_event_at := now(),
    p_source_type := 'JOURNAL_REVERSAL'::public.journal_source_type,
    p_source_id := p_entry_id,
    p_memo := 'Reversal of ' || v_original.entry_number || ': ' || trim(p_reason),
    p_event_id := v_original.event_id,
    p_lines := v_lines,
    p_idempotency_key := p_idempotency_key,
    p_fingerprint := v_fingerprint,
    p_created_by := coalesce(p_created_by, auth.uid()),
    p_reversal_of := p_entry_id,
    p_is_reversal := true
  );
end;
$$;
revoke all on function public.reverse_journal_entry(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13) Balance APIs
-- ---------------------------------------------------------------------------
create or replace function public.account_raw_balance(p_org_id uuid, p_account_id uuid)
returns table (debit_total numeric, credit_total numeric, raw_balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.chart_of_accounts;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode='42501';
  end if;
  if not public.has_permission(p_org_id, 'cost.visibility')
     and not public.has_permission(p_org_id, 'payroll.read')
     and not public.has_permission(p_org_id, 'finance.manage')
  then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_account from public.chart_of_accounts
   where organization_id = p_org_id and id = p_account_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;

  return query
  select
    coalesce(sum(l.debit),0)::numeric(14,3) as debit_total,
    coalesce(sum(l.credit),0)::numeric(14,3) as credit_total,
    coalesce(sum(l.debit - l.credit),0)::numeric(14,3) as raw_balance
  from public.journal_lines l
  where l.organization_id = p_org_id and l.account_id = p_account_id;
end;
$$;
revoke all on function public.account_raw_balance(uuid,uuid) from public, anon;
grant execute on function public.account_raw_balance(uuid,uuid) to authenticated;

create or replace function public.account_balance(p_org_id uuid, p_account_id uuid)
returns table (
  normal_balance public.normal_balance,
  debit_total numeric,
  credit_total numeric,
  raw_balance numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.chart_of_accounts;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode='42501';
  end if;
  if not public.has_permission(p_org_id, 'cost.visibility')
     and not public.has_permission(p_org_id, 'payroll.read')
     and not public.has_permission(p_org_id, 'finance.manage')
  then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_account from public.chart_of_accounts
   where organization_id = p_org_id and id = p_account_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;

  return query
  select
    v_account.normal_balance as normal_balance,
    coalesce(sum(l.debit),0)::numeric(14,3) as debit_total,
    coalesce(sum(l.credit),0)::numeric(14,3) as credit_total,
    coalesce(sum(l.debit - l.credit),0)::numeric(14,3) as raw_balance,
    case when v_account.normal_balance = 'DEBIT'::public.normal_balance
         then coalesce(sum(l.debit - l.credit),0)::numeric(14,3)
         else coalesce(sum(l.credit - l.debit),0)::numeric(14,3)
    end as balance
  from public.journal_lines l
  where l.organization_id = p_org_id and l.account_id = p_account_id;
end;
$$;
revoke all on function public.account_balance(uuid,uuid) from public, anon;
grant execute on function public.account_balance(uuid,uuid) to authenticated;

create or replace function public.account_balance_at_time(p_org_id uuid, p_account_id uuid, p_at timestamptz)
returns table (
  normal_balance public.normal_balance,
  debit_total numeric,
  credit_total numeric,
  raw_balance numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.chart_of_accounts;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode='42501';
  end if;
  if p_at is null then
    raise exception 'AT_TIME_REQUIRED' using errcode='22023';
  end if;
  if not public.has_permission(p_org_id, 'cost.visibility')
     and not public.has_permission(p_org_id, 'payroll.read')
     and not public.has_permission(p_org_id, 'finance.manage')
  then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_account from public.chart_of_accounts
   where organization_id = p_org_id and id = p_account_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;

  return query
  select
    v_account.normal_balance as normal_balance,
    coalesce(sum(l.debit),0)::numeric(14,3) as debit_total,
    coalesce(sum(l.credit),0)::numeric(14,3) as credit_total,
    coalesce(sum(l.debit - l.credit),0)::numeric(14,3) as raw_balance,
    case when v_account.normal_balance = 'DEBIT'::public.normal_balance
         then coalesce(sum(l.debit - l.credit),0)::numeric(14,3)
         else coalesce(sum(l.credit - l.debit),0)::numeric(14,3)
    end as balance
  from public.journal_lines l
  join public.journal_entries e on e.organization_id = l.organization_id and e.id = l.entry_id
  where l.organization_id = p_org_id
    and l.account_id = p_account_id
    and e.event_at <= p_at;
end;
$$;
revoke all on function public.account_balance_at_time(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.account_balance_at_time(uuid,uuid,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 14) list_chart_of_accounts — capability-gated read
-- ---------------------------------------------------------------------------
create or replace function public.list_chart_of_accounts(p_org_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  name text,
  account_type public.account_type,
  normal_balance public.normal_balance,
  is_active boolean,
  is_system boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode='42501';
  end if;
  if not public.has_permission(p_org_id, 'cost.visibility')
     and not public.has_permission(p_org_id, 'payroll.read')
     and not public.has_permission(p_org_id, 'finance.manage')
     and not public.has_permission(p_org_id, 'settings.manage')
  then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  return query
  select c.id, c.organization_id, c.code, c.name, c.account_type, c.normal_balance, c.is_active, c.is_system, c.created_at
  from public.chart_of_accounts c
  where c.organization_id = p_org_id
  order by c.code;
end;
$$;
revoke all on function public.list_chart_of_accounts(uuid) from public, anon;
grant execute on function public.list_chart_of_accounts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15) Final grants hardening — ensure no direct table access
-- ---------------------------------------------------------------------------
revoke all on table public.chart_of_accounts from public, anon, authenticated;
revoke all on table public.journal_entries from public, anon, authenticated;
revoke all on table public.journal_lines from public, anon, authenticated;

-- Ensure functions that must stay internal have no grants
revoke all on function public.ensure_ledger_accounts(uuid) from public, anon, authenticated;
revoke all on function public.trg_ensure_ledger_accounts() from public, anon, authenticated;
revoke all on function public.prevent_journal_entry_mutation() from public, anon, authenticated;
revoke all on function public.prevent_journal_line_mutation() from public, anon, authenticated;
revoke all on function public.assert_journal_balanced() from public, anon, authenticated;
revoke all on function public.assert_ledger_omr(numeric) from public, anon, authenticated;
revoke all on function public.internal_post_journal(uuid,date,timestamptz,public.journal_source_type,uuid,text,uuid,jsonb,uuid,text,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.reverse_journal_entry(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
