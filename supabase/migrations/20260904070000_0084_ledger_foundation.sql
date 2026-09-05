-- ============================================================================
-- 0084 — Double-entry ledger foundation (A1)
--
-- This is the FIRST financial tranche migration. It does NOT yet re-point any
-- business RPC; it establishes the canonical double-entry layer that later
-- migrations (0085+) integrate with:
--
--   * chart_of_accounts  — organisation-scoped canonical chart, system accounts
--                          seeded deterministically + idempotently per org.
--   * journal_entries    — immutable accounting header, source taxonomy,
--                          idempotency, reversal chain.
--   * journal_lines      — immutable debit/credit lines, exact OMR 3-decimal,
--                          balanced by a DEFERRABLE CONSTRAINT TRIGGER.
--   * internal_post_journal — the ONLY posting primitive. Security definer,
--                          never granted to clients; called by authoritative
--                          business RPCs.
--   * reverse_journal_entry — canonical (generic) reversal primitive.
--   * account balance read models (raw / normalized / at-time).
--
-- AUTHORITY: the accounting-posting contract (docs/research/accounting-posting-contract.md).
-- Operational ledgers (customer_payments, invoices, event_expenses, attendance,
-- advances, payouts, procurement) REMAIN the source of operational truth. The
-- journal records the financial consequence of those events.
--
-- Money is exact OMR numeric(12,3). No binary floating point is persisted.
-- Tenant isolation: every row carries organization_id; no direct client grants;
-- all reads via SECURITY DEFINER + has_permission(cost.visibility).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.account_type as enum ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
create type public.normal_balance as enum ('DEBIT', 'CREDIT');

-- Closed source taxonomy (contract §14). Avoid free-form source strings.
create type public.journal_source_type as enum (
  'OPENING_BALANCE',
  'CUSTOMER_PAYMENT',
  'CUSTOMER_PAYMENT_VOID',
  'CUSTOMER_DEPOSIT_APPLIED',
  'CUSTOMER_DEPOSIT_RELEASED',
  'INVOICE',
  'INVOICE_VOID',
  'REVENUE_RECOGNITION',
  'UNBILLED_RECOGNITION',
  'CONTRACT_ASSET_RECLASSIFICATION',
  'REVENUE_REVERSAL',
  'EVENT_EXPENSE',
  'EVENT_EXPENSE_VOID',
  'HOST_EARNING',
  'HOST_EARNING_VOID',
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

-- Allow journal numbers (JE-…) via the repository's document sequence.
alter table public.document_sequences
  drop constraint if exists document_sequences_kind_check;
alter table public.document_sequences
  add constraint document_sequences_kind_check
  check (kind in ('EVENT', 'QUOTATION', 'PROCUREMENT_ORDER', 'JOURNAL_ENTRY'));

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  account_type public.account_type not null,
  normal_balance public.normal_balance not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  parent_id uuid references public.chart_of_accounts(id),
  purpose text,
  created_at timestamptz not null default now(),
  constraint chart_of_accounts_org_id_unique unique (organization_id, id),
  constraint chart_of_accounts_org_code_unique unique (organization_id, code),
  constraint chart_of_accounts_parent_check check (parent_id is null or parent_id <> id)
);

create index chart_of_accounts_org_active_idx
  on public.chart_of_accounts (organization_id, is_active, account_type, code);

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_number text not null,
  entry_date date not null,
  event_at timestamptz,
  memo text,
  source_type public.journal_source_type not null,
  source_id uuid not null,
  event_id uuid,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_by uuid not null references auth.users(id),
  reversal_of uuid references public.journal_entries(id),
  is_reversal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint journal_entries_org_number_unique unique (organization_id, entry_number),
  constraint journal_entries_org_id_unique unique (organization_id, id),
  constraint journal_entries_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint journal_entries_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint journal_entries_reversal_shape check (
    (is_reversal and reversal_of is not null)
    or (not is_reversal and reversal_of is null)
  ),
  constraint journal_entries_reversal_org_fk
    foreign key (organization_id, reversal_of)
    references public.journal_entries(organization_id, id) on delete restrict
);

