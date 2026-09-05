-- ============================================================================
-- 0085 — Treasury accounts (B)
--
-- Real treasury accounts let the office distinguish CASH, BANK and OTHER money
-- holding accounts. A treasury account is a *chart sub-account* under the
-- appropriate parent (1000 Cash / 1010 Bank / 1020 Other Treasury). Balances are
-- derived entirely from the journal — there is NO editable treasury balance.
--
--   * create_treasury_account      — finance.manage
--   * update_treasury_account      — finance.manage (safe metadata + activate)
--   * treasury_transfer            — finance.manage (Dr dest / Cr source, balanced,
--                                     no revenue/expense/customer/event effect)
--   * set_treasury_opening_balance — finance.manage (OPENING_BALANCE cutover)
--   * treasury_statement           — cost.visibility
--   * treasury_account_balances    — cost.visibility
--
-- payment_method remains the *channel*; treasury_account is where money sits.
-- ============================================================================

create type public.treasury_account_type as enum ('CASH', 'BANK', 'OTHER');

create table public.treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  treasury_type public.treasury_account_type not null,
  chart_account_id uuid not null,
  is_active boolean not null default true,
  bank_name text,
  account_tail text,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treasury_accounts_org_id_unique unique (organization_id, id),
  constraint treasury_accounts_org_chart_unique unique (organization_id, chart_account_id),
  constraint treasury_accounts_org_name_unique unique (organization_id, name),
  constraint treasury_accounts_chart_fk
    foreign key (organization_id, chart_account_id)
    references public.chart_of_accounts(organization_id, id) on delete restrict
);

create index treasury_accounts_org_active_idx
  on public.treasury_accounts (organization_id, is_active, treasury_type);

