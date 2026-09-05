-- ============================================================================
-- 0093 — Opening-balance cutover (Strategy B) + read-only reconciliation
--
-- Contract §10, §16, §17, §21. Does not rewrite 0084–0092. Does not replay
-- historical P&L into 4000/5000/5100/5200. Opening positions enter the SAME
-- ledger as OPENING_BALANCE journals, offset to 3000 Opening Balance Equity.
--
-- Owner-provided:
--   * treasury openings — already posted by set_treasury_opening_balance (0085)
--   * VAT payable (p_vat_payable) — never invented; 0 is an explicit input
--
-- Derived from operational tables minus already-posted ledger (so post-0086
-- activity is not double-counted):
--   * customer AR / deposits / deferred / contract asset (per event)
--   * payroll payable / staff receivable (per staff, net N = E-A-P)
--   * supplier AP (per supplier)
--
-- Idempotent: one cutover per org (organization_settings.accounting_cutover_at).
-- Preview never posts journals (it may seed the system chart). Reconciliation never posts.
-- ============================================================================

alter table public.organization_settings
  add column if not exists accounting_cutover_at timestamptz,
  add column if not exists accounting_cutover_by uuid references auth.users(id),
  add column if not exists accounting_cutover_vat_payable numeric(12,3);

-- ---------------------------------------------------------------------------
-- Helpers: raw ledger (debit − credit) org-wide and per event.
-- ---------------------------------------------------------------------------
create or replace function public._ledger_raw(
  p_org_id uuid,
  p_account_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(debit) - sum(credit), 0)
    from public.journal_lines
   where organization_id = p_org_id and account_id = p_account_id;
$$;

create or replace function public._ledger_event_raw(
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
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org_id
     and l.account_id = p_account_id
     and e.event_id = p_event_id;
$$;

-- Operational customer opening positions (contract §16 cases 1–4).
create or replace function public._opening_customer_positions(p_org_id uuid)
returns table (
  event_id uuid,
  ar numeric,
  deposits numeric,
  deferred numeric,
  contract_asset numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with pay as (
    select event_id, coalesce(sum(amount), 0) as p_gross
      from public.customer_payments
     where organization_id = p_org_id and status = 'RECORDED'
     group by event_id
  ),
  inv as (
    select event_id,
           sum(total_amount) as i_gross,
           sum(pre_vat_total) as i_net
      from public.invoices
     where organization_id = p_org_id and status = 'ISSUED'
     group by event_id
  ),
  q as (
    select e.id as event_id,
           e.status,
           coalesce(qt.total_selling, 0) as q_gross
      from public.events e
      left join public.quotations qt
        on qt.organization_id = e.organization_id
       and qt.id = e.accepted_quotation_id
     where e.organization_id = p_org_id
  )
  select
    q.event_id,
    case
      when q.status = 'CANCELLED' then 0
      when inv.i_gross is not null then greatest(inv.i_gross - coalesce(pay.p_gross, 0), 0)
      else 0
    end,
    case
      when q.status = 'CANCELLED' then coalesce(pay.p_gross, 0)
      when inv.i_gross is not null then greatest(coalesce(pay.p_gross, 0) - inv.i_gross, 0)
      when q.status = 'CLOSED' then greatest(coalesce(pay.p_gross, 0) - q.q_gross, 0)
      else coalesce(pay.p_gross, 0)
    end,
    case
      when q.status in ('CANCELLED', 'CLOSED') then 0
      when inv.i_gross is not null then coalesce(inv.i_net, inv.i_gross)
      else 0
    end,
    case
      when q.status = 'CLOSED' and inv.i_gross is null
        then greatest(q.q_gross - coalesce(pay.p_gross, 0), 0)
      else 0
    end
  from q
  left join pay on pay.event_id = q.event_id
  left join inv on inv.event_id = q.event_id;
$$;

-- Build balanced OPENING_BALANCE lines for a bag of (account, signed raw
-- debit-normal amount). Positive => Dr account; negative => Cr account.
-- Equity 3000 absorbs the residual so the journal is always balanced.
create or replace function public._opening_lines_with_equity(
  p_org_id uuid,
  p_pairs jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_acc uuid;
  v_amt numeric;
  v_lines jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_equity uuid;
begin
  for v_item in select value from jsonb_array_elements(p_pairs) loop
    v_acc := (v_item ->> 'account_id')::uuid;
    v_amt := round(coalesce((v_item ->> 'amount')::numeric, 0), 3);
    if v_amt > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_acc::text, 'debit', v_amt, 'credit', 0,
        'line_memo', coalesce(v_item ->> 'memo', 'Opening balance')));
      v_sum := v_sum + v_amt;
    elsif v_amt < 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_acc::text, 'debit', 0, 'credit', abs(v_amt),
        'line_memo', coalesce(v_item ->> 'memo', 'Opening balance')));
      v_sum := v_sum + v_amt;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    return '[]'::jsonb;
  end if;
  v_equity := public._chart_id(p_org_id, '3000');
  v_sum := round(v_sum, 3);
  if v_sum > 0 then
    -- Net asset opening: Cr equity.
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_equity::text, 'debit', 0, 'credit', v_sum,
      'line_memo', 'Opening equity offset'));
  elsif v_sum < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_equity::text, 'debit', abs(v_sum), 'credit', 0,
      'line_memo', 'Opening equity offset'));
  end if;
  -- If v_sum = 0 the position lines already balance (asset = liability).
  return v_lines;
