-- ============================================================================
-- 0095 — VAT gross-deposit reconciliation & cutover parity
--
-- Contract §17 compares customer deposits GROSS (Deposits gross =
-- max(P_gross - I_gross, 0); outstanding = (AR + Contract Asset) -
-- Deposits), and §16 posts opening deposits gross. For VAT-registered orgs
-- a deposit posts Cr 2000 [net] + Cr 2150 [VAT] (0086), so 0093's
-- reconciliation `deposits` metric and cutover deposit gap — both built on
-- net 2000 alone — reported a false DIFFERENCE / posted an extra deposit
-- opening equal to the deposit VAT (double-counted against 2150).
--
-- Fix: ONE canonical private derivation of the event-scoped net deposit
-- VAT — `_ledger_event_deposit_vat` = Σ(credit - debit) on 2150 for
-- journal lines sourced CUSTOMER_PAYMENT / CUSTOMER_PAYMENT_VOID (void
-- reversals net to zero automatically). Consumers:
--   * accounting_reconciliation — `deposits` metric (uninvoiced events);
--     the `outstanding` branch stays untouched (CA/AR already carry VAT).
--   * preview_opening_cutover — deposit gap ledger side, only for the
--     gross-deposit opening branches (event CANCELLED or no ISSUED
--     invoice), mirroring _opening_customer_positions exactly.
--   * accounting_customer_positions (0094) — customer_deposits_gross now
--     void-safe (was ignoring CUSTOMER_PAYMENT_VOID debit lines).
--
-- Read-only corrections. No schema changes, no signature changes, no new
-- grants. Non-VAT orgs: helper returns 0 → behavior unchanged.
-- Design contract: docs/research/vat-gross-deposit-reconciliation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Canonical event-scoped net deposit VAT (credit-normal, >= 0 in valid
-- states). Internal only — never granted to client roles.
-- ---------------------------------------------------------------------------
create or replace function public._ledger_event_deposit_vat(
  p_org_id uuid,
  p_event_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org_id
     and e.event_id = p_event_id
     and e.source_type in ('CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENT_VOID')
     and l.account_id = (select c.id from public.chart_of_accounts c
                          where c.organization_id = p_org_id
                            and c.code = '2150');
$$;

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
  -- deposits GROSS to recorded payments (no AR exists yet — contract §16
  -- case 2; §17 compares deposits gross). Ledger raw 2000 is debit−credit;
  -- deposits credit-normal = −raw; gross deposits add the event's deposit
  -- VAT (2150 lines sourced CUSTOMER_PAYMENT/VOID — 0095); outstanding
  -- ledger = AR_raw + CA_raw − deposits = AR_raw + CA_raw + dep_raw.
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
                  -- 0095 (§17 gross-deposit parity): uninvoiced deposits are
                  -- compared gross = net(2000) + deposit VAT (2150 lines from
                  -- CUSTOMER_PAYMENT/VOID). The outstanding branch above is
                  -- exact as-is (CA/AR already carry their VAT components).
                  else round(- public._ledger_event_raw(p_org_id, f.event_id, v_id_dep)
                           + public._ledger_event_deposit_vat(p_org_id, f.event_id), 3)
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
    -- 0095 (§16/§17 gross-deposit parity): the operational opening branches
    -- carry deposits GROSS except non-cancelled invoiced events
    -- (max(P-I,0)). Mirror that on the ledger side by adding the event's
    -- deposit VAT (2150, CUSTOMER_PAYMENT/VOID lines). Non-cancelled
    -- invoiced events keep the net comparison: allocation moved the net out
    -- of 2000 and the advance VAT was absorbed into the invoice VAT posting.
    if exists (select 1 from public.events ev
                where ev.organization_id = p_org_id
                  and ev.id = v_row.event_id
                  and ev.status = 'CANCELLED')
       or not exists (select 1 from public.invoices i
                       where i.organization_id = p_org_id
                         and i.event_id = v_row.event_id
                         and i.status = 'ISSUED') then
      v_dep_led := v_dep_led
                 + public._ledger_event_deposit_vat(p_org_id, v_row.event_id);
    end if;
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

create or replace function public.accounting_customer_positions(
  p_org_id uuid,
  p_event_id uuid default null
)
returns table (
  event_id uuid,
  event_number text,
  customer_id uuid,
  customer_name text,
  event_status public.event_status,
  commercial_value numeric,
  commercial_pre_vat numeric,
  recognized_revenue numeric,
  invoiced_amount_gross numeric,
  invoiced_amount_net numeric,
  vat_amount numeric,
  collected_amount_gross numeric,
  customer_deposits_net numeric,
  customer_deposits_gross numeric,
  accounts_receivable_gross numeric,
  unbilled_receivable_gross numeric,
  outstanding_ar numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id_ar uuid;
  v_id_ca uuid;
  v_id_dep uuid;
  v_id_rev uuid;
  v_id_vat uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');
  v_id_ca := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');
  v_id_rev := public._chart_id(p_org_id, '4000');
  v_id_vat := public._chart_id(p_org_id, '2150');

  return query
    select f.event_id,
           f.event_number,
           ev.customer_id,
           cu.name,
           f.event_status,
           round(coalesce(f.accepted_revenue, 0), 3),
           round(q.pre_vat_total, 3),
           round(- public._ledger_event_raw(p_org_id, f.event_id, v_id_rev), 3),
           round(coalesce(inv.i_gross, 0), 3),
           round(coalesce(inv.i_net, 0), 3),
           round(- public._ledger_event_raw(p_org_id, f.event_id, v_id_vat), 3),
           round(coalesce(pay.p_gross, 0), 3),
           round(- public._ledger_event_raw(p_org_id, f.event_id, v_id_dep), 3),
           -- 0095: canonical gross deposit = net(2000) + net deposit VAT
           -- (journal state incl. CUSTOMER_PAYMENT_VOID reversals), so a
           -- fully voided deposit shows gross 0, not the phantom VAT.
           round(
             - public._ledger_event_raw(p_org_id, f.event_id, v_id_dep)
             + public._ledger_event_deposit_vat(p_org_id, f.event_id), 3),
           round(public._ledger_event_raw(p_org_id, f.event_id, v_id_ar), 3),
           round(public._ledger_event_raw(p_org_id, f.event_id, v_id_ca), 3),
           round(
             public._ledger_event_raw(p_org_id, f.event_id, v_id_ar)
             + public._ledger_event_raw(p_org_id, f.event_id, v_id_ca)
             + public._ledger_event_raw(p_org_id, f.event_id, v_id_dep), 3)
      from public.event_finance_summaries f
      join public.events ev
        on ev.organization_id = f.organization_id
       and ev.id = f.event_id
      join public.customers cu
        on cu.organization_id = f.organization_id
       and cu.id = ev.customer_id
      left join public.quotations q
        on q.organization_id = f.organization_id
       and q.id = ev.accepted_quotation_id
      left join lateral (
        select coalesce(sum(i.total_amount), 0) as i_gross,
               coalesce(sum(i.pre_vat_total), 0) as i_net
          from public.invoices i
         where i.organization_id = p_org_id
           and i.event_id = f.event_id
           and i.status = 'ISSUED'
      ) inv on true
      left join lateral (
        select coalesce(sum(cp.amount), 0) as p_gross
          from public.customer_payments cp
         where cp.organization_id = p_org_id
           and cp.event_id = f.event_id
           and cp.status = 'RECORDED'
      ) pay on true
     where f.organization_id = p_org_id
       and (p_event_id is null or f.event_id = p_event_id)
     order by f.event_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: helper internal-only; redefined functions keep 0093/0094
-- grant shape (execute to authenticated, gated by has_permission inside).
-- ---------------------------------------------------------------------------
revoke all on function public._ledger_event_deposit_vat(uuid, uuid) from public, anon, authenticated;
