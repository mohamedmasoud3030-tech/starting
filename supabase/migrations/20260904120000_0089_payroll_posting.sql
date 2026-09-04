-- ============================================================================
-- 0089 — Payroll / staff financial posting (B2)
--
-- Re-points the authoritative payroll commands so a staff economic fact ALSO
-- posts its accounting consequence inside the SAME transaction as the
-- operational mutation (atomic: if the journal fails, the command fails):
--
--   * Attendance earning (PRESENT/LATE/PARTIAL, earned>0) -> HOST_EARNING
--       Dr Staff Cost 5000
--       Cr Payroll Payable 2300
--   * Attendance void                    -> HOST_EARNING_VOID (reversal of the
--       original earning, referencing the original journal)
--   * Staff advance                      -> STAFF_ADVANCE
--       Dr Staff Advances & Receivables 1150
--       Cr Treasury (resolved account)
--   * Advance void                       -> STAFF_ADVANCE_VOID (reversal)
--   * Host payout                        -> HOST_PAYOUT
--       Dr Payroll Payable 2300 (amount <= available payable)
--       + Dr Staff Advances & Receivables 1150 (excess over payable)
--       Cr Treasury (total paid)         (overpayment -> staff receivable)
--   * Payout void                        -> HOST_PAYOUT_VOID (reversal)
--
-- Accounting contract:
-- docs/research/accounting-posting-contract.md §6 (payroll), §10 (treasury),
-- §22 (VAT — payroll has no VAT), chart codes verified from 0084.
--
-- Invariants preserved:
--   * Payroll Payable (2300) >= 0  — never a negative liability.
--   * Staff Advances & Receivables (1150) >= 0 — never a negative asset.
--   * Overpayment becomes Staff Receivable (never hard-blocked; owner-friendly).
--   * Cash treasury must never go negative (assert_treasury_sufficient).
--   * Journal entries balanced + immutable; reversals reference the original.
--
-- Attendance postings are driven by a single AFTER-INSERT/UPDATE trigger on
-- public.staff_attendance (the one authoritative accounting trigger), because
-- authoritative attendance is created through several RPC paths
-- (record_staff_attendance, clock_staff_in, assisted face). Advances and
-- payouts are single-command paths, so they are re-pointed in-place.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: reverse an existing journal into a specific void source type.
-- Reads the original entry + lines, swaps debit/credit, and posts a reversal
-- journal (is_reversal = true, reversal_of = original) under the given source
-- type and the operational source_id (so staff/supplier attribution survives).
-- ---------------------------------------------------------------------------
create or replace function public._post_reversal(
  p_org_id uuid,
  p_original_entry_id uuid,
  p_void_source_type public.journal_source_type,
  p_source_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_event_id uuid default null,
  p_event_at timestamptz default null
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig public.journal_entries;
  v_lines jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REVERSAL_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_orig
    from public.journal_entries
   where organization_id = p_org_id and id = p_original_entry_id;
  if not found then
    raise exception 'JOURNAL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_orig.is_reversal then
    raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', l.account_id::text,
    'debit', case when l.credit > 0 then l.credit else 0 end,
    'credit', case when l.debit > 0 then l.debit else 0 end,
    'line_memo', 'Reversal of ' || v_orig.entry_number || ': ' || trim(p_reason)
  )), '[]'::jsonb) into v_lines
    from public.journal_lines l where l.entry_id = v_orig.id;

  return public.internal_post_journal(
    p_org_id,
    v_orig.entry_date,
    p_void_source_type,
    p_source_id,
    v_lines,
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', p_void_source_type::text, 'entry_id', p_original_entry_id, 'reason', trim(p_reason)
    )),
    'Void of ' || v_orig.entry_number || ': ' || trim(p_reason),
    coalesce(p_event_at, v_orig.event_at),
    coalesce(p_event_id, v_orig.event_id),
    v_orig.id,
    true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: compute the current payroll payable (2300 credit-normal) and staff
