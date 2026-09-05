-- ============================================================================
-- 0087 — Customer / invoice / revenue posting lifecycle (A2, completion)
--
-- Completes the customer-side accounting model end-to-end. Re-points the
-- authoritative operational commands so the accounting consequence is posted in
-- the SAME transaction as the operational mutation. Atomic: if the journal
-- fails, the operational command fails too — there are no half-accounted states.
--
--   * create_event_invoice
--       pre-CLOSED  -> Dr AR 1100 [net + remaining VAT]
--                      Cr Deferred 2100 [full net]
--                      Cr VAT Payable 2150 [remaining VAT]
--                      then deposit allocation: customer deposits consumed
--                      against the invoice (Dr Deposits / Cr AR, net only)
--       post-CLOSED -> Dr AR 1100 / Cr Unbilled 1120 (Contract Asset
--                      reclassification; NO new revenue, NO new VAT)
--   * void_invoice    -> reverses the authoritative invoice + allocation
--                        journals via reverse_journal_entry, restoring AR,
--                        Deferred/VAT or Unbilled and freeing the deposits.
--   * transition_event_status -> at CLOSED: revenue recognition exactly once.
--       CLIASED with invoice : Dr Deferred 2100 / Cr Revenue 4000 (net only)
--       CLOSED without invoice: Option B Contract Asset 1120
--                              Dr Deposits 2000 [net] + Dr Unbilled [gross]
--                              Cr Revenue 4000 [net] + Cr VAT Payable [VAT]
--   * void_customer_payment -> rejects voiding a payment already allocated to
--                              an invoice (operator must void the invoice first).
--
-- Contract: docs/research/accounting-posting-contract.md §5, §15, §16, §22.
-- VAT uses the frozen quotation/invoice snapshot (never mutable config).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Allocation of pre-invoice customer deposits to an invoice. One row per
-- payment applied. This is the authoritative record used to consume deposits at
-- invoice time and restore them at invoice void, and to reject payment-voids of
-- already-allocated deposits. NOT a second money source — payments/invoices
-- remain the operational truth; this tracks the accounting allocation.
-- ---------------------------------------------------------------------------
create table public.customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  event_id uuid not null,
  gross_amount numeric(14,3) not null check (gross_amount > 0),
  net_amount numeric(14,3) not null check (net_amount >= 0),
  vat_amount numeric(14,3) not null default 0 check (vat_amount >= 0),
  allocated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint customer_payment_allocations_org_id_unique unique (organization_id, id),
  constraint customer_payment_allocations_org_payment_unique
    unique (organization_id, payment_id, invoice_id),
  constraint customer_payment_allocations_payment_fk
    foreign key (organization_id, payment_id)
    references public.customer_payments(organization_id, id) on delete restrict,
  constraint customer_payment_allocations_invoice_fk
    foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete restrict,
  constraint customer_payment_allocations_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint customer_payment_allocations_split check (
    net_amount + vat_amount = gross_amount
  )
);

create index customer_payment_allocations_payment_idx
  on public.customer_payment_allocations (organization_id, payment_id);
create index customer_payment_allocations_invoice_idx
  on public.customer_payment_allocations (organization_id, invoice_id);
create index customer_payment_allocations_event_idx
  on public.customer_payment_allocations (organization_id, event_id);

alter table public.customer_payment_allocations enable row level security;
revoke all on table public.customer_payment_allocations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (never client-exposed).
-- ---------------------------------------------------------------------------

-- System account id by org + code (idempotently seeded).
create or replace function public._chart_id(p_org_id uuid, p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.chart_of_accounts
   where organization_id = p_org_id and code = p_code;
$$;

-- Net (credit-normal) balance of a given chart account scoped to one event.
create or replace function public._event_account_balance(
  p_org_id uuid,
  p_event_id uuid,
  p_account_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.credit) - sum(l.debit), 0)
    from public.journal_lines l
    join public.journal_entries e on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org_id
     and l.account_id = p_account_id
     and e.organization_id = p_org_id
     and e.event_id = p_event_id;
