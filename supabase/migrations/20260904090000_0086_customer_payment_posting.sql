-- ============================================================================
-- 0086 — Customer payment → ledger posting (A2, payments)
--
-- Re-points the customer-payment commands so every recorded (or voided) payment
-- ALSO posts its accounting consequence within the same transaction:
--
--   * record_customer_payment
--       pre-invoice  -> Dr Treasury / Cr Customer Deposits (+ Cr VAT Payable)
--       post-invoice -> Dr Treasury / Cr Accounts Receivable (VAT already due)
--   * void_customer_payment -> CUSTOMER_PAYMENT_VOID reversal of the original
--
-- Contract: docs/research/accounting-posting-contract.md §5, §15, §22.
--   * VAT split at receipt uses the accepted quotation snapshot:
--        VAT = round(gross * vat_percent / (100 + vat_percent), 3); net = gross - VAT.
--   * Treasury attribution is optional; when omitted the system CASH account is
--     used so the pre-existing operational suite keeps working. The chart is
--     seeded deterministically before posting.
--   * Backward compatible: return type and idempotency semantics are unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: resolve the chart account that a payment lands in.
-- ---------------------------------------------------------------------------
create or replace function public._resolve_treasury_chart(p_org_id uuid, p_treasury_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chart uuid;
begin
  if p_treasury_id is not null then
    select chart_account_id into v_chart from public.treasury_accounts
     where organization_id = p_org_id and id = p_treasury_id and is_active = true;
    if v_chart is null then
      raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
    end if;
    return v_chart;
  end if;
  -- Fallback: first active CASH treasury, else the system Cash parent (1000).
  select chart_account_id into v_chart from public.treasury_accounts
   where organization_id = p_org_id and is_active = true and treasury_type = 'CASH'
   order by created_at, id
   limit 1;
  return coalesce(v_chart, (select id from public.chart_of_accounts
                            where organization_id = p_org_id and code = '1000'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: VAT split of a gross customer amount from the quotation snapshot.
-- Returns a single row (net, vat, vat_registered, vat_percent).
-- ---------------------------------------------------------------------------
create or replace function public._customer_gross_vat(
  p_org_id uuid,
  p_event_id uuid,
  p_gross numeric
)
returns table (net numeric, vat numeric, vat_registered boolean, vat_percent numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reg boolean;
  v_percent numeric(12,3);
  v_qid uuid;
  v_vat numeric;
  v_net numeric;
begin
  select accepted_quotation_id into v_qid from public.events
   where organization_id = p_org_id and id = p_event_id;
  if v_qid is null then
    raise exception 'QUOTATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(q.vat_registered, false), coalesce(q.vat_percent, 0)
    into v_reg, v_percent
    from public.quotations q where q.organization_id = p_org_id and q.id = v_qid;

  v_net := p_gross;
  v_vat := 0;
  if v_reg and v_percent > 0 then
    v_vat := round(p_gross * v_percent / (100 + v_percent), 3);
    v_net := p_gross - v_vat;
  end if;
  return query select v_net, v_vat, v_reg, v_percent;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_customer_payment — enhanced with treasury attribution + posting.
-- The new signature adds an optional 8th (treasury) parameter; the old 7-arg
-- implementation is dropped so existing 7-arg callers route to this version
-- (using the default system treasury) rather than a stale non-posting copy.
-- ---------------------------------------------------------------------------
drop function if exists public.record_customer_payment(
  uuid, uuid, numeric, public.payment_method, text, text, timestamptz, uuid
);
create or replace function public.record_customer_payment(
  p_org_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_reference text,
  p_notes text,
  p_paid_at timestamptz,
  p_idempotency_key uuid,
  p_treasury_account_id uuid default null
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_event public.events;
  v_fingerprint text;
  v_replay jsonb;
  v_paid numeric;
  v_revenue numeric;
  v_treasury_chart uuid;
  v_net numeric;
  v_vat numeric;
  v_has_invoice boolean;
  v_deposits_acc uuid;
  v_ar_acc uuid;
  v_vat_acc uuid;
  v_line jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payment.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_CUSTOMER_PAYMENT',
    'event_id', p_event_id,
    'amount', p_amount::text,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'paid_at', p_paid_at,
    'treasury', p_treasury_account_id
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_NOT_PAYABLE';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'PAYMENT_REQUIRES_ACCEPTED_QUOTATION';
  end if;

  select total_selling into v_revenue
    from public.quotations
   where organization_id = p_org_id and id = v_event.accepted_quotation_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.customer_payments
   where organization_id = p_org_id and event_id = p_event_id and status = 'RECORDED';
  if v_paid + p_amount > v_revenue then
    raise exception 'OVERPAYMENT_EXCEEDS_ACCEPTED' using errcode = 'P0001';
  end if;

  insert into public.customer_payments (
    organization_id, event_id, amount, payment_method, reference, notes,
    paid_at, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_amount, p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(p_paid_at, now()), auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_payment;

  -- ---- Ledger posting (same transaction) ----
  perform public.ensure_system_chart(p_org_id);
  v_treasury_chart := public._resolve_treasury_chart(p_org_id, p_treasury_account_id);

  select net, vat into v_net, v_vat
    from public._customer_gross_vat(p_org_id, p_event_id, p_amount);

  select exists (select 1 from public.invoices
                  where organization_id = p_org_id and event_id = p_event_id
                    and status = 'ISSUED')
    into v_has_invoice;

  select id into v_deposits_acc from public.chart_of_accounts
   where organization_id = p_org_id and code = '2000';
  select id into v_ar_acc from public.chart_of_accounts
   where organization_id = p_org_id and code = '1100';
  select id into v_vat_acc from public.chart_of_accounts
   where organization_id = p_org_id and code = '2150';

  if v_has_invoice then
    -- Settlement of Accounts Receivable; VAT was already due at invoice/CLOSED.
    v_line := jsonb_build_array(
      jsonb_build_object('account_id', v_treasury_chart::text, 'debit', p_amount, 'credit', 0,
        'line_memo', 'Customer payment against invoice'),
      jsonb_build_object('account_id', v_ar_acc::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Settlement of accounts receivable')
    );
  else
    -- Pre-invoice payment is a customer deposit (VAT split at receipt).
    if v_vat > 0 then
      v_line := jsonb_build_array(
        jsonb_build_object('account_id', v_treasury_chart::text, 'debit', p_amount, 'credit', 0,
          'line_memo', 'Customer deposit received'),
        jsonb_build_object('account_id', v_deposits_acc::text, 'debit', 0, 'credit', v_net,
          'line_memo', 'Customer deposit (net)'),
        jsonb_build_object('account_id', v_vat_acc::text, 'debit', 0, 'credit', v_vat,
          'line_memo', 'Output VAT on deposit')
      );
    else
      v_line := jsonb_build_array(
        jsonb_build_object('account_id', v_treasury_chart::text, 'debit', p_amount, 'credit', 0,
          'line_memo', 'Customer deposit received'),
        jsonb_build_object('account_id', v_deposits_acc::text, 'debit', 0, 'credit', p_amount,
          'line_memo', 'Customer deposit')
      );
    end if;
  end if;

  perform public.internal_post_journal(
    p_org_id,
    (coalesce(p_paid_at, now())::date)::date,
    'CUSTOMER_PAYMENT',
    v_payment.id,
    v_line,
    p_idempotency_key,
    v_fingerprint,
    'Customer payment ' || p_payment_method::text || ': ' || coalesce(p_reference, 'n/a'),
    coalesce(p_paid_at, now()),
    v_event.id,
    null,
    false
  );

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_RECORDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'amount', p_amount::text,
      'payment_method', p_payment_method,
      'treasury_account_id', p_treasury_account_id
    )
  );

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_customer_payment — enhanced with CUSTOMER_PAYMENT_VOID reversal.
-- ---------------------------------------------------------------------------
create or replace function public.void_customer_payment(
  p_org_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_fingerprint text;
  v_replay jsonb;
  v_orig public.journal_entries;
  v_lines jsonb;
  v_line record;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'payment.void') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'PAYMENT_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_CUSTOMER_PAYMENT',
    'payment_id', p_payment_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_payment
    from public.customer_payments
   where organization_id = p_org_id and id = p_payment_id
   for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'PAYMENT_ALREADY_VOIDED';
  end if;

  update public.customer_payments
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payment_id
   returning * into v_payment;

  -- Build the reversal (swap debit/credit, flip to credit-normal semantics).
  select * into v_orig
    from public.journal_entries
   where organization_id = p_org_id and source_type = 'CUSTOMER_PAYMENT'
     and source_id = v_payment.id and is_reversal = false;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', l.account_id::text,
      'debit', case when l.credit > 0 then l.credit else 0 end,
      'credit', case when l.debit > 0 then l.debit else 0 end,
      'line_memo', 'Reversal of ' || v_orig.entry_number || ': ' || trim(p_reason)
    )), '[]'::jsonb) into v_lines
    from public.journal_lines l where l.entry_id = v_orig.id;

    perform public.internal_post_journal(
      p_org_id,
      v_orig.entry_date,
      'CUSTOMER_PAYMENT_VOID',
      v_payment.id,
      v_lines,
      p_idempotency_key,
      public.warehouse_fingerprint(jsonb_build_object(
        'command', 'VOID_CUSTOMER_PAYMENT', 'payment_id', p_payment_id, 'reason', trim(p_reason)
      )),
      'Void of ' || v_orig.entry_number || ': ' || trim(p_reason),
      v_orig.event_at,
      v_orig.event_id,
      v_orig.id,
      true
    );
  end if;

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_VOIDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', v_payment.event_id,
      'amount', v_payment.amount::text,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: internal helpers never client-exposed.
-- ---------------------------------------------------------------------------
revoke all on function public._resolve_treasury_chart(uuid, uuid) from public, anon, authenticated;
revoke all on function public._customer_gross_vat(uuid, uuid, numeric) from public, anon, authenticated;