-- receivable (1150 debit-normal) attributed to a staff member, straight from the
-- journal (the accounting truth). Originals + reversals are netted naturally.
-- ---------------------------------------------------------------------------
create or replace function public._staff_payroll_position(
  p_org_id uuid,
  p_staff_member_id uuid
)
returns table (payable numeric, receivable numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(l.credit - l.debit) filter (
      where l.account_id = (select id from public.chart_of_accounts
                            where organization_id = p_org_id and code = '2300')
    ), 0) as payable,
    coalesce(sum(l.debit - l.credit) filter (
      where l.account_id = (select id from public.chart_of_accounts
                            where organization_id = p_org_id and code = '1150')
    ), 0) as receivable
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where e.organization_id = p_org_id
     and (
       (e.source_type in ('HOST_EARNING','HOST_EARNING_VOID')
        and exists (select 1 from public.staff_attendance a
                     where a.organization_id = p_org_id and a.id = e.source_id
                       and a.staff_member_id = p_staff_member_id))
       or (e.source_type in ('HOST_PAYOUT','HOST_PAYOUT_VOID')
        and exists (select 1 from public.host_payouts h
                     where h.organization_id = p_org_id and h.id = e.source_id
                       and h.staff_member_id = p_staff_member_id))
       or (e.source_type in ('STAFF_ADVANCE','STAFF_ADVANCE_VOID')
        and exists (select 1 from public.staff_advances s
                     where s.organization_id = p_org_id and s.id = e.source_id
                       and s.staff_member_id = p_staff_member_id))
     );
$$;

-- ---------------------------------------------------------------------------
-- Attendance earning posting — single authoritative accounting trigger.
-- AFTER INSERT: a present/late/partial attendance with earned_amount > 0 posts
--   Dr 5000 / Cr 2300 (HOST_EARNING) with source_id = attendance id.
-- AFTER UPDATE: a deliberate RECORDED -> VOIDED transition reverses the
--   original earning (HOST_EARNING_VOID). The BEFORE guard already restricts
--   updates to exactly that transition.
-- Idempotency: the journal key is derived from attendance id, so a replay can
--   never double-post; the trigger fires once per insert/void within a tx.
-- Scope guard: authoritative attendance is created only through authenticated
-- RPCs (record_staff_attendance, clock_staff_in), so a journal is posted only
-- when a caller session exists. Raw fixture inserts (tests / backfills) with no
-- caller are silently skipped — they carry no accounting actor, and production
-- never creates attendance without an authenticated command.
-- ---------------------------------------------------------------------------
create or replace function public.staff_attendance_earning_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chart_staff_cost uuid;
  v_chart_payroll uuid;
  v_idem uuid;
  v_orig_entry uuid;
begin
  if auth.uid() is null then
    return null;   -- no accounting actor; raw fixture / non-command inserts skip
  end if;
  if tg_op = 'INSERT' then
    if new.status in ('PRESENT','LATE','PARTIAL') and new.earned_amount > 0 then
      perform public.ensure_system_chart(new.organization_id);
      v_chart_staff_cost := public._chart_id(new.organization_id, '5000');
      v_chart_payroll := public._chart_id(new.organization_id, '2300');
      v_idem := md5('HOST_EARNING:' || new.organization_id::text || ':' || new.id::text)::uuid;
      perform public.internal_post_journal(
        new.organization_id,
        new.attendance_date,
        'HOST_EARNING',
        new.id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_chart_staff_cost::text, 'debit', new.earned_amount, 'credit', 0,
            'line_memo', 'Attendance earned (staff cost)'),
          jsonb_build_object('account_id', v_chart_payroll::text, 'debit', 0, 'credit', new.earned_amount,
            'line_memo', 'Payroll payable accrued')
        ),
        v_idem,
        public.warehouse_fingerprint(jsonb_build_object(
          'command', 'HOST_EARNING', 'attendance', new.id,
          'staff', new.staff_member_id, 'amount', new.earned_amount::text
        )),
        'Attendance earning for ' || new.attendance_date::text,
        new.check_out, new.event_id, null, false
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status <> 'VOIDED' and new.status = 'VOIDED' then
    select e.id into v_orig_entry
      from public.journal_entries e
     where e.organization_id = new.organization_id
       and e.source_type = 'HOST_EARNING'
       and e.source_id = new.id
       and not e.is_reversal
     order by e.created_at, e.id
     limit 1;
    if found then
      perform public._post_reversal(
        new.organization_id, v_orig_entry, 'HOST_EARNING_VOID', new.id,
        md5('HOST_EARNING_VOID:' || new.organization_id::text || ':' || new.id::text)::uuid,
        coalesce(new.void_reason, 'Attendance voided'),
        new.event_id, new.check_out
      );
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists staff_attendance_earning_posting on public.staff_attendance;
create trigger staff_attendance_earning_posting
  after insert or update on public.staff_attendance
  for each row execute function public.staff_attendance_earning_posting();