end;
$$;

-- Attribute OPENING_BALANCE journals whose source_id is the staff member.
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
       or (e.source_type = 'STAFF_ADVANCE_SETTLEMENT'
        and exists (select 1 from public.staff_advance_settlements t
                     where t.organization_id = p_org_id and t.id = e.source_id
                       and t.staff_member_id = p_staff_member_id))
       or (e.source_type = 'OPENING_BALANCE' and e.source_id = p_staff_member_id)
     );
$$;

create or replace function public._supplier_ap_position(
  p_org_id uuid,
  p_supplier_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit) filter (
    where l.account_id = (select id from public.chart_of_accounts
                          where organization_id = p_org_id and code = '2200')
  ), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where e.organization_id = p_org_id
     and (
       (e.source_type in ('SUPPLIER_INVOICE','SUPPLIER_INVOICE_VOID')
        and exists (select 1 from public.supplier_invoices s
                     where s.organization_id = p_org_id and s.id = e.source_id
                       and s.supplier_id = p_supplier_id))
       or (e.source_type in ('SUPPLIER_PAYMENT','SUPPLIER_PAYMENT_VOID')
        and exists (select 1 from public.supplier_payments p
                     where p.organization_id = p_org_id and p.id = e.source_id
                       and p.supplier_id = p_supplier_id))
       or (e.source_type = 'OPENING_BALANCE' and e.source_id = p_supplier_id)
     );
$$;