$$;

-- Gross customer payment remaining (unallocated) for one event.
create or replace function public._event_unallocated_deposits_gross(
  p_org_id uuid,
  p_event_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
  v_alloc numeric;
begin
  select coalesce(sum(p.amount), 0) into v_paid
    from public.customer_payments p
   where p.organization_id = p_org_id
     and p.event_id = p_event_id
     and p.status = 'RECORDED';
  select coalesce(sum(a.gross_amount), 0) into v_alloc
    from public.customer_payment_allocations a
   where a.organization_id = p_org_id and a.event_id = p_event_id;
  return greatest(v_paid - v_alloc, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_event_invoice — re-pointed with posting.
-- Signature unchanged (in-place CREATE OR REPLACE): p_invoice_number, due_at,
-- total_amount, installments, note, idempotency_key.
-- ---------------------------------------------------------------------------
create or replace function public.create_event_invoice(
  p_org_id uuid,
  p_event_id uuid,
  p_invoice_number text,
  p_due_at timestamptz,
  p_total_amount numeric,
  p_installments jsonb,
  p_note text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_invoice public.invoices;
  v_existing integer;
  v_sum numeric(14,3) := 0;
  v_item jsonb;
  v_kind text;
  v_due date;
  v_prev_due date;
  v_amount numeric(14,3);
  v_len integer;
  v_seq integer;
  v_quote_total numeric(14,3);
  v_pre_vat_total numeric(14,3);
  v_vat_registered boolean;
  v_vat_percent numeric(12,3);
  v_vat_amount numeric(14,3);
  v_vat_reg text;
  v_fingerprint text;
  v_replay jsonb;

  -- accounting
  v_is_closed boolean;
  v_has_invoice boolean;
  v_alloc_gross numeric(14,3) := 0;
  v_alloc_net numeric(14,3) := 0;
  v_alloc_vat numeric(14,3) := 0;
  v_remaining_gross numeric(14,3);
  v_remaining_vat numeric(14,3);
  v_ar_amount numeric(14,3);
  v_id_ar uuid;
  v_id_def uuid;
  v_id_vat uuid;
  v_id_unbilled uuid;
  v_id_dep uuid;
  v_id_rev uuid;
  v_pay record;
  v_take_gross numeric(14,3);
  v_take_vat numeric(14,3);
  v_take_net numeric(14,3);
  v_alloc_avail numeric(14,3);
  v_lines jsonb;
  v_dup_key uuid;
  v_alloc_key uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'invoice.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_total_amount);
  if nullif(trim(coalesce(p_invoice_number, '')), '') is null then
    raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) < 2 then
    raise exception 'INVOICE_INSTALLMENTS_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_EVENT_INVOICE',
    'event_id', p_event_id,
    'invoice_number', trim(p_invoice_number),
    'due_at', p_due_at,
    'total_amount', p_total_amount::text,
    'installments', p_installments,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_event_id::text, 1)
  );

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_CANCELLED';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;

  select q.total_selling::numeric(14,3),
         q.pre_vat_total::numeric(14,3),
         coalesce(q.vat_registered, false),
         coalesce(q.vat_percent, 0),
         coalesce(q.vat_amount, 0),
         q.vat_registration_number
    into v_quote_total, v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg
    from public.quotations q
   where q.organization_id = p_org_id
     and q.id = v_event.accepted_quotation_id
     and q.status in ('ACCEPTED','CONVERTED');
  if not found then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if v_quote_total <> p_total_amount then
    raise exception 'INVOICE_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  -- Derive net/VAT from the frozen snapshot. For non-VAT orgs (the historical
  -- default, before 0077 backfill or in legacy fixtures) pre_vat_total is 0
  -- and the full total is the net consideration. For VAT orgs, the snapshot
  -- carries the true net + VAT split; derive from the gross total so the split
  -- is always internally consistent with the tax point at issuance.
  if coalesce(v_vat_registered, false) then
    if v_pre_vat_total is null or v_pre_vat_total <= 0 then
      v_pre_vat_total := round(p_total_amount / (1 + coalesce(v_vat_percent, 0) / 100), 3);
    end if;
    if v_vat_amount is null or v_vat_amount <= 0 then
      v_vat_amount := round(p_total_amount * coalesce(v_vat_percent, 0) / (100 + coalesce(v_vat_percent, 0)), 3);
    end if;
  else
    -- Non-VAT: gross = net, no VAT liability.
    v_pre_vat_total := coalesce(p_total_amount, v_quote_total);
    v_vat_amount := 0;
    v_vat_percent := 0;
  end if;

  select count(*) into v_existing
    from public.invoices
   where organization_id = p_org_id
     and event_id = p_event_id
     and status = 'ISSUED';
  if v_existing > 0 then
    raise exception 'INVOICE_ALREADY_EXISTS' using errcode = '23505';
  end if;

  -- installments validation (unchanged)
  v_len := jsonb_array_length(p_installments);
  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    if v_item ->> 'seq' is null then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;
    v_seq := (v_item ->> 'seq')::integer;
    if v_seq <> i then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;

    v_kind := v_item ->> 'kind';
    if (i = 0 and v_kind <> 'DEPOSIT')
       or (i = v_len - 1 and v_kind <> 'FINAL')
       or (i > 0 and i < v_len - 1 and v_kind <> 'INSTALLMENT') then
      raise exception 'INVALID_INSTALLMENT_KIND' using errcode = '22023';
    end if;

    if v_item ->> 'due_date' is null then
      raise exception 'INSTALLMENT_DUE_DATE_REQUIRED' using errcode = '22023';
    end if;
    v_due := (v_item ->> 'due_date')::date;
    if v_prev_due is not null and v_due < v_prev_due then
      raise exception 'INSTALLMENT_DATES_OUT_OF_ORDER' using errcode = '22023';
    end if;
    v_prev_due := v_due;

    if v_item ->> 'amount' is null then
      raise exception 'INVALID_INSTALLMENT_AMOUNT' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amount')::numeric;
    perform public.assert_wage_rate(v_amount);
    v_sum := v_sum + v_amount;
  end loop;

  if v_sum <> p_total_amount then
    raise exception 'INSTALLMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.invoices (
    organization_id, event_id, quotation_id, invoice_number, due_at,
    total_amount, pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number,
    note, created_by
  ) values (
    p_org_id, p_event_id, v_event.accepted_quotation_id,
    trim(p_invoice_number), p_due_at, p_total_amount,
    v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  ) returning * into v_invoice;

  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    insert into public.invoice_installments (
      organization_id, invoice_id, seq, kind, due_date, amount
    ) values (
      p_org_id, v_invoice.id, (v_item ->> 'seq')::integer,
      (v_item ->> 'kind')::public.invoice_installment_kind,
      (v_item ->> 'due_date')::date, (v_item ->> 'amount')::numeric(14,3)
    );
  end loop;

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  v_id_ar        := public._chart_id(p_org_id, '1100');
  v_id_def       := public._chart_id(p_org_id, '2100');
  v_id_vat       := public._chart_id(p_org_id, '2150');
  v_id_unbilled  := public._chart_id(p_org_id, '1120');
  v_id_dep       := public._chart_id(p_org_id, '2000');
  v_id_rev       := public._chart_id(p_org_id, '4000');
  v_is_closed    := (v_event.status = 'CLOSED');

  if v_is_closed then
    -- Contract Asset reclassification: earned-but-unbilled becomes AR.
    -- NO revenue recognition, NO new VAT (already recognized at CLOSED).
    v_remaining_gross := greatest(
      coalesce((select sum(l.debit) - sum(l.credit) from public.journal_lines l
                join public.journal_entries e on e.organization_id=l.organization_id and e.id=l.entry_id
                where l.organization_id=p_org_id and l.account_id=v_id_unbilled
                  and e.organization_id=p_org_id and e.event_id=p_event_id), 0),
      0
    );
    if v_remaining_gross > 0 then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_id_ar::text, 'debit', v_remaining_gross, 'credit', 0,
          'line_memo', 'Invoice against contract asset: ' || trim(p_invoice_number)),
        jsonb_build_object('account_id', v_id_unbilled::text, 'debit', 0, 'credit', v_remaining_gross,
          'line_memo', 'Contract asset reclassified to accounts receivable')
      );
      perform public.internal_post_journal(
        p_org_id, current_date, 'CONTRACT_ASSET_RECLASSIFICATION', v_invoice.id,
        v_lines, p_idempotency_key, public.warehouse_fingerprint(jsonb_build_object(
          'command', 'CREATE_EVENT_INVOICE', 'event', p_event_id, 'invoice', v_invoice.id,
          'reclass', true, 'amount', v_remaining_gross::text
        )),
        'Invoice ' || trim(p_invoice_number) || ' (post-close reclassification)',
        now(), p_event_id, null, false
      );
    end if;
  else
    -- Pre-CLOSED invoice: consume deposits, then post the remaining AR.
    -- VAT source is the frozen quotation snapshot.
    v_remaining_gross := public._event_unallocated_deposits_gross(p_org_id, p_event_id);
    v_remaining_gross := greatest(v_remaining_gross, 0);

    v_alloc_gross := 0;
    v_alloc_net := 0;
    v_alloc_vat := 0;

    if v_remaining_gross > 0 then
      for v_pay in
        select p.id, p.amount, p.paid_at
          from public.customer_payments p
         where p.organization_id = p_org_id
           and p.event_id = p_event_id
           and p.status = 'RECORDED'
           and not exists (
             select 1 from public.customer_payment_allocations a
              where a.organization_id = p_org_id and a.payment_id = p.id
           )
         order by p.paid_at, p.id
      loop
        if v_remaining_gross <= 0 then exit; end if;
        v_alloc_avail := v_pay.amount -
          coalesce((select sum(a.gross_amount) from public.customer_payment_allocations a
                     where a.organization_id = p_org_id and a.payment_id = v_pay.id), 0);
        if v_alloc_avail <= 0 then continue; end if;
        v_take_gross := least(v_alloc_avail, v_remaining_gross);
        if v_vat_registered and v_vat_percent > 0 then
          v_take_vat := round(v_take_gross * v_vat_percent / (100 + v_vat_percent), 3);
        else
          v_take_vat := 0;
        end if;
        v_take_net := v_take_gross - v_take_vat;

        insert into public.customer_payment_allocations (
          organization_id, payment_id, invoice_id, event_id,
          gross_amount, net_amount, vat_amount, allocated_by
        ) values (
          p_org_id, v_pay.id, v_invoice.id, p_event_id,
          v_take_gross, v_take_net, v_take_vat, auth.uid()
        );

        v_remaining_gross := v_remaining_gross - v_take_gross;
        v_alloc_gross := v_alloc_gross + v_take_gross;
        v_alloc_net := v_alloc_net + v_take_net;
        v_alloc_vat := v_alloc_vat + v_take_vat;
      end loop;
    end if;

    -- Remaining VAT due on the invoice after deposits (never duplicate).
    v_remaining_vat := greatest(v_vat_amount - v_alloc_vat, 0);
    -- AR created by the invoice = full net + remaining VAT.
    v_ar_amount := v_pre_vat_total + v_remaining_vat;

    -- INVOICE journal (Dr AR / Cr Deferred net / Cr VAT remaining).
    v_dup_key := md5(p_idempotency_key::text || ':invoice')::uuid;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_id_ar::text, 'debit', v_ar_amount, 'credit', 0,
        'line_memo', 'Invoice ' || trim(p_invoice_number) || ' gross receivable'),
      jsonb_build_object('account_id', v_id_def::text, 'debit', 0, 'credit', v_pre_vat_total,
        'line_memo', 'Deferred revenue (net)')
    );
    if v_remaining_vat > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_id_vat::text, 'debit', 0, 'credit', v_remaining_vat,
        'line_memo', 'Remaining output VAT on invoice');
    end if;
    perform public.internal_post_journal(
      p_org_id, current_date, 'INVOICE', v_invoice.id, v_lines,
      v_dup_key, public.warehouse_fingerprint(jsonb_build_object(
        'command', 'CREATE_EVENT_INVOICE', 'event', p_event_id, 'invoice', v_invoice.id,
        'total', p_total_amount::text, 'net', v_pre_vat_total::text, 'remaining_vat', v_remaining_vat::text
      )),
      'Invoice ' || trim(p_invoice_number) || ' issued',
      now(), p_event_id, null, false
    );

    -- Deposit allocation journal (Dr Deposits net / Cr AR net). VAT stays in
    -- VAT Payable already recognized at receipt — never duplicated.
    if v_alloc_net > 0 then
      v_alloc_key := md5(p_idempotency_key::text || ':alloc')::uuid;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_id_dep::text, 'debit', v_alloc_net, 'credit', 0,
          'line_memo', 'Customer deposit applied to invoice ' || trim(p_invoice_number)),
        jsonb_build_object('account_id', v_id_ar::text, 'debit', 0, 'credit', v_alloc_net,
          'line_memo', 'Deposit settlement of accounts receivable')
      );
      perform public.internal_post_journal(
        p_org_id, current_date, 'CUSTOMER_DEPOSIT_APPLIED', v_invoice.id, v_lines,
        v_alloc_key, public.warehouse_fingerprint(jsonb_build_object(
          'command', 'CREATE_EVENT_INVOICE', 'event', p_event_id, 'invoice', v_invoice.id,
          'alloc', true, 'net', v_alloc_net::text
        )),
        'Deposit allocation for invoice ' || trim(p_invoice_number),
        now(), p_event_id, null, false
      );
    end if;
  end if;
  -- ======================= END LEDGER POSTING =======================

  perform public.record_audit(
    p_org_id, 'INVOICE_ISSUED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'invoice_number', trim(p_invoice_number),
      'total_amount', p_total_amount::text,
      'pre_vat_total', v_pre_vat_total::text,
      'vat_amount', v_vat_amount::text
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CREATE_EVENT_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: post the one authoritative revenue recognition journal set for an
-- event transitioning to CLOSED. Idempotent — skips when already recognized so
-- a replay of the transition never duplicates posting.
-- ---------------------------------------------------------------------------
create or replace function public._post_close_revenue(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_has_invoice boolean;
  v_invoice_id uuid;
  v_id_def uuid;
  v_id_rev uuid;
  v_id_vat uuid;
  v_id_unbilled uuid;
  v_id_dep uuid;
  v_deferred numeric(14,3);
  v_q_net numeric(14,3);
  v_q_vat numeric(14,3);
  v_q_gross numeric(14,3);
  v_q_percent numeric(12,3);
  v_dep_net numeric(14,3);
  v_dep_vat numeric(14,3);
  v_dep_gross numeric(14,3);
  v_rem_gross numeric(14,3);
  v_rem_net numeric(14,3);
  v_rem_vat numeric(14,3);
  v_lines jsonb;
  v_key uuid;
  v_source_id uuid;
begin
  select * into v_event from public.events
   where organization_id = p_org_id and id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- No accepted quotation => no commercial basis to recognize; close freely.
  if v_event.accepted_quotation_id is null then
    return;
  end if;

  select i.id into v_invoice_id
    from public.invoices i
   where i.organization_id = p_org_id and i.event_id = p_event_id
     and i.status = 'ISSUED'
   order by i.issued_at, i.id
   limit 1;
  v_has_invoice := found;

  perform public.ensure_system_chart(p_org_id);
  v_id_def := public._chart_id(p_org_id, '2100');
  v_id_rev := public._chart_id(p_org_id, '4000');
  v_id_vat := public._chart_id(p_org_id, '2150');
  v_id_unbilled := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');

  if v_has_invoice then
    -- Deferred -> Revenue (net only; VAT already in VAT Payable).
    v_source_id := v_invoice_id;
    v_deferred := greatest(public._event_account_balance(p_org_id, p_event_id, v_id_def), 0);
    if v_deferred <= 0 then
      -- Already recognized (or fully collected/deferred settled) — idempotent.
      return;
    end if;
    v_key := md5(p_org_id::text || ':' || p_event_id::text || ':closed:invoiced')::uuid;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_id_def::text, 'debit', v_deferred, 'credit', 0,
        'line_memo', 'Revenue recognition at close'),
      jsonb_build_object('account_id', v_id_rev::text, 'debit', 0, 'credit', v_deferred,
        'line_memo', 'Recognized event revenue (net)')
    );
    perform public.internal_post_journal(
      p_org_id, current_date, 'REVENUE_RECOGNITION', v_source_id, v_lines,
      v_key, public.warehouse_fingerprint(jsonb_build_object(
        'command', 'CLOSE_REVENUE', 'event', p_event_id, 'invoice', v_invoice_id,
        'deferred', v_deferred::text
      )),
      'Revenue recognition on close', now(), p_event_id, null, false
    );
  else
    -- Option B: Contract Asset / Unbilled Receivable. Consume deposits already
    -- recognized at receipt into revenue, then recognize remaining as unbilled
    -- (gross) with the VAT split from the frozen quotation snapshot.
    v_source_id := p_event_id;
    select q.pre_vat_total::numeric(14,3),
           q.vat_amount::numeric(14,3),
           q.total_selling::numeric(14,3),
           coalesce(q.vat_percent, 0)
      into v_q_net, v_q_vat, v_q_gross, v_q_percent
      from public.quotations q
     where q.organization_id = p_org_id and q.id = v_event.accepted_quotation_id;
    if not found then
      raise exception 'QUOTATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- Already recognized (find an existing UNBILLED_RECOGNITION for the event).
    if exists (select 1 from public.journal_entries e
                where e.organization_id = p_org_id and e.event_id = p_event_id
                  and e.source_type = 'UNBILLED_RECOGNITION' and not e.is_reversal) then
      return;
    end if;

    -- Deposits are held NET on account 2000 for VAT orgs (gross for non-VAT).
    v_dep_net := greatest(public._event_account_balance(p_org_id, p_event_id, v_id_dep), 0);
    if v_q_percent > 0 then
      v_dep_vat := round(v_dep_net * v_q_percent / 100, 3);
    else
      v_dep_vat := 0;
    end if;
    v_dep_gross := v_dep_net + v_dep_vat;

    v_rem_gross := greatest(v_q_gross - v_dep_gross, 0);
    v_rem_net := greatest(v_q_net - v_dep_net, 0);
    v_rem_vat := greatest(v_q_vat - v_dep_vat, 0);

    v_key := md5(p_org_id::text || ':' || p_event_id::text || ':closed:unbilled')::uuid;
    v_lines := '[]'::jsonb;
    if v_dep_net > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_id_dep::text, 'debit', v_dep_net, 'credit', 0,
        'line_memo', 'Deposit applied to recognized revenue at close');
    end if;
    if v_rem_gross > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_id_unbilled::text, 'debit', v_rem_gross, 'credit', 0,
        'line_memo', 'Contract asset: earned but unbilled');
    end if;
    -- Revenue = total net (deposits portion + remaining net portion).
    if v_q_net > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_id_rev::text, 'debit', 0, 'credit', v_q_net,
        'line_memo', 'Recognized event revenue at close (net)');
    end if;
    if v_rem_vat > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_id_vat::text, 'debit', 0, 'credit', v_rem_vat,
        'line_memo', 'Output VAT on unbilled recognition');
    end if;

    -- At least two non-zero lines required; the asset (deposits and/or unbilled)
    -- always balances against revenue (+ VAT). If nothing to post, return.
    if jsonb_array_length(v_lines) >= 2 then
      perform public.internal_post_journal(
        p_org_id, current_date, 'UNBILLED_RECOGNITION', v_source_id, v_lines,
        v_key, public.warehouse_fingerprint(jsonb_build_object(
          'command', 'CLOSE_REVENUE', 'event', p_event_id,
          'gross', v_q_gross::text, 'net', v_q_net::text, 'vat', v_q_vat::text
        )),
        'Unbilled revenue recognition on close', now(), p_event_id, null, false
      );
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_event_status — re-pointed so CLOSED performs exact-once revenue
-- recognition within the authoritative transition command. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.transition_event_status(
  p_org_id uuid,
  p_event_id uuid,
  p_to public.event_status,
  p_reason text default null,
  p_override_reason text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_allowed boolean;
  v_from public.event_status;
  v_out numeric;
  v_readiness_status text;
begin
  if not public.has_permission(p_org_id, 'event.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  select * into v from public.events where organization_id=p_org_id and id=p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_to='CANCELLED' then raise exception 'USE_CANCEL_EVENT'; end if;

  v_from := v.status;
  v_allowed := (v.status,p_to) in (('CONFIRMED','PREPARING'),('PREPARING','DISPATCHED'),('DISPATCHED','IN_PROGRESS'),('IN_PROGRESS','RETURNING'),('RETURNING','CLOSED'));
  if not v_allowed then raise exception 'INVALID_EVENT_TRANSITION: % -> %', v.status, p_to; end if;

  if p_to = 'CLOSED' then
    v_out := coalesce((public.event_warehouse_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE'; end if;
    v_out := coalesce((public.event_consumable_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE'; end if;
  end if;

  -- Readiness gate: dispatching with missing resources requires an explicit,
  -- audited override. Readiness is derived (staff/equipment), never a status.
  if p_to = 'DISPATCHED' then
    v_readiness_status := coalesce(public.event_readiness(p_org_id, p_event_id)->>'status', 'READY');
    if v_readiness_status <> 'READY' and nullif(trim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'READINESS_OVERRIDE_REQUIRED' using errcode = '23514';
    end if;
  end if;

  update public.events set status=p_to, updated_by=auth.uid() where id=v.id returning * into v;
  insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.id,v_from,p_to,auth.uid(),p_reason);

  -- Revenue recognition exactly once, within the same transaction.
  if p_to = 'CLOSED' then
    perform public._post_close_revenue(p_org_id, v.id);
  end if;

  if p_to = 'DISPATCHED' and nullif(trim(coalesce(p_override_reason, '')), '') is not null then
    insert into public.event_transition_overrides(organization_id,event_id,from_status,to_status,reason,actor_id)
    values(p_org_id, v.id, v_from, p_to, trim(p_override_reason), auth.uid());
    perform public.record_audit(p_org_id, 'EVENT_TRANSITION_OVERRIDDEN', 'event', v.id::text,
      jsonb_build_object('from', v_from::text, 'to', p_to::text, 'reason', trim(p_override_reason)));
  end if;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_invoice — re-pointed to reverse the authoritative invoice + allocation
-- journals and free the customer deposits. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(
  p_org_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_fingerprint text;
  v_replay jsonb;
  v_entry public.journal_entries;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'invoice.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_INVOICE',
    'invoice_id', p_invoice_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
  end if;

  select * into v_invoice
    from public.invoices
   where organization_id = p_org_id and id = p_invoice_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'CANCELLED' then
    raise exception 'INVOICE_ALREADY_CANCELLED';
  end if;

  -- Reverse deposit allocations first: restore the deposits (Dr AR / Cr
  -- Deposits via reversal primitive), freeing the cash the customer had
  -- committed against this invoice. This must precede reversing the invoice.
  select * into v_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'CUSTOMER_DEPOSIT_APPLIED'
     and e.source_id = v_invoice.id
     and not e.is_reversal
     and exists (select 1 from public.journal_lines l
                  where l.entry_id = e.id
                    and l.account_id = public._chart_id(p_org_id, '2000'))
   order by e.created_at, e.id
   limit 1;
  if found then
    -- One allocation journal per invoice; reverse it once.
    perform public.reverse_journal_entry(
      p_org_id, v_entry.id, 'Void of invoice ' || v_invoice.invoice_number || ': ' || trim(p_reason),
      md5(p_idempotency_key::text || ':alloc-rev')::uuid
    );
  end if;

  -- Reverse the authoritative invoice journal (INVOICE or reclassification).
  select * into v_entry
    from public.journal_entries
   where organization_id = p_org_id
     and source_id = v_invoice.id
     and source_type in ('INVOICE', 'CONTRACT_ASSET_RECLASSIFICATION')
     and not is_reversal
   order by created_at, id
   limit 1;
  if found then
    perform public.reverse_journal_entry(
      p_org_id, v_entry.id, 'Void of invoice ' || v_invoice.invoice_number || ': ' || trim(p_reason),
      md5(p_idempotency_key::text || ':invoice-rev')::uuid
    );
  end if;

  -- Remove allocation records (deposits are free again; audit trail is in the
  -- reversal journal, not a phantom allocation row).
  delete from public.customer_payment_allocations
   where organization_id = p_org_id and invoice_id = p_invoice_id;

  update public.invoice_installments
     set status = 'CANCELLED'
   where organization_id = p_org_id
     and invoice_id = p_invoice_id
     and status = 'PENDING';
  update public.invoices
     set status = 'CANCELLED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_invoice_id
   returning * into v_invoice;

  perform public.record_audit(
    p_org_id, 'INVOICE_CANCELLED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_customer_payment — re-pointed to reject voiding a deposit already
-- allocated to an invoice (operator must void the invoice first); the invoice
-- void restores the deposit, then the payment void can proceed. Signature
-- unchanged (in-place CREATE OR REPLACE).
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
  v_allocated numeric;
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

  -- Voiding a payment that has been consumed by an invoice would corrupt the
  -- allocation (AR/deposits). Reject deterministically; operator must void the
  -- invoice first (which frees the deposit), then void the payment.
  select coalesce(sum(a.gross_amount), 0) into v_allocated
    from public.customer_payment_allocations a
   where a.organization_id = p_org_id and a.payment_id = p_payment_id;
  if v_allocated > 0 then
    raise exception 'PAYMENT_ALLOCATED_TO_INVOICE' using errcode = '23514';
  end if;

  update public.customer_payments
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payment_id
   returning * into v_payment;

  -- Reversal of the original payment journal, if present.
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
-- Privileges.
-- ---------------------------------------------------------------------------
revoke all on function public._chart_id(uuid, text) from public, anon, authenticated;
revoke all on function public._event_account_balance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._event_unallocated_deposits_gross(uuid, uuid) from public, anon, authenticated;
revoke all on function public._post_close_revenue(uuid, uuid) from public, anon, authenticated;
revoke all on table public.customer_payment_allocations from anon, authenticated;

-- create_or_replace preserves existing grants on the re-pointed RPCs, so the
-- capability-appropriate grants from 0079 remain authoritative.
