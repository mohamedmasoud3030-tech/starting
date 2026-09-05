-- ============================================================================
-- 0091 — Operational posting hardening (expenses / payroll / supplier AP)
--
-- Follow-up to 0088–0090. Does not reopen 0084–0090. Closes the remaining
-- contract gaps for this tranche:
--
--   * void_event_expense posts EVENT_EXPENSE_VOID (taxonomy §14) via the
--     0089 _post_reversal helper instead of the generic JOURNAL_REVERSAL.
--   * supplier_invoices inherit the existing financial-close guard: event-
--     linked cost creation is blocked while the event is financially closed.
--     Supplier payments remain unguarded (liability settlement after close
--     is allowed — contract §18).
--   * Privilege hardening against Supabase default grants: supplier tables
--     are SELECT-only for authenticated; command RPCs are revoked from
--     public/anon; internal helpers stay un-granted.
--   * _resolve_expense_treasury maps the resolved treasury id (not the
--     original nullable argument) so default CASH attribution and the
--     sufficiency check share one account.
--   * _post_reversal rejects a second reversal of the same original
--     (JOURNAL_ALREADY_REVERSED), matching reverse_journal_entry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Treasury resolver: use the resolved treasury id for chart mapping.
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
    select id into v_tid
      from public.treasury_accounts
     where organization_id = p_org_id and is_active = true and treasury_type = 'CASH'
     order by created_at, id
     limit 1;
  end if;
  v_chart := public._resolve_treasury_chart(p_org_id, v_tid);
  return query select v_tid, v_chart;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reversal helper: reject a second reversal of the same original.
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
  if exists (
    select 1 from public.journal_entries
     where organization_id = p_org_id
       and reversal_of = p_original_entry_id
       and is_reversal
  ) then
    raise exception 'JOURNAL_ALREADY_REVERSED' using errcode = '23514';
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
-- void_event_expense — EVENT_EXPENSE_VOID via _post_reversal.
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

  select e.id into v_entry_id
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'EVENT_EXPENSE'
     and e.source_id = v_expense.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_entry_id, 'EVENT_EXPENSE_VOID', v_expense.id,
      md5(p_idempotency_key::text || ':expense-rev')::uuid,
      trim(p_reason),
      v_expense.event_id
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
-- Financial close: event-linked supplier invoices are cost creation.
-- ---------------------------------------------------------------------------
drop trigger if exists supplier_invoices_financial_guard on public.supplier_invoices;
create trigger supplier_invoices_financial_guard
  before insert or update or delete on public.supplier_invoices
  for each row execute function public.guard_event_financially_closed();

-- ---------------------------------------------------------------------------
-- Privilege hardening.
-- ---------------------------------------------------------------------------
revoke all on table public.supplier_invoices from public, anon, authenticated;
revoke all on table public.supplier_invoice_lines from public, anon, authenticated;
revoke all on table public.supplier_payments from public, anon, authenticated;
revoke all on table public.supplier_payment_allocations from public, anon, authenticated;
grant select on table public.supplier_invoices, public.supplier_invoice_lines,
  public.supplier_payments, public.supplier_payment_allocations to authenticated;

revoke all on function public.t_is_active(uuid, uuid) from public, anon, authenticated;
revoke all on function public._resolve_expense_treasury(uuid, uuid) from public, anon, authenticated;
revoke all on function public._post_reversal(uuid, uuid, public.journal_source_type, uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._staff_payroll_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public.staff_attendance_earning_posting() from public, anon, authenticated;
revoke all on function public._supplier_ap_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public._supplier_invoice_ap(uuid, uuid) from public, anon, authenticated;

revoke all on function public.record_event_expense(uuid, uuid, public.expense_category, numeric, date, text, public.payment_method, text, text, uuid, uuid) from public, anon;
revoke all on function public.void_event_expense(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.record_event_expense(uuid, uuid, public.expense_category, numeric, date, text, public.payment_method, text, text, uuid, uuid) to authenticated;
grant execute on function public.void_event_expense(uuid, uuid, text, uuid) to authenticated;

revoke all on function public.record_staff_advance(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon;
revoke all on function public.void_staff_advance(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.record_host_payout_multi(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid, uuid) from public, anon;
revoke all on function public.record_host_payout(uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid, uuid) from public, anon;
revoke all on function public.void_host_payout(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.record_staff_advance(uuid, uuid, numeric, date, text, uuid, uuid) to authenticated;
grant execute on function public.void_staff_advance(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.record_host_payout_multi(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, text, text, text, bigint, uuid, uuid) to authenticated;
grant execute on function public.record_host_payout(uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid, uuid) to authenticated;
grant execute on function public.void_host_payout(uuid, uuid, text, uuid) to authenticated;

revoke all on function public.record_supplier_invoice(uuid, uuid, uuid, uuid, text, date, date, jsonb, text, boolean, text, uuid) from public, anon;
revoke all on function public.void_supplier_invoice(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.record_supplier_payment(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, uuid, uuid) from public, anon;
revoke all on function public.void_supplier_payment(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.record_supplier_invoice(uuid, uuid, uuid, uuid, text, date, date, jsonb, text, boolean, text, uuid) to authenticated;
grant execute on function public.void_supplier_invoice(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.record_supplier_payment(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.void_supplier_payment(uuid, uuid, text, uuid) to authenticated;