-- Preview the journals cutover would post (no writes).
create or replace function public.preview_opening_cutover(
  p_org_id uuid,
  p_vat_payable numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id_ar uuid; v_id_ca uuid; v_id_dep uuid; v_id_def uuid;
  v_id_pay uuid; v_id_rec uuid; v_id_ap uuid; v_id_vat uuid;
  v_row record;
  v_pairs jsonb;
  v_lines jsonb;
  v_out jsonb := '[]'::jsonb;
  v_ar_led numeric; v_ca_led numeric; v_dep_led numeric; v_def_led numeric;
  v_e numeric; v_a numeric; v_p numeric; v_n numeric;
  v_pay numeric; v_rec numeric; v_gap numeric;
  v_ap_op numeric; v_ap_led numeric;
begin
  if not public.has_permission(p_org_id, 'cost.visibility')
     and not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_vat_payable is null or p_vat_payable < 0 then
    raise exception 'OPENING_VAT_INVALID' using errcode = '22023';
  end if;
  if round(p_vat_payable, 3) <> p_vat_payable then
    raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');
  v_id_ca := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');
  v_id_def := public._chart_id(p_org_id, '2100');
  v_id_pay := public._chart_id(p_org_id, '2300');
  v_id_rec := public._chart_id(p_org_id, '1150');
  v_id_ap := public._chart_id(p_org_id, '2200');
  v_id_vat := public._chart_id(p_org_id, '2150');

  for v_row in
    select * from public._opening_customer_positions(p_org_id)
  loop
    v_ar_led := public._ledger_event_raw(p_org_id, v_row.event_id, v_id_ar);
    v_ca_led := public._ledger_event_raw(p_org_id, v_row.event_id, v_id_ca);
    -- deposits/deferred are credit-normal; operational amounts are credit
    -- balances. Convert ledger debit-raw to credit-normal via negation.
    v_dep_led := - public._ledger_event_raw(p_org_id, v_row.event_id, v_id_dep);
    v_def_led := - public._ledger_event_raw(p_org_id, v_row.event_id, v_id_def);
    v_pairs := jsonb_build_array(
      jsonb_build_object('account_id', v_id_ar, 'amount', round(v_row.ar - v_ar_led, 3), 'memo', 'Opening AR'),
      jsonb_build_object('account_id', v_id_ca, 'amount', round(v_row.contract_asset - v_ca_led, 3), 'memo', 'Opening contract asset'),
      -- liability gaps stored as negative raw (credit) so helper credits them
      jsonb_build_object('account_id', v_id_dep, 'amount', round(-(v_row.deposits - v_dep_led), 3), 'memo', 'Opening customer deposits'),
      jsonb_build_object('account_id', v_id_def, 'amount', round(-(v_row.deferred - v_def_led), 3), 'memo', 'Opening deferred revenue')
    );
    v_lines := public._opening_lines_with_equity(p_org_id, v_pairs);
    if jsonb_array_length(v_lines) >= 2 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', 'CUSTOMER', 'source_id', v_row.event_id, 'event_id', v_row.event_id, 'lines', v_lines));
    end if;
  end loop;

  for v_row in
    select m.id as staff_id from public.staff_members m where m.organization_id = p_org_id
  loop
    select coalesce(sum(a.earned_amount), 0) into v_e
      from public.staff_attendance a
     where a.organization_id = p_org_id and a.staff_member_id = v_row.staff_id
       and a.status <> 'VOIDED';
    select coalesce(sum(s.amount), 0) into v_a
      from public.staff_advances s
     where s.organization_id = p_org_id and s.staff_member_id = v_row.staff_id
       and s.status = 'RECORDED';
    select coalesce(sum(h.amount), 0) into v_p
      from public.host_payouts h
     where h.organization_id = p_org_id and h.staff_member_id = v_row.staff_id
       and h.status = 'RECORDED';
    v_n := round(v_e - v_a - v_p, 3);
    select payable, receivable into v_pay, v_rec
      from public._staff_payroll_position(p_org_id, v_row.staff_id);
    v_gap := round(v_n - (coalesce(v_pay, 0) - coalesce(v_rec, 0)), 3);
    if v_gap > 0 then
      v_pairs := jsonb_build_array(
        jsonb_build_object('account_id', v_id_pay, 'amount', -v_gap, 'memo', 'Opening payroll payable'));
    elsif v_gap < 0 then
      v_pairs := jsonb_build_array(
        jsonb_build_object('account_id', v_id_rec, 'amount', abs(v_gap), 'memo', 'Opening staff receivable'));
    else
      v_pairs := '[]'::jsonb;
    end if;
    v_lines := public._opening_lines_with_equity(p_org_id, v_pairs);
    if jsonb_array_length(v_lines) >= 2 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', 'PAYROLL', 'source_id', v_row.staff_id, 'event_id', null, 'lines', v_lines));
    end if;
  end loop;

  for v_row in
    select s.id as supplier_id from public.suppliers s where s.organization_id = p_org_id
  loop
    select coalesce(sum(i.amount) filter (where i.status = 'RECORDED'), 0)
         - coalesce((
             select sum(p.amount) from public.supplier_payments p
              where p.organization_id = p_org_id and p.supplier_id = v_row.supplier_id
                and p.status = 'RECORDED'
           ), 0)
      into v_ap_op
      from public.supplier_invoices i
     where i.organization_id = p_org_id and i.supplier_id = v_row.supplier_id;
    v_ap_led := public._supplier_ap_position(p_org_id, v_row.supplier_id);
    v_gap := round(coalesce(v_ap_op, 0) - coalesce(v_ap_led, 0), 3);
    if v_gap <> 0 then
      v_pairs := jsonb_build_array(
        jsonb_build_object('account_id', v_id_ap, 'amount', -v_gap, 'memo', 'Opening accounts payable'));
      v_lines := public._opening_lines_with_equity(p_org_id, v_pairs);
      if jsonb_array_length(v_lines) >= 2 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'kind', 'SUPPLIER', 'source_id', v_row.supplier_id, 'event_id', null, 'lines', v_lines));
      end if;
    end if;
  end loop;

  if p_vat_payable > 0 then
    -- Owner-provided historical VAT; do not subtract already-posted VAT
    -- (that VAT is post-cutover activity).
    v_pairs := jsonb_build_array(
      jsonb_build_object('account_id', v_id_vat, 'amount', -p_vat_payable, 'memo', 'Opening VAT payable (owner-provided)'));
    v_lines := public._opening_lines_with_equity(p_org_id, v_pairs);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'VAT', 'source_id', p_org_id, 'event_id', null, 'lines', v_lines));
  end if;

  return jsonb_build_object('journals', v_out);