alter table public.treasury_accounts enable row level security;
revoke all on table public.treasury_accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helper: the system treasury parent account for a treasury type.
-- ---------------------------------------------------------------------------
create or replace function public.treasury_parent_code(p_type public.treasury_account_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'CASH' then '1000' when 'BANK' then '1010' else '1020' end;
$$;

-- ---------------------------------------------------------------------------
-- Treasury read models (derived from journal; no editable balance).
-- ---------------------------------------------------------------------------
create or replace function public.treasury_account_balance(
  p_org_id uuid,
  p_treasury_id uuid
)
returns table (debit_total numeric, credit_total numeric, raw_balance numeric, balance numeric, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_raw numeric;
  v_normal public.normal_balance;
  v_active boolean;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select c.normal_balance, t.is_active into v_normal, v_active
    from public.treasury_accounts t
    join public.chart_of_accounts c on c.organization_id = t.organization_id and c.id = t.chart_account_id
   where t.organization_id = p_org_id and t.id = p_treasury_id;
  if not found then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), coalesce(sum(debit),0)-coalesce(sum(credit),0)
    into v_debit, v_credit, v_raw
    from public.journal_lines
   where organization_id = p_org_id
     and account_id = (select chart_account_id from public.treasury_accounts where organization_id = p_org_id and id = p_treasury_id);
  return query select v_debit, v_credit, v_raw,
    case when v_normal = 'DEBIT' then v_raw else -v_raw end, v_active;
end;
$$;

create or replace function public.treasury_account_balances(p_org_id uuid)
returns table (id uuid, name text, treasury_type public.treasury_account_type, chart_account_id uuid,
               is_active boolean, debit_total numeric, credit_total numeric, raw_balance numeric, balance numeric)
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
    select t.id, t.name, t.treasury_type, t.chart_account_id, t.is_active,
           coalesce(b.debit_total, 0), coalesce(b.credit_total, 0),
           coalesce(b.raw_balance, 0),
           case when c.normal_balance = 'DEBIT' then coalesce(b.raw_balance, 0) else -coalesce(b.raw_balance, 0) end
      from public.treasury_accounts t
      join public.chart_of_accounts c on c.organization_id = t.organization_id and c.id = t.chart_account_id
      left join lateral (
        select coalesce(sum(l.debit), 0) as debit_total,
               coalesce(sum(l.credit), 0) as credit_total,
               coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as raw_balance
          from public.journal_lines l
         where l.organization_id = t.organization_id and l.account_id = t.chart_account_id
      ) b on true
     where t.organization_id = p_org_id
     order by t.treasury_type, t.name;
end;
$$;

create or replace function public.treasury_statement(
  p_org_id uuid,
  p_treasury_id uuid
)
returns table (entry_date date, entry_number text, source_type public.journal_source_type,
               memo text, debit numeric, credit numeric, balance numeric)
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
    with movements as (
      select e.entry_date, e.entry_number, e.source_type, e.memo, e.created_at,
             l.debit, l.credit, l.id as line_id, e.id as entry_id, e.idempotency_key
        from public.journal_lines l
        join public.journal_entries e on e.organization_id = l.organization_id and e.id = l.entry_id
        join public.treasury_accounts t on t.organization_id = l.organization_id
       where t.organization_id = p_org_id and t.id = p_treasury_id
         and l.account_id = t.chart_account_id
    ),
    numbered as (
      select m.*, row_number() over (order by m.entry_date, m.created_at, m.entry_number) as rn
        from movements m
    )
    select entry_date, entry_number, source_type, memo, debit, credit,
           coalesce(sum(debit - credit) over (order by rn rows unbounded preceding), 0) as balance
      from numbered
     order by rn;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC boundary guard: a treasury account must not go negative (RPC check).
-- ---------------------------------------------------------------------------
create or replace function public.assert_treasury_sufficient(
  p_org_id uuid,
  p_treasury_id uuid,
  p_out_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  perform public.assert_journal_omr(p_out_amount);
  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_balance
    from public.journal_lines
   where organization_id = p_org_id
     and account_id = (select chart_account_id from public.treasury_accounts
                        where organization_id = p_org_id and id = p_treasury_id);
  if v_balance is null or v_balance < p_out_amount then
    raise exception 'TREASURY_NEGATIVE_BALANCE_NOT_ALLOWED' using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create treasury account (finance.manage). Child chart account auto-created.
-- ---------------------------------------------------------------------------
create or replace function public.create_treasury_account(
  p_org_id uuid,
  p_name text,
  p_treasury_type public.treasury_account_type,
  p_bank_name text default null,
  p_account_tail text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.treasury_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.treasury_accounts;
  v_parent public.chart_of_accounts;
  v_child_code text;
  v_child_count int;
  v_replay jsonb;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'TREASURY_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_TREASURY_ACCOUNT', 'name', trim(p_name),
    'type', p_treasury_type, 'bank_name', nullif(trim(coalesce(p_bank_name,'')),''),
    'tail', nullif(trim(coalesce(p_account_tail,'')),''), 'notes', nullif(trim(coalesce(p_notes,'')),'')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.treasury_accounts, v_replay);
  end if;

  perform public.ensure_system_chart(p_org_id);

  select * into v_parent
    from public.chart_of_accounts
   where organization_id = p_org_id and code = public.treasury_parent_code(p_treasury_type)
     and is_system = true;
  if not found then
    raise exception 'TREASURY_PARENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*)::int into v_child_count
    from public.treasury_accounts t
    join public.chart_of_accounts c on c.organization_id = t.organization_id and c.id = t.chart_account_id
   where t.organization_id = p_org_id and c.parent_id = v_parent.id;

  v_child_code := (v_parent.code::int + v_child_count + 1)::text;

  insert into public.chart_of_accounts
    (organization_id, code, name, account_type, normal_balance, is_system, is_active, parent_id, purpose)
  values
    (p_org_id, v_child_code, trim(p_name), 'ASSET', 'DEBIT', false, true, v_parent.id,
     'Treasury account: ' || public.treasury_parent_code(p_treasury_type));
  -- Note: the auto-generated child code CAN collide between two concurrent
  -- creates; the unique (org, code) constraint rejects the second create, and
  -- the caller retries with a fresh name. This is acceptable for a small team.

  insert into public.treasury_accounts (
    organization_id, name, treasury_type, chart_account_id, is_active,
    bank_name, account_tail, notes, created_by
  ) values (
    p_org_id, trim(p_name), p_treasury_type,
    (select id from public.chart_of_accounts where organization_id = p_org_id and code = v_child_code),
    true,
    nullif(trim(coalesce(p_bank_name, '')), ''),
    nullif(trim(coalesce(p_account_tail, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning * into v_account;

  perform public.record_audit(p_org_id, 'TREASURY_ACCOUNT_CREATED', 'treasury_account', v_account.id::text,
    jsonb_build_object('name', v_account.name, 'type', v_account.treasury_type, 'chart_code', v_child_code));
  perform public.finish_payment_command(p_org_id, p_idempotency_key, 'CREATE_TREASURY_ACCOUNT',
    v_fingerprint, 'treasury_account', v_account.id, to_jsonb(v_account));
  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- Update treasury account (finance.manage). Cannot deactivate a non-zero balance.
-- ---------------------------------------------------------------------------
create or replace function public.update_treasury_account(
  p_org_id uuid,
  p_treasury_id uuid,
  p_name text default null,
  p_is_active boolean default null,
  p_bank_name text default null,
  p_account_tail text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.treasury_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.treasury_accounts;
  v_deactivating boolean;
  v_balance numeric;
  v_replay jsonb;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'UPDATE_TREASURY_ACCOUNT', 'id', p_treasury_id, 'name', nullif(trim(coalesce(p_name,'')),''),
    'is_active', p_is_active, 'bank_name', nullif(trim(coalesce(p_bank_name,'')),''),
    'tail', nullif(trim(coalesce(p_account_tail,'')),''), 'notes', nullif(trim(coalesce(p_notes,'')),'')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.treasury_accounts, v_replay);
  end if;

  select * into v_account from public.treasury_accounts
   where organization_id = p_org_id and id = p_treasury_id for update;
  if not found then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_deactivating := coalesce(p_is_active, v_account.is_active) is false;
  if v_deactivating and v_account.is_active then
    select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_balance
      from public.journal_lines
     where organization_id = p_org_id and account_id = v_account.chart_account_id;
    if v_balance <> 0 then
      raise exception 'TREASURY_NONZERO_BALANCE_DEACTIVATE' using errcode = '23514';
    end if;
  end if;

  update public.treasury_accounts
     set name = coalesce(nullif(trim(p_name), ''), v_account.name),
         is_active = coalesce(p_is_active, v_account.is_active),
         bank_name = coalesce(nullif(trim(p_bank_name), ''), v_account.bank_name),
         account_tail = coalesce(nullif(trim(p_account_tail), ''), v_account.account_tail),
         notes = coalesce(nullif(trim(p_notes), ''), v_account.notes),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_treasury_id
   returning * into v_account;

  update public.chart_of_accounts set is_active = v_account.is_active
   where organization_id = p_org_id and id = v_account.chart_account_id;

  perform public.record_audit(p_org_id, 'TREASURY_ACCOUNT_UPDATED', 'treasury_account', v_account.id::text,
    jsonb_build_object('name', v_account.name, 'is_active', v_account.is_active));
  perform public.finish_payment_command(p_org_id, p_idempotency_key, 'UPDATE_TREASURY_ACCOUNT',
    v_fingerprint, 'treasury_account', v_account.id, to_jsonb(v_account));
  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- Treasury transfer: Dr destination / Cr source, balanced, no P&L effect.
-- ---------------------------------------------------------------------------
create or replace function public.treasury_transfer(
  p_org_id uuid,
  p_from_treasury_id uuid,
  p_to_treasury_id uuid,
  p_amount numeric,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.treasury_accounts;
  v_to public.treasury_accounts;
  v_journal public.journal_entries;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_journal_omr(p_amount);

  if p_from_treasury_id = p_to_treasury_id then
    raise exception 'TREASURY_TRANSFER_SAME_ACCOUNT' using errcode = '23514';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'TREASURY_TRANSFER', 'from', p_from_treasury_id,
    'to', p_to_treasury_id, 'amount', p_amount::text, 'note', nullif(trim(coalesce(p_note,'')),'')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.journal_entries, v_replay);
  end if;

  select * into v_from from public.treasury_accounts
   where organization_id = p_org_id and id = p_from_treasury_id for update;
  if not found then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_to from public.treasury_accounts
   where organization_id = p_org_id and id = p_to_treasury_id for update;
  if not found then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_from.is_active then
    raise exception 'TREASURY_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if not v_to.is_active then
    raise exception 'TREASURY_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  perform public.assert_treasury_sufficient(p_org_id, p_from_treasury_id, p_amount);

  v_journal := public.internal_post_journal(
    p_org_id,
    current_date,
    'TREASURY_TRANSFER',
    v_from.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_to.chart_account_id::text, 'debit', p_amount, 'credit', 0,
        'line_memo', 'Transfer from ' || v_from.name),
      jsonb_build_object('account_id', v_from.chart_account_id::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Transfer to ' || v_to.name)
    ),
    p_idempotency_key,
    v_fingerprint,
    nullif(trim(coalesce(p_note, '')), '')::text || ' — ' || v_from.name || ' → ' || v_to.name
  );

  perform public.finish_payment_command(p_org_id, p_idempotency_key, 'TREASURY_TRANSFER',
    v_fingerprint, 'journal_entry', v_journal.id, to_jsonb(v_journal));
  return v_journal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deterministic treasury opening balance (cutover). One OPENING_BALANCE journal
-- per treasury account; balance must currently be zero and no opening posted yet.
-- ---------------------------------------------------------------------------
create or replace function public.set_treasury_opening_balance(
  p_org_id uuid,
  p_treasury_id uuid,
  p_amount numeric,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.treasury_accounts;
  v_balance numeric;
  v_journal public.journal_entries;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_amount = 0 then
    raise exception 'OPENING_BALANCE_ZERO' using errcode = '22023';
  end if;
  perform public.assert_journal_omr(abs(p_amount));

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'SET_TREASURY_OPENING', 'treasury_id', p_treasury_id, 'amount', p_amount::text
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.journal_entries, v_replay);
  end if;

  select * into v_account from public.treasury_accounts
   where organization_id = p_org_id and id = p_treasury_id for update;
  if not found then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_balance
    from public.journal_lines
   where organization_id = p_org_id and account_id = v_account.chart_account_id;
  if v_balance <> 0 then
    raise exception 'OPENING_BALANCE_NOT_ZERO' using errcode = '23514';
  end if;
  if exists (select 1 from public.journal_entries
             where organization_id = p_org_id and source_type = 'OPENING_BALANCE'
               and exists (select 1 from public.journal_lines l
                            where l.entry_id = journal_entries.id and l.account_id = v_account.chart_account_id)) then
    raise exception 'OPENING_BALANCE_ALREADY_SET' using errcode = '23514';
  end if;

  -- Positive opening: Dr treasury / Cr Opening Balance Equity. Negative opening
  -- (e.g. an overdrawn bank) uses the mirror, which is a deliberate owner input.
  if p_amount > 0 then
    v_journal := public.internal_post_journal(
      p_org_id, current_date, 'OPENING_BALANCE', v_account.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_account.chart_account_id::text, 'debit', p_amount, 'credit', 0,
          'line_memo', 'Opening balance: ' || v_account.name),
        jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id = p_org_id and code = '3000')::text,
          'debit', 0, 'credit', p_amount, 'line_memo', 'Opening equity offset')
      ),
      p_idempotency_key, v_fingerprint, 'Opening treasury balance: ' || v_account.name,
      null, null, null, false
    );
  else
    v_journal := public.internal_post_journal(
      p_org_id, current_date, 'OPENING_BALANCE', v_account.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_account.chart_account_id::text, 'debit', 0, 'credit', abs(p_amount),
          'line_memo', 'Opening balance (negative): ' || v_account.name),
        jsonb_build_object('account_id', (select id from public.chart_of_accounts where organization_id = p_org_id and code = '3000')::text,
          'debit', abs(p_amount), 'credit', 0, 'line_memo', 'Opening equity offset')
      ),
      p_idempotency_key, v_fingerprint, 'Opening treasury balance (negative): ' || v_account.name,
      null, null, null, false
    );
  end if;

  perform public.finish_payment_command(p_org_id, p_idempotency_key, 'SET_TREASURY_OPENING',
    v_fingerprint, 'journal_entry', v_journal.id, to_jsonb(v_journal));
  return v_journal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges.
-- ---------------------------------------------------------------------------
revoke all on function public.treasury_parent_code(public.treasury_account_type) from public, anon, authenticated;
revoke all on function public.assert_treasury_sufficient(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.create_treasury_account(uuid, text, public.treasury_account_type, text, text, text, uuid) from public, anon;
revoke all on function public.update_treasury_account(uuid, uuid, text, boolean, text, text, text, uuid) from public, anon;
revoke all on function public.treasury_transfer(uuid, uuid, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.set_treasury_opening_balance(uuid, uuid, numeric, uuid) from public, anon;
revoke all on function public.treasury_account_balance(uuid, uuid) from public, anon;
revoke all on function public.treasury_account_balances(uuid) from public, anon;
revoke all on function public.treasury_statement(uuid, uuid) from public, anon;

grant execute on function public.create_treasury_account(uuid, text, public.treasury_account_type, text, text, text, uuid), public.update_treasury_account(uuid, uuid, text, boolean, text, text, text, uuid), public.treasury_transfer(uuid, uuid, uuid, numeric, text, uuid), public.set_treasury_opening_balance(uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.treasury_account_balance(uuid, uuid), public.treasury_account_balances(uuid), public.treasury_statement(uuid, uuid) to authenticated;