-- ---------------------------------------------------------------------------
-- record_staff_advance — re-pointed: posts STAFF_ADVANCE Dr 1150 / Cr Treasury.
-- New optional trailing p_treasury_account_id default null; obsolete 6-arg
-- overload dropped so existing 6-arg callers route here.
-- ---------------------------------------------------------------------------
drop function if exists public.record_staff_advance(uuid, uuid, numeric, date, text, uuid);
create or replace function public.record_staff_advance(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_reason text,
  p_idempotency_key uuid,
  p_treasury_account_id uuid default null
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
  v_fingerprint text;
  v_replay jsonb;
  v_tid uuid;
  v_chart uuid;
  v_receivable_chart uuid;
  v_treasury_chart uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_advance_date is null then
    raise exception 'ADVANCE_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_STAFF_ADVANCE',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'advance_date', p_advance_date,
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'treasury', p_treasury_account_id
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  insert into public.staff_advances (
    organization_id, staff_member_id, amount, advance_date, reason,
    recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_amount, p_advance_date,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  select * into v_tid, v_chart
    from public._resolve_expense_treasury(p_org_id, p_treasury_account_id);
  if v_chart is null then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_tid is not null then
    perform public.assert_treasury_sufficient(p_org_id, v_tid, p_amount);
  end if;
  v_receivable_chart := public._chart_id(p_org_id, '1150');
  perform public.internal_post_journal(
    p_org_id, p_advance_date,
    'STAFF_ADVANCE', v_row.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_receivable_chart::text, 'debit', p_amount, 'credit', 0,
        'line_memo', 'Staff advance issued'),
      jsonb_build_object('account_id', v_chart::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Paid from treasury')
    ),
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_STAFF_ADVANCE', 'advance', v_row.id, 'amount', p_amount::text,
      'treasury', coalesce(v_tid, v_chart)::text
    )),
    'Staff advance: ' || coalesce(nullif(trim(p_reason), ''), 'advance'),
    now(), null, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_RECORDED', 'staff_advance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text,
      'treasury_account_id', p_treasury_account_id
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_staff_advance — re-pointed: reverses the STAFF_ADVANCE journal.
-- ---------------------------------------------------------------------------
create or replace function public.void_staff_advance(
  p_org_id uuid,
  p_advance_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
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
    'command', 'VOID_STAFF_ADVANCE',
    'advance_id', p_advance_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  select * into v_row
    from public.staff_advances
   where organization_id = p_org_id and id = p_advance_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'ADVANCE_ALREADY_VOIDED';
  end if;

  update public.staff_advances
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_advance_id
   returning * into v_row;

  -- Reversal of the authoritative STAFF_ADVANCE journal, if present.
  select e.id into v_orig_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'STAFF_ADVANCE'
     and e.source_id = v_row.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_orig_entry, 'STAFF_ADVANCE_VOID', v_row.id,
      md5(p_idempotency_key::text || ':advance-rev')::uuid, trim(p_reason)
    );
  end if;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_VOIDED', 'staff_advance', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_host_payout_multi — re-pointed: posts HOST_PAYOUT, splitting the