create index journal_entries_org_date_idx on public.journal_entries (organization_id, entry_date, id);
create index journal_entries_org_event_idx on public.journal_entries (organization_id, event_id);
create index journal_entries_org_source_idx on public.journal_entries (organization_id, source_type, source_id);

-- A journal may be reversed at most once, unless explicitly chained later.
create unique index journal_entries_single_reversal_idx
  on public.journal_entries (organization_id, reversal_of)
  where reversal_of is not null;

-- ---------------------------------------------------------------------------
-- Journal lines
-- ---------------------------------------------------------------------------
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  debit numeric(12,3) not null default 0 check (debit >= 0),
  credit numeric(12,3) not null default 0 check (credit >= 0),
  line_memo text,
  created_at timestamptz not null default now(),
  constraint journal_lines_org_id_unique unique (organization_id, id),
  constraint journal_lines_entry_org_fk
    foreign key (organization_id, entry_id)
    references public.journal_entries(organization_id, id) on delete cascade,
  constraint journal_lines_account_org_fk
    foreign key (organization_id, account_id)
    references public.chart_of_accounts(organization_id, id) on delete restrict,
  constraint journal_lines_exclusive_side check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  ),
  constraint journal_lines_nonzero check (debit > 0 or credit > 0),
  constraint journal_lines_omr_precision check (
    round(debit, 3) = debit and round(credit, 3) = credit
  ),
  constraint journal_lines_max check (
    debit <= 999999999.999 and credit <= 999999999.999
  )
);

create index journal_lines_entry_idx on public.journal_lines (entry_id, id);
create index journal_lines_org_entry_idx on public.journal_lines (organization_id, entry_id, account_id);

