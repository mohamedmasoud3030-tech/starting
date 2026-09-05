-- ============================================================================
-- 0092 — Staff advance settlement (STAFF_ADVANCE_SETTLEMENT)
--
-- Remaining payroll contract (§6, §15, §21): after an advance has created
-- Staff Advances & Receivables (1150) and attendance has accrued Payroll
-- Payable (2300), the owner may explicitly settle the two so neither a
-- receivable nor a payable remains for the matched amount.
--
--   Dr Payroll Payable 2300
--   Cr Staff Advances & Receivables 1150
--
-- Invariants:
--   * amount > 0, exact OMR 3dp
--   * amount <= current payroll payable (2300 never goes negative)
--   * amount <= current staff receivable (1150 never goes negative)
--   * optional advance_id further caps amount at that advance's remaining
--     unsettled balance
--   * payroll.pay, org isolation, idempotent command identity
--   * host-wide (no event_id) so financial-close of an event does not block
--     liability settlement after close (contract §18)
--   * void reverses via _post_reversal; source_type stays
--     STAFF_ADVANCE_SETTLEMENT with is_reversal = true (taxonomy has no
--     dedicated SETTLEMENT_VOID; the reversal flag is the discriminator)
--
-- Does not create a second staff-balance subsystem: operational E/A/P
-- ledgers remain canonical; this table is the source document for the
-- journal, the same pattern as host_payouts / staff_advances.
-- ============================================================================

create table public.staff_advance_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_member_id uuid not null,
  advance_id uuid,
  amount numeric(12,3) not null check (amount > 0),
  settlement_date date not null,
  reason text,
  status public.host_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint staff_advance_settlements_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members(organization_id, id) on delete restrict,
  constraint staff_advance_settlements_advance_fk
    foreign key (organization_id, advance_id)
    references public.staff_advances(organization_id, id) on delete restrict,
  constraint staff_advance_settlements_org_id_unique unique (organization_id, id),
  constraint staff_advance_settlements_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint staff_advance_settlements_void_shape check (
    (status = 'VOIDED' and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED' and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index staff_advance_settlements_staff_idx
  on public.staff_advance_settlements (organization_id, staff_member_id, settlement_date, id);
create index staff_advance_settlements_advance_idx
  on public.staff_advance_settlements (organization_id, advance_id)
  where advance_id is not null;

alter table public.staff_advance_settlements enable row level security;

create policy "staff_advance_settlements_select_payroll"
  on public.staff_advance_settlements
  for select using (public.has_permission(organization_id, 'payroll.read'));

revoke all on table public.staff_advance_settlements from public, anon, authenticated;
grant select on table public.staff_advance_settlements to authenticated;

-- Remaining unsettled amount of one advance (0 if missing / voided).
create or replace function public._staff_advance_remaining(
  p_org_id uuid,
  p_advance_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(a.amount, 0) - coalesce((
    select sum(s.amount) from public.staff_advance_settlements s
     where s.organization_id = p_org_id
       and s.advance_id = p_advance_id
       and s.status = 'RECORDED'
  ), 0), 0)
    from public.staff_advances a
   where a.organization_id = p_org_id and a.id = p_advance_id and a.status = 'RECORDED';
$$;

-- ---------------------------------------------------------------------------
-- settle_staff_advance — Dr 2300 / Cr 1150.
-- ---------------------------------------------------------------------------
create or replace function public.settle_staff_advance(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_settlement_date date,
  p_reason text default null,
  p_advance_id uuid default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.staff_advance_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advance_settlements;
  v_fingerprint text;
  v_replay jsonb;
  v_payable numeric;
  v_receivable numeric;
  v_remaining numeric;
  v_chart_payable uuid;
  v_chart_receivable uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_settlement_date is null then
    raise exception 'SETTLEMENT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.staff_members m
     where m.organization_id = p_org_id and m.id = p_staff_member_id
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'SETTLE_STAFF_ADVANCE',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'settlement_date', p_settlement_date,
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'advance_id', p_advance_id
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advance_settlements, v_replay);
  end if;

  -- Serialize settlements for this host so payable/receivable cannot race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':settle:' || p_staff_member_id::text, 3)
  );

  select payable, receivable into v_payable, v_receivable
    from public._staff_payroll_position(p_org_id, p_staff_member_id);
  if v_payable is null then v_payable := 0; end if;
  if v_receivable is null then v_receivable := 0; end if;
  if v_payable < 0 then v_payable := 0; end if;
  if v_receivable < 0 then v_receivable := 0; end if;

  if v_payable <= 0 then
    raise exception 'PAYROLL_PAYABLE_ZERO' using errcode = '23514';
  end if;
  if v_receivable <= 0 then
    raise exception 'STAFF_RECEIVABLE_ZERO' using errcode = '23514';
  end if;
  if p_amount > v_payable then
    raise exception 'SETTLEMENT_EXCEEDS_PAYABLE' using errcode = '23514';
  end if;
  if p_amount > v_receivable then
    raise exception 'SETTLEMENT_EXCEEDS_RECEIVABLE' using errcode = '23514';
  end if;

  if p_advance_id is not null then
    if not exists (
      select 1 from public.staff_advances a
       where a.organization_id = p_org_id
         and a.id = p_advance_id
         and a.staff_member_id = p_staff_member_id
         and a.status = 'RECORDED'
    ) then
      raise exception 'ADVANCE_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_remaining := coalesce(public._staff_advance_remaining(p_org_id, p_advance_id), 0);
    if p_amount > v_remaining then
      raise exception 'SETTLEMENT_EXCEEDS_ADVANCE' using errcode = '23514';
    end if;
  end if;

  insert into public.staff_advance_settlements (
    organization_id, staff_member_id, advance_id, amount, settlement_date,
    reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_advance_id, p_amount, p_settlement_date,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.ensure_system_chart(p_org_id);
  v_chart_payable := public._chart_id(p_org_id, '2300');
  v_chart_receivable := public._chart_id(p_org_id, '1150');
  perform public.internal_post_journal(
    p_org_id, p_settlement_date,
    'STAFF_ADVANCE_SETTLEMENT', v_row.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_chart_payable::text, 'debit', p_amount, 'credit', 0,
        'line_memo', 'Staff advance settled against payroll payable'),
      jsonb_build_object('account_id', v_chart_receivable::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Staff receivable reduced')
    ),
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'SETTLE_STAFF_ADVANCE', 'settlement', v_row.id,
      'staff', p_staff_member_id, 'amount', p_amount::text
    )),
    'Staff advance settlement: ' || coalesce(nullif(trim(p_reason), ''), 'settlement'),
    now(), null, null, false
  );

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_SETTLED', 'staff_advance_settlement', v_row.id::text,
    jsonb_build_object('staff_member_id', p_staff_member_id, 'amount', p_amount::text,
      'advance_id', p_advance_id)
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'SETTLE_STAFF_ADVANCE', v_fingerprint,
    'staff_advance_settlement', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_staff_advance_settlement — reverse the settlement journal.