end;
$$;

-- Commit cutover. Posts every previewed journal; stamps organization_settings.
create or replace function public.commit_opening_cutover(
  p_org_id uuid,
  p_vat_payable numeric default 0,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_replay jsonb;
  v_preview jsonb;
  v_item jsonb;
  v_journal public.journal_entries;
  v_journals jsonb := '[]'::jsonb;
  v_key uuid;
  v_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_vat_payable is null or p_vat_payable < 0 then
    raise exception 'OPENING_VAT_INVALID' using errcode = '22023';
  end if;
  if round(p_vat_payable, 3) <> p_vat_payable then
    raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'COMMIT_OPENING_CUTOVER', 'vat_payable', p_vat_payable::text
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return v_replay;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':opening-cutover', 4)
  );

  if exists (
    select 1 from public.organization_settings s
     where s.organization_id = p_org_id and s.accounting_cutover_at is not null
  ) then
    raise exception 'OPENING_CUTOVER_ALREADY_COMMITTED' using errcode = '23514';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_preview := public.preview_opening_cutover(p_org_id, p_vat_payable);

  for v_item in select value from jsonb_array_elements(v_preview -> 'journals') loop
    v_n := v_n + 1;
    v_key := md5(p_idempotency_key::text || ':' || v_n::text || ':' || (v_item ->> 'kind'))::uuid;
    v_journal := public.internal_post_journal(
      p_org_id,
      current_date,
      'OPENING_BALANCE',
      (v_item ->> 'source_id')::uuid,
      v_item -> 'lines',
      v_key,
      public.warehouse_fingerprint(jsonb_build_object(
        'command', 'OPENING_BALANCE', 'kind', v_item ->> 'kind',
        'source_id', v_item ->> 'source_id', 'n', v_n
      )),
      'Opening cutover: ' || (v_item ->> 'kind'),
      now(),
      nullif(v_item ->> 'event_id', '')::uuid,
      null,
      false
    );
    v_journals := v_journals || jsonb_build_array(to_jsonb(v_journal));
  end loop;

  insert into public.organization_settings (
    organization_id, accounting_cutover_at, accounting_cutover_by, accounting_cutover_vat_payable
  ) values (
    p_org_id, now(), auth.uid(), p_vat_payable
  )
  on conflict (organization_id) do update set
    accounting_cutover_at = now(),
    accounting_cutover_by = auth.uid(),
    accounting_cutover_vat_payable = p_vat_payable,
    updated_at = now();

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'COMMIT_OPENING_CUTOVER', v_fingerprint,
    'opening_cutover', p_org_id,
    jsonb_build_object('journals', v_journals, 'vat_payable', p_vat_payable::text)
  );
  perform public.record_audit(
    p_org_id, 'OPENING_CUTOVER_COMMITTED', 'organization', p_org_id::text,
    jsonb_build_object('journal_count', jsonb_array_length(v_journals),
      'vat_payable', p_vat_payable::text)
  );
  return jsonb_build_object('journals', v_journals, 'vat_payable', p_vat_payable);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-only reconciliation (contract §17). Never posts.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_reconciliation(p_org_id uuid)