-- Denormalized accounting date for efficient balance/treasury/customer queries
-- (accounting date = the journal entry's entry_date). Set on every insert.
alter table public.journal_lines add column entry_date date not null default current_date;
create index journal_lines_org_account_date_idx
  on public.journal_lines (organization_id, account_id, entry_date, id);

-- ---------------------------------------------------------------------------
-- RLS: no direct client access to journals. SECURITY DEFINER functions are the
-- only readers. Enable RLS but do not add permissive policies; revoke grants.
-- ---------------------------------------------------------------------------
alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

revoke all on table public.chart_of_accounts from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_lines from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability guards — posted financial history can never be rewritten.
-- Corrections happen via reversal entries only.
-- ---------------------------------------------------------------------------
create or replace function public.journal_entries_immutable_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'JOURNAL_IMMUTABLE' using errcode = '42501';
  end if;
  raise exception 'JOURNAL_IMMUTABLE' using errcode = '42501';
end;
$$;

create or replace function public.journal_lines_immutable_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'JOURNAL_LINE_IMMUTABLE' using errcode = '42501';
  end if;
  raise exception 'JOURNAL_LINE_IMMUTABLE' using errcode = '42501';
end;
$$;

create trigger journal_entries_immutable
  before update or delete on public.journal_entries
  for each row execute function public.journal_entries_immutable_guard();

create trigger journal_lines_immutable
  before update or delete on public.journal_lines
  for each row execute function public.journal_lines_immutable_guard();

-- ---------------------------------------------------------------------------
-- Balanced-journal invariant — enforced at the journal_lines mutation boundary.
-- DEFERRABLE CONSTRAINT TRIGGER re-validates each parent entry's SUM(debit)=SUM(credit)
-- and min line count at transaction end, so an unbalanced entry can never commit.
--
-- SECURITY DEFINER is required: journal_lines is revoked from `authenticated`
-- (no client reads). PostgreSQL 15 fires deferred constraint triggers as the
-- role executing COMMIT, which for business RPCs is `authenticated` after
-- `SET ROLE`. PostgreSQL 18 fires them as the role that performed the INSERT
-- (here, the definer of internal_post_journal). Without DEFINER, PG15 COMMIT
-- of a posted payment fails with 42501 permission denied for journal_lines.
-- ---------------------------------------------------------------------------
create or replace function public.assert_journal_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_debit numeric;
  v_sum_credit numeric;
  v_line_count int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into v_sum_debit, v_sum_credit, v_line_count
    from public.journal_lines
   where entry_id = new.entry_id;

  if v_line_count < 2 then
    raise exception 'JOURNAL_REQUIRES_TWO_LINES' using errcode = '23514';
  end if;
  if v_sum_debit is distinct from v_sum_credit then
    raise exception 'JOURNAL_UNBALANCED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create constraint trigger journal_lines_balanced
  after insert on public.journal_lines
  deferrable initially deferred
  for each row execute function public.assert_journal_balanced();

-- ---------------------------------------------------------------------------
-- Deterministic, idempotent chart seeding per organization.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_system_chart(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chart_of_accounts
    (organization_id, code, name, account_type, normal_balance, is_system, is_active, purpose)
  select p_org_id, v.code, v.name, v.account_type::public.account_type,
         v.normal_balance::public.normal_balance, v.is_system::boolean,
         v.is_active::boolean, v.purpose
    from (values
      ('1000','Cash / Treasury','ASSET','DEBIT',true,true,'Physical cash boxes and cash-equivalent holding accounts (parent for CASH treasury accounts)'),
      ('1010','Bank / Treasury','ASSET','DEBIT',true,true,'Bank account holdings (parent for BANK treasury accounts)'),
      ('1020','Other Treasury','ASSET','DEBIT',true,true,'Other money-holding accounts (parent for OTHER treasury accounts)'),
      ('1100','Accounts Receivable','ASSET','DEBIT',true,true,'Amounts owed by customers, gross inclusive (net + VAT)'),
      ('1120','Unbilled Receivable / Contract Asset','ASSET','DEBIT',true,true,'Earned but not yet invoiced (CLOSED event without invoice), gross inclusive'),
      ('1150','Staff Advances & Receivables','ASSET','DEBIT',true,true,'Advances to staff + excess payouts over earnings (receivable)'),
      ('2000','Customer Deposits','LIABILITY','CREDIT',true,true,'Unapplied customer payments before invoice (net for VAT orgs)'),
      ('2100','Deferred Revenue','LIABILITY','CREDIT',true,true,'Invoiced but not yet earned service amount (net)'),
      ('2150','VAT Payable','LIABILITY','CREDIT',true,true,'Output VAT obligation per Oman tax point rules'),
      ('2200','Accounts Payable','LIABILITY','CREDIT',true,true,'Amounts owed to suppliers'),
      ('2300','Payroll Payable','LIABILITY','CREDIT',true,true,'Attendance-earned compensation payable to staff'),
      ('3000','Opening Balance Equity','EQUITY','CREDIT',true,true,'Cutover balancing equity; historical P&L not replayed'),
      ('4000','Event Revenue','REVENUE','CREDIT',true,true,'Recognized event revenue (net only; VAT never enters revenue)'),
      ('5000','Staff Cost','EXPENSE','DEBIT',true,true,'Host/supervisor payroll cost'),
      ('5100','Procurement / Materials Cost','EXPENSE','DEBIT',true,true,'Purchases / materials cost'),
      ('5200','Direct Event Expenses','EXPENSE','DEBIT',true,true,'Transport, fuel, rental, third-party, consumable, damage/loss, other')
    ) as v(code, name, account_type, normal_balance, is_system, is_active, purpose)
  on conflict (organization_id, code) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exact OMR validation for a NON-ZERO journal leg (amount > 0, 3 decimals).
-- ---------------------------------------------------------------------------
create or replace function public.assert_journal_omr(p_amount numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_JOURNAL_AMOUNT' using errcode = '22023';
  end if;
  if round(p_amount, 3) <> p_amount then
    raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
  end if;
  if p_amount > 999999999.999 then
    raise exception 'OMR_AMOUNT_OUT_OF_RANGE' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Canonical internal posting primitive. NOT granted to any client. Called only
-- by SECURITY DEFINER business RPCs. Validates balance, OMR precision, org
-- isolation, active accounts, min two lines, and inserts header + lines
-- atomically. Supports idempotent replay via (org, idempotency_key) + fingerprint.
-- ---------------------------------------------------------------------------
create or replace function public.internal_post_journal(
  p_org_id uuid,
  p_entry_date date,
  p_source_type public.journal_source_type,
  p_source_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid default gen_random_uuid(),
  p_request_fingerprint text default null,
  p_memo text default null,
  p_event_at timestamptz default null,
  p_event_id uuid default null,
  p_reversal_of uuid default null,
  p_is_reversal boolean default false
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_num text;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_line_memo text;
  v_sum_debit numeric := 0;
  v_sum_credit numeric := 0;
  v_line_count int := 0;
  v_fingerprint text;
  v_existing public.journal_entries;
  v_account public.chart_of_accounts;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_org_id is null or p_entry_date is null or p_source_type is null or p_source_id is null then
    raise exception 'JOURNAL_REQUIRED_FIELDS' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'JOURNAL_LINES_REQUIRED' using errcode = '22023';
  end if;

  -- Idempotency: same key + same fingerprint -> return original; mismatch -> fail.
  if p_idempotency_key is not null then
    select * into v_existing
      from public.journal_entries
     where organization_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      if p_request_fingerprint is not null
         and v_existing.request_fingerprint <> p_request_fingerprint then
        raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
      end if;
      return v_existing;
    end if;
  end if;

  v_fingerprint := coalesce(p_request_fingerprint,
    public.warehouse_fingerprint(jsonb_build_object(
      'org', p_org_id, 'date', p_entry_date, 'source_type', p_source_type,
      'source_id', p_source_id, 'lines', p_lines
    )));

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_account_id := (v_line ->> 'account_id')::uuid;
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    v_line_memo := v_line ->> 'line_memo';

    if v_debit = 0 and v_credit = 0 then
      raise exception 'JOURNAL_ZERO_LINE' using errcode = '23514';
    end if;
    if v_debit > 0 and v_credit > 0 then
      raise exception 'JOURNAL_LINE_BOTH_SIDES' using errcode = '23514';
    end if;
    if v_debit > 0 then
      perform public.assert_journal_omr(v_debit);
      v_sum_debit := v_sum_debit + v_debit;
    end if;
    if v_credit > 0 then
      perform public.assert_journal_omr(v_credit);
      v_sum_credit := v_sum_credit + v_credit;
    end if;

    select * into v_account
      from public.chart_of_accounts
     where organization_id = p_org_id and id = v_account_id;
    if not found then
      raise exception 'JOURNAL_ACCOUNT_NOT_FOUND' using errcode = '23503';
    end if;
    if not v_account.is_active then
      raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
    end if;

    v_line_count := v_line_count + 1;
  end loop;

  if v_line_count < 2 then
    raise exception 'JOURNAL_REQUIRES_TWO_LINES' using errcode = '23514';
  end if;
  if v_sum_debit is distinct from v_sum_credit then
    raise exception 'JOURNAL_UNBALANCED' using errcode = '23514';
  end if;

  v_num := public.next_document_number(p_org_id, 'JOURNAL_ENTRY', 'JE');

  insert into public.journal_entries (
    organization_id, entry_number, entry_date, event_at, memo, source_type,
    source_id, event_id, idempotency_key, request_fingerprint, created_by,
    reversal_of, is_reversal
  ) values (
    p_org_id, v_num, p_entry_date, p_event_at,
    nullif(trim(coalesce(p_memo, '')), ''), p_source_type, p_source_id,
    p_event_id, p_idempotency_key, v_fingerprint, v_caller,
    p_reversal_of, p_is_reversal
  ) returning * into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_account_id := (v_line ->> 'account_id')::uuid;
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    v_line_memo := v_line ->> 'line_memo';

    insert into public.journal_lines (
      organization_id, entry_id, account_id, debit, credit, line_memo, entry_date
    ) values (
      p_org_id, v_entry.id, v_account_id, v_debit, v_credit,
      nullif(trim(coalesce(v_line_memo, '')), ''), p_entry_date
    );
  end loop;

  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- Canonical reversal primitive. Creates the opposite journal preserving the
-- original, idempotently, and refuses to reverse the same journal twice.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_journal_entry(
  p_org_id uuid,
  p_entry_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entries;
  v_lines jsonb;
  v_line record;
  v_reversed_id uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REVERSAL_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_original
    from public.journal_entries
   where organization_id = p_org_id and id = p_entry_id;
  if not found then
    raise exception 'JOURNAL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_original.is_reversal then
    raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '23514';
  end if;
  if exists (select 1 from public.journal_entries
             where organization_id = p_org_id and reversal_of = p_entry_id and is_reversal) then
    raise exception 'JOURNAL_ALREADY_REVERSED' using errcode = '23514';
  end if;

  -- Build reversed lines: swap debit and credit.
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', l.account_id::text,
    'debit', case when l.credit > 0 then l.credit else 0 end,
    'credit', case when l.debit > 0 then l.debit else 0 end,
    'line_memo', 'Reversal of ' || v_original.entry_number || ': ' || trim(p_reason)
  )), '[]'::jsonb)
  into v_lines
  from public.journal_lines l
  where l.entry_id = v_original.id;

  return public.internal_post_journal(
    p_org_id,
    v_original.entry_date,
    'JOURNAL_REVERSAL',
    v_original.id,
    v_lines,
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'REVERSE_JOURNAL', 'entry_id', p_entry_id, 'reason', trim(p_reason)
    )),
    'Reversal of ' || v_original.entry_number || ': ' || trim(p_reason),
    v_original.event_at,
    v_original.event_id,
    v_original.id,
    true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Account balance read models (capability gated at the RPC boundary).
-- Raw Ledger Balance = SUM(debit) - SUM(credit), invariant to account type.
-- Normalized / display balance flips sign for CREDIT-normal accounts.
-- ---------------------------------------------------------------------------
create or replace function public.account_raw_balance(
  p_org_id uuid,
  p_account_id uuid
)
returns table (debit_total numeric, credit_total numeric, raw_balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0),
           coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
      from public.journal_lines l
     where l.organization_id = p_org_id and l.account_id = p_account_id;
end;
$$;

create or replace function public.account_balance(
  p_org_id uuid,
  p_account_id uuid
)
returns table (debit_total numeric, credit_total numeric, raw_balance numeric, normal_balance public.normal_balance, balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_normal public.normal_balance;
  v_debit numeric;
  v_credit numeric;
  v_raw numeric;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select c.normal_balance into v_normal from public.chart_of_accounts c
   where c.organization_id = p_org_id and c.id = p_account_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), coalesce(sum(debit),0)-coalesce(sum(credit),0)
    into v_debit, v_credit, v_raw
    from public.journal_lines where organization_id = p_org_id and account_id = p_account_id;
  return query select v_debit, v_credit, v_raw, v_normal,
    case when v_normal = 'DEBIT' then v_raw else -v_raw end;
end;
$$;

-- Balance as of a date (entry_date inclusive), for statements / cutover / audit.
create or replace function public.account_balance_at_time(
  p_org_id uuid,
  p_account_id uuid,
  p_as_of date
)
returns table (debit_total numeric, credit_total numeric, raw_balance numeric, normal_balance public.normal_balance, balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_normal public.normal_balance;
  v_debit numeric;
  v_credit numeric;
  v_raw numeric;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select c.normal_balance into v_normal from public.chart_of_accounts c
   where c.organization_id = p_org_id and c.id = p_account_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), coalesce(sum(debit),0)-coalesce(sum(credit),0)
    into v_debit, v_credit, v_raw
    from public.journal_lines
   where organization_id = p_org_id and account_id = p_account_id and entry_date <= p_as_of;
  return query select v_debit, v_credit, v_raw, v_normal,
    case when v_normal = 'DEBIT' then v_raw else -v_raw end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the posting primitive and internal helpers are never client-exposed.
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_system_chart(uuid) from public, anon, authenticated;
revoke all on function public.assert_journal_omr(numeric) from public, anon, authenticated;
revoke all on function public.assert_journal_balanced() from public, anon, authenticated;
revoke all on function public.internal_post_journal(uuid, date, public.journal_source_type, uuid, jsonb, uuid, text, text, timestamptz, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.reverse_journal_entry(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.account_raw_balance(uuid, uuid) from public, anon;
revoke all on function public.account_balance(uuid, uuid) from public, anon;
revoke all on function public.account_balance_at_time(uuid, uuid, date) from public, anon;

-- Read models are capability-gated at the RPC boundary (cost.visibility) but
-- EXECUTE is granted to authenticated so the frontend can call them. Each
-- function re-checks has_permission(cost.visibility) internally.
grant execute on function public.account_raw_balance(uuid, uuid), public.account_balance(uuid, uuid), public.account_balance_at_time(uuid, uuid, date) to authenticated;