-- ---------------------------------------------------------------------------
create or replace function public.void_staff_advance_settlement(
  p_org_id uuid,
  p_settlement_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.staff_advance_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advance_settlements;
  v_fingerprint text;
  v_replay jsonb;
  v_orig_entry uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_STAFF_ADVANCE_SETTLEMENT',
    'settlement_id', p_settlement_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advance_settlements, v_replay);
  end if;

  select * into v_row from public.staff_advance_settlements
   where organization_id = p_org_id and id = p_settlement_id for update;
  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'SETTLEMENT_ALREADY_VOIDED';
  end if;

  update public.staff_advance_settlements set
    status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_settlement_id returning * into v_row;

  select e.id into v_orig_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'STAFF_ADVANCE_SETTLEMENT'
     and e.source_id = v_row.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_orig_entry, 'STAFF_ADVANCE_SETTLEMENT', v_row.id,
      md5(p_idempotency_key::text || ':settle-rev')::uuid, trim(p_reason)
    );
  end if;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_SETTLEMENT_VOIDED', 'staff_advance_settlement', v_row.id::text,
    jsonb_build_object('reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ADVANCE_SETTLEMENT', v_fingerprint,
    'staff_advance_settlement', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

revoke all on function public._staff_advance_remaining(uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_staff_advance(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon;
revoke all on function public.void_staff_advance_settlement(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.settle_staff_advance(uuid, uuid, numeric, date, text, uuid, uuid) to authenticated;
grant execute on function public.void_staff_advance_settlement(uuid, uuid, text, uuid) to authenticated;