-- payment between Payroll Payable (up to available) and Staff Receivable
-- (excess) so Payroll Payable never goes negative.
-- New optional trailing p_treasury_account_id default null; obsolete overload
-- dropped so existing callers route here.
-- ---------------------------------------------------------------------------
drop function if exists public.record_host_payout_multi(
  uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid
);
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
  p_idempotency_key uuid default gen_random_uuid(),
  p_treasury_account_id uuid default null
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
  v_tid uuid;
  v_chart uuid;
  v_payable numeric;
  v_receivable numeric;
  v_payable_chart uuid;
  v_receivable_chart uuid;
  v_treasury_chart uuid;
  v_settle numeric;
  v_excess numeric;
  v_lines jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
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
    'evidence_path', nullif(trim(coalesce(p_evidence_path, '')), ''),
    'treasury', p_treasury_account_id
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

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  select * into v_tid, v_chart
    from public._resolve_expense_treasury(p_org_id, p_treasury_account_id);
  if v_chart is null then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_tid is not null then
    perform public.assert_treasury_sufficient(p_org_id, v_tid, p_amount);
  end if;

  -- Current payable / receivable for this staff (accounting state).
  select payable, receivable into v_payable, v_receivable
    from public._staff_payroll_position(p_org_id, p_staff_member_id);
  if v_payable < 0 then v_payable := 0; end if;   -- defensive; never negative

  -- Settle available payroll payable first; any excess becomes staff receivable
  -- so Payroll Payable (2300) can never go negative and 1150 stays >= 0.
  v_settle := case when p_amount <= v_payable then p_amount else v_payable end;
  v_excess := p_amount - v_settle;

  v_payable_chart := public._chart_id(p_org_id, '2300');
  v_receivable_chart := public._chart_id(p_org_id, '1150');

  v_lines := '[]'::jsonb;
  if v_settle > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_payable_chart::text, 'debit', v_settle, 'credit', 0,
        'line_memo', 'Host payout (settles payroll payable)'));
  end if;
  if v_excess > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_receivable_chart::text, 'debit', v_excess, 'credit', 0,
        'line_memo', 'Host payout excess (staff receivable)'));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_chart::text, 'debit', 0, 'credit', p_amount,
      'line_memo', 'Paid from treasury'));

  perform public.internal_post_journal(
    p_org_id, p_payout_date,
    'HOST_PAYOUT', v_row.id, v_lines,
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_HOST_PAYOUT_MULTI', 'payout', v_row.id, 'amount', p_amount::text,
      'settled', v_settle::text, 'excess', v_excess::text, 'treasury', coalesce(v_tid, v_chart)::text
    )),
    'Host payout: ' || coalesce(nullif(trim(p_reason), ''), 'payout'),
    now(), null, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_RECORDED', 'host_payout', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text,
      'allocations', p_allocations,
      'treasury_account_id', p_treasury_account_id
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
-- record_host_payout — legacy single-event variant; re-pointed to post the
-- same HOST_PAYOUT accounting (capability gate payroll.pay, treasury param).
-- ---------------------------------------------------------------------------
drop function if exists public.record_host_payout(
  uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid
);
create or replace function public.record_host_payout(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_payout_date date,
  p_payment_method public.payment_method,
  p_reference text,
  p_reason text,
  p_idempotency_key uuid,
  p_treasury_account_id uuid default null
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
  v_tid uuid;
  v_chart uuid;
  v_payable numeric;
  v_receivable numeric;
  v_payable_chart uuid;
  v_receivable_chart uuid;
  v_settle numeric;
  v_excess numeric;
  v_lines jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payroll.pay') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payout_date is null then
    raise exception 'PAYOUT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_HOST_PAYOUT',
    'staff_member_id', p_staff_member_id,
    'event_id', p_event_id,
    'amount', p_amount::text,
    'payout_date', p_payout_date,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'treasury', p_treasury_account_id
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  insert into public.host_payouts (
    organization_id, staff_member_id, event_id, amount, payout_date,
    payment_method, reference, reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_event_id, p_amount, p_payout_date,
    p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  select * into v_tid, v_chart
    from public._resolve_expense_treasury(p_org_id, p_treasury_account_id);
  if v_chart is null then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_tid is not null then
    perform public.assert_treasury_sufficient(p_org_id, v_tid, p_amount);
  end if;

  select payable, receivable into v_payable, v_receivable
    from public._staff_payroll_position(p_org_id, p_staff_member_id);
  if v_payable < 0 then v_payable := 0; end if;

  -- Settle available payroll payable first; any excess becomes staff receivable.
  v_settle := case when p_amount <= v_payable then p_amount else v_payable end;
  v_excess := p_amount - v_settle;

  v_payable_chart := public._chart_id(p_org_id, '2300');
  v_receivable_chart := public._chart_id(p_org_id, '1150');

  v_lines := '[]'::jsonb;
  if v_settle > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_payable_chart::text, 'debit', v_settle, 'credit', 0,
        'line_memo', 'Host payout (settles payroll payable)'));
  end if;
  if v_excess > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_receivable_chart::text, 'debit', v_excess, 'credit', 0,
        'line_memo', 'Host payout excess (staff receivable)'));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_chart::text, 'debit', 0, 'credit', p_amount,
      'line_memo', 'Paid from treasury'));

  perform public.internal_post_journal(
    p_org_id, p_payout_date,
    'HOST_PAYOUT', v_row.id, v_lines,
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_HOST_PAYOUT', 'payout', v_row.id, 'amount', p_amount::text,
      'settled', v_settle::text, 'excess', v_excess::text, 'treasury', coalesce(v_tid, v_chart)::text
    )),
    'Host payout: ' || coalesce(nullif(trim(p_reason), ''), 'payout'),
    now(), p_event_id, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_RECORDED', 'host_payout', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'event_id', p_event_id,
      'amount', p_amount::text,
      'treasury_account_id', p_treasury_account_id
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_HOST_PAYOUT', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_host_payout — re-pointed: reverses the HOST_PAYOUT journal.
-- ---------------------------------------------------------------------------
create or replace function public.void_host_payout(
  p_org_id uuid,
  p_payout_id uuid,
  p_reason text,
  p_idempotency_key uuid
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
    'command', 'VOID_HOST_PAYOUT',
    'payout_id', p_payout_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  select * into v_row
    from public.host_payouts
   where organization_id = p_org_id and id = p_payout_id
   for update;
  if not found then
    raise exception 'PAYOUT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'PAYOUT_ALREADY_VOIDED';
  end if;

  update public.host_payouts
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payout_id
   returning * into v_row;

  -- Reversal of the authoritative HOST_PAYOUT journal, if present.
  select e.id into v_orig_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'HOST_PAYOUT'
     and e.source_id = v_row.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_orig_entry, 'HOST_PAYOUT_VOID', v_row.id,
      md5(p_idempotency_key::text || ':payout-rev')::uuid, trim(p_reason),
      v_row.event_id
    );
  end if;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_VOIDED', 'host_payout', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_HOST_PAYOUT', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: internal helpers never client-exposed; re-pointed RPCs kept.
-- ---------------------------------------------------------------------------
revoke all on function public._post_reversal(uuid, uuid, public.journal_source_type, uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._staff_payroll_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public.staff_attendance_earning_posting() from public, anon, authenticated;

grant execute on function public.record_staff_advance(uuid, uuid, numeric, date, text, uuid, uuid) to authenticated;
grant execute on function public.record_host_payout_multi(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid, uuid) to authenticated;
grant execute on function public.record_host_payout(uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid, uuid) to authenticated;