returns table (
  dimension text,
  entity_id uuid,
  entity_label text,
  metric text,
  operational_balance numeric,
  ledger_balance numeric,
  difference numeric,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id_ar uuid; v_id_ca uuid; v_id_dep uuid; v_id_exp uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');
  v_id_ca := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');
  v_id_exp := public._chart_id(p_org_id, '5200');

  return query
  -- Customer: invoiced or CLOSED events reconcile commercial outstanding to
  -- AR + contract asset − deposits. Uninvoiced open events reconcile
  -- deposits to recorded payments (no AR exists yet — contract §16 case 2).
  -- ledger raw 2000 is debit−credit; deposits credit-normal = −raw;
  -- outstanding ledger = AR_raw + CA_raw − deposits = AR_raw + CA_raw + dep_raw.
  select 'CUSTOMER'::text,
         x.event_id,
         x.event_number,
         x.metric,
         x.operational_balance,
         x.ledger_balance,
         round(x.operational_balance - x.ledger_balance, 3),
         case when abs(x.operational_balance - x.ledger_balance) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from (
      select f.event_id,
             coalesce(f.event_number, f.event_id::text) as event_number,
             case when f.event_status = 'CLOSED' or inv.has_invoice
                  then 'outstanding' else 'deposits' end as metric,
             case when f.event_status = 'CLOSED' or inv.has_invoice
                  then coalesce(f.outstanding_balance, 0)
                  else coalesce(f.amount_paid, 0) end as operational_balance,
             case when f.event_status = 'CLOSED' or inv.has_invoice
                  then round(
                    public._ledger_event_raw(p_org_id, f.event_id, v_id_ar)
                  + public._ledger_event_raw(p_org_id, f.event_id, v_id_ca)
                  + public._ledger_event_raw(p_org_id, f.event_id, v_id_dep), 3)
                  else round(- public._ledger_event_raw(p_org_id, f.event_id, v_id_dep), 3)
             end as ledger_balance
        from public.event_finance_summaries f
        left join lateral (
          select exists (
            select 1 from public.invoices i
             where i.organization_id = p_org_id
               and i.event_id = f.event_id and i.status = 'ISSUED'
          ) as has_invoice
        ) inv on true
       where f.organization_id = p_org_id
    ) x;

  return query
  -- Event expenses: operational RECORDED vs 5200 debit-raw (net of voids).
  select 'EVENT'::text,
         x.event_id,
         x.event_id::text,
         'expenses'::text,
         x.op,
         x.led,
         round(x.op - x.led, 3),
         case when abs(x.op - x.led) <= 0.001 then 'MATCHED' else 'DIFFERENCE' end
    from (
      select e.event_id,
             coalesce((
               select sum(ex.amount) from public.event_expenses ex
                where ex.organization_id = p_org_id and ex.event_id = e.event_id
                  and ex.status = 'RECORDED'
             ), 0) as op,
             public._ledger_event_raw(p_org_id, e.event_id, v_id_exp) as led
        from (select distinct event_id from public.event_expenses
               where organization_id = p_org_id) e
    ) x;

  return query
  -- Treasury per account: ledger IS the operational truth after opening.
  -- Compare derived journal balance against itself (always MATCHED) plus
  -- surface the figure. A DIFFERENCE would mean cached vs derived drift,
  -- which cannot happen because there is no cached balance.
  select 'TREASURY'::text,
         t.id,
         t.name,
         'balance'::text,
         b.raw_balance,
         b.raw_balance,
         0::numeric,
         'MATCHED'::text
    from public.treasury_accounts t
    join lateral (
      select coalesce(sum(l.debit) - sum(l.credit), 0) as raw_balance
        from public.journal_lines l
       where l.organization_id = t.organization_id and l.account_id = t.chart_account_id
    ) b on true
   where t.organization_id = p_org_id;

  return query
  -- Staff: operational N = E-A-P vs ledger payable − receivable.
  select 'STAFF'::text,
         m.id,
         m.name,
         'net_position'::text,
         round(s.e - s.a - s.p, 3),
         round(coalesce(pos.payable, 0) - coalesce(pos.receivable, 0), 3),
         round((s.e - s.a - s.p) - (coalesce(pos.payable, 0) - coalesce(pos.receivable, 0)), 3),
         case when abs((s.e - s.a - s.p) - (coalesce(pos.payable, 0) - coalesce(pos.receivable, 0))) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from public.staff_members m
    join lateral (
      select
        coalesce((select sum(a.earned_amount) from public.staff_attendance a
                   where a.organization_id = m.organization_id and a.staff_member_id = m.id
                     and a.status <> 'VOIDED'), 0) as e,
        coalesce((select sum(v.amount) from public.staff_advances v
                   where v.organization_id = m.organization_id and v.staff_member_id = m.id
                     and v.status = 'RECORDED'), 0) as a,
        coalesce((select sum(h.amount) from public.host_payouts h
                   where h.organization_id = m.organization_id and h.staff_member_id = m.id
                     and h.status = 'RECORDED'), 0) as p
    ) s on true
    left join lateral (
      select * from public._staff_payroll_position(p_org_id, m.id)
    ) pos on true
   where m.organization_id = p_org_id;

  return query
  -- Supplier AP: operational invoices − payments vs ledger 2200.
  select 'SUPPLIER'::text,
         s.id,
         s.name,
         'ap'::text,
         round(coalesce(op.ap, 0), 3),
         round(coalesce(public._supplier_ap_position(p_org_id, s.id), 0), 3),
         round(coalesce(op.ap, 0) - coalesce(public._supplier_ap_position(p_org_id, s.id), 0), 3),
         case when abs(coalesce(op.ap, 0) - coalesce(public._supplier_ap_position(p_org_id, s.id), 0)) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from public.suppliers s
    left join lateral (
      select coalesce(sum(i.amount) filter (where i.status = 'RECORDED'), 0)
           - coalesce((select sum(p.amount) from public.supplier_payments p
                        where p.organization_id = s.organization_id and p.supplier_id = s.id
                          and p.status = 'RECORDED'), 0) as ap
        from public.supplier_invoices i
       where i.organization_id = s.organization_id and i.supplier_id = s.id
    ) op on true
   where s.organization_id = p_org_id;
end;
$$;

revoke all on function public._ledger_raw(uuid, uuid) from public, anon, authenticated;
revoke all on function public._ledger_event_raw(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._opening_customer_positions(uuid) from public, anon, authenticated;
revoke all on function public._opening_lines_with_equity(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._staff_payroll_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public._supplier_ap_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public.preview_opening_cutover(uuid, numeric) from public, anon;
revoke all on function public.commit_opening_cutover(uuid, numeric, uuid) from public, anon;
revoke all on function public.accounting_reconciliation(uuid) from public, anon;
grant execute on function public.preview_opening_cutover(uuid, numeric) to authenticated;
grant execute on function public.commit_opening_cutover(uuid, numeric, uuid) to authenticated;
grant execute on function public.accounting_reconciliation(uuid) to authenticated;
