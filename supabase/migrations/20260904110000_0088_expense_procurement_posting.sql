-- ============================================================================
-- 0088 — Operational expense posting (D2)
--
-- Re-points the authoritative direct-expense commands so an immediately-paid
-- operating expense ALSO posts its accounting consequence inside the SAME
-- transaction as the operational mutation (atomic: if the journal fails, the
-- expense command fails too):
--
--   * record_event_expense -> EVENT_EXPENSE
--       Dr Direct Event Expense 5200   (amount, net; input VAT deferred)
--       Cr Treasury (resolved account) (amount)
--   * void_event_expense   -> EVENT_EXPENSE_VOID (reversal of the original,
--       via reverse_journal_entry, referencing the original journal)
--
-- Treasury attribution: the external caller may supply a treasury_account_id.
-- When omitted (backward compatible), the system CASH account is resolved the
-- same way as the customer-payment posting in 0086 — first active CASH treasury
-- else system chart 1000. Cross-org / inactive / insufficient-treasury are all
-- rejected deterministically; the no-negative-CASH rule is preserved.
--
-- Procurement: by design purchase-order creation, approval and goods receipt
-- are NON-FINANCIAL (commitment / delivery proof only). Accounting liability
-- arises only at supplier invoice, which is the future Supplier AP slice.
-- Therefore 0088 posts NOTHING for procurement — doing so would invent a
-- treasury payment for an unpaid liability and would double-count against the
-- event-expense source. No journal is emitted for PO/approval/receipt.
--
-- Contract: docs/research/accounting-posting-contract.md §7, §9, §10, §15, §22.
--   * Input VAT for expenses is DEFERRED to future supplier accounting; the
--     account 2150 is OUTPUT VAT ONLY and is never used for supplier input VAT.
--   * No 5200 sub-accounts; category stays in the source document.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: is a treasury account active?
-- ---------------------------------------------------------------------------
create or replace function public.t_is_active(p_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_active from public.treasury_accounts
                   where organization_id = p_org_id and id = p_id), false);
$$;

-- ---------------------------------------------------------------------------
-- Internal: resolve the treasury account + chart for an expense, returning both
-- the treasury_accounts.id (for sufficiency + attribution) and its chart id.
-- Chart resolution is delegated to the established 0086 helper
-- `_resolve_treasury_chart` so there is a single source of treasury->chart
-- mapping; this function adds cross-org / inactive rejection and returns the
-- treasury id so the caller can run the no-negative-CASH sufficiency check.
-- ---------------------------------------------------------------------------
create or replace function public._resolve_expense_treasury(
  p_org_id uuid,
  p_treasury_id uuid
)
returns table (treasury_id uuid, chart_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tid uuid;
  v_chart uuid;
begin
  if p_treasury_id is not null then
    select t.id into v_tid
      from public.treasury_accounts t
     where t.organization_id = p_org_id and t.id = p_treasury_id;
    if not found then
      raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not public.t_is_active(v_tid, p_org_id) then
      raise exception 'TREASURY_ACCOUNT_INACTIVE' using errcode = '42501';
    end if;
  else
    -- Backward compatible default: first active CASH treasury, else system 1000.
    select id into v_tid
      from public.treasury_accounts
     where organization_id = p_org_id and is_active = true and treasury_type = 'CASH'
     order by created_at, id
     limit 1;
  end if;
  -- Delegate chart mapping to the authoritative resolver (0086). When a real
  -- active treasury is used it returns that treasury's chart; when none exists
  -- it falls back to the system Cash parent (1000).
  v_chart := public._resolve_treasury_chart(p_org_id, p_treasury_id);
  return query select v_tid, v_chart;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_event_expense — re-pointed with treasury attribution + posting.
-- New 11th optional param p_treasury_account_id default null; the old 10-arg
-- non-posting overload is DROPPED so existing 10-arg callers route here.
-- ---------------------------------------------------------------------------
drop function if exists public.record_event_expense(
  uuid, uuid, public.expense_category, numeric, date, text, public.payment_method,
  text, text, uuid
);
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
  p_idempotency_key uuid default gen_random_uuid(),
  p_treasury_account_id uuid default null
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
  v_tid uuid;
  v_chart uuid;
  v_expense_chart uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
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
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'treasury', p_treasury_account_id
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

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  select * into v_tid, v_chart
    from public._resolve_expense_treasury(p_org_id, p_treasury_account_id);
  if v_chart is null then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- No-negative-CASH / sufficiency guard (only when a real treasury is used).
  if v_tid is not null then
    perform public.assert_treasury_sufficient(p_org_id, v_tid, p_amount);
  end if;
  v_expense_chart := public._chart_id(p_org_id, '5200');
  perform public.internal_post_journal(
    p_org_id,
    p_expense_date,
    'EVENT_EXPENSE',
    v_expense.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense_chart::text, 'debit', p_amount, 'credit', 0,
        'line_memo', p_category || ': ' || coalesce(nullif(trim(p_description), ''), 'expense')),
      jsonb_build_object('account_id', v_chart::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Paid from treasury')
    ),
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_EVENT_EXPENSE', 'event', p_event_id, 'expense', v_expense.id,
      'amount', p_amount::text, 'treasury', coalesce(v_tid, v_chart)::text
    )),
    p_category::text || ' expense: ' || coalesce(nullif(trim(p_description), ''), ''),
    now(), p_event_id, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_EVENT_EXPENSE', v_fingerprint,
    'event_expense', v_expense.id, to_jsonb(v_expense)
  );
  perform public.record_audit(p_org_id, 'EVENT_EXPENSE_RECORDED', 'event_expense', v_expense.id::text,
    jsonb_build_object('event_id', p_event_id, 'category', p_category, 'amount', p_amount::text,
      'treasury', coalesce(v_tid, v_chart)::text));
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_event_expense — re-pointed to reverse the authoritative EVENT_EXPENSE
-- journal (Dr Treasury / Cr Expense) via reverse_journal_entry. Signature
-- unchanged (in-place CREATE OR REPLACE).
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
  v_orig public.journal_entries;
  v_entry_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
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

  -- Reversal of the authoritative EVENT_EXPENSE journal, if present.
  select e.id into v_entry_id
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'EVENT_EXPENSE'
     and e.source_id = v_expense.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public.reverse_journal_entry(
      p_org_id, v_entry_id, trim(p_reason),
      md5(p_idempotency_key::text || ':expense-rev')::uuid
    );
  end if;

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
-- Procurement: NO accounting post. The repository intentionally keeps purchase
-- orders / approvals / receipts non-financial until supplier invoice (Supplier
-- AP slice). Nothing to wire here — the economic event (expense) is represented
-- by event_expenses, which is now the authoritative accounting trigger.
--
-- Anti-double-counting: procurement orders are a SEPARATE cost source from
-- event_expenses (0067 §header). event_expenses excludes PURCHASE/STAFF, so the
-- same purchase is never both a procurement cost and an event expense.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Privileges: internal helper never client-exposed; re-pointed RPC kept.
-- ---------------------------------------------------------------------------
revoke all on function public._resolve_expense_treasury(uuid, uuid) from public, anon, authenticated;
revoke all on function public.t_is_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_event_expense(uuid, uuid, public.expense_category, numeric, date, text, public.payment_method, text, text, uuid, uuid) to authenticated;
