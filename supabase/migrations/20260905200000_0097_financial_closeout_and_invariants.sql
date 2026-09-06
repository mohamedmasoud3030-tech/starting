-- ============================================================================
-- 0097 — Financial close-out: reconciliation reports, close guards,
--        ledger-backed snapshots, and accounting invariants
--
-- AUTHORITY: docs/research/accounting-posting-contract.md.
-- Closes the remaining backend contract that 0095/0096 explicitly deferred:
--
--   * §17 — the remaining named reconciliation reports that
--     accounting_reconciliation did not yet surface:
--       - customer-payments total  (CUSTOMER_PAYMENTS)
--       - invoice outstanding      (INVOICES)
--       - closure snapshots        (CLOSURE_SNAPSHOTS)
--       - VAT payable              (VAT_PAYABLE)
--   * §18 — ledger-backed financial-close guards:
--       - revenue must be recognized (Deferred 2100 = 0, Contract Asset
--         1120 = 0) before financial close;
--       - customer invoices are cost/AR creation and are blocked on a
--         financially-closed event (the supplier-side nuance already exists
--         from 0091: supplier invoices blocked, supplier payments allowed).
--   * §19 — ledger-backed close-out snapshots: new columns on
--     event_financial_closures capture the accounting position at close time.
--   * §21 — database-boundary no-negative-balance invariant on the restricted
--     system accounts, enforced by a DEFERRABLE CONSTRAINT TRIGGER (the same
--     mechanism as 0084's balanced-journal invariant), plus the pgTAP proofs
--     in financial_closeout.test.sql.
--
-- Reuses the canonical primitives: _ledger_event_raw/_ledger_raw (0093),
-- _event_account_balance/_chart_id (0087), guard_event_financially_closed
-- (0069), ensure_system_chart / internal_post_journal / assert_journal_balanced
-- (0084). No new posting primitives, no second accounting model, no changes to
-- 0084–0096.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §19 — ledger-backed close-out snapshot columns.
-- ---------------------------------------------------------------------------
alter table public.event_financial_closures
  add column is_ledger_backed boolean not null default false,
  add column deferred_revenue_at_close numeric(14,3),
  add column contract_asset_at_close numeric(14,3),
  add column accounts_receivable_at_close numeric(14,3),
  add column customer_deposits_at_close numeric(14,3),
  add column vat_payable_at_close numeric(14,3),
  add column supplier_ap_at_close numeric(14,3),
  add column payroll_payable_at_close numeric(14,3),
  add column treasury_balance_at_close numeric(14,3);

-- ---------------------------------------------------------------------------
-- Internal helper: event-scoped raw (debit − credit) ledger balance as of a
-- point in time (journal line created_at <= p_at), for the §17 closure-snapshot
-- reconciliation (§19 snapshots are captured at close time from the current
-- ledger, so they must equal the at-time ledger exactly).
-- ---------------------------------------------------------------------------
create or replace function public._ledger_event_raw_at(
  p_org_id uuid,
  p_event_id uuid,
  p_account_id uuid,
  p_at timestamptz
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
     and e.event_id = p_event_id
     and l.created_at <= p_at;
$$;

-- ---------------------------------------------------------------------------
-- §21 — no-negative-balance invariant for the restricted system accounts.
--
-- Restricted accounts (contract §21 MUST-NOT invert sign):
--   assets (DEBIT-normal, raw >= 0): 1000 Cash, 1010 Bank, 1020 Other,
--     1100 AR, 1120 Contract Asset, 1150 Staff Receivable;
--   liabilities/revenue (CREDIT-normal, raw <= 0): 2000 Deposits, 2100
--     Deferred, 2150 VAT Payable, 2200 AP, 2300 Payroll Payable, 4000 Revenue.
--
-- Treasury sub-accounts (1001+, 1011+, …) are deliberately EXCLUDED: an
-- overdrawn treasury is a legitimate owner input via set_treasury_opening_balance
-- (0085). Equity 3000 is excluded (it may invert by design). Expenses are not
-- in the contract's MUST-NOT list.
--
-- DEFERRABLE so it validates the FINAL committed balance (never intermediate
-- states within a posting). SECURITY DEFINER so it can read journal_lines on
-- PG15 where deferred triggers fire as the role executing COMMIT (mirrors
-- assert_journal_balanced in 0084).
-- ---------------------------------------------------------------------------
create or replace function public.assert_no_negative_balances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.chart_of_accounts;
  v_raw numeric;
begin
  select * into v_acc
    from public.chart_of_accounts c
   where c.organization_id = new.organization_id and c.id = new.account_id;
  if not found then
    return new;
  end if;

  if v_acc.is_system and v_acc.code in (
       '1000','1010','1020','1100','1120','1150',
       '2000','2100','2150','2200','2300','4000'
     ) then
    select coalesce(sum(l.debit) - sum(l.credit), 0) into v_raw
      from public.journal_lines l
     where l.organization_id = new.organization_id
       and l.account_id = new.account_id;
    if v_acc.normal_balance = 'DEBIT' and v_raw < 0 then
      raise exception 'NEGATIVE_BALANCE_VIOLATION: %', v_acc.code using errcode = '23514';
    end if;
    if v_acc.normal_balance = 'CREDIT' and v_raw > 0 then
      raise exception 'NEGATIVE_BALANCE_VIOLATION: %', v_acc.code using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger journal_lines_nonnegative
  after insert on public.journal_lines
  deferrable initially deferred
  for each row execute function public.assert_no_negative_balances();

-- ---------------------------------------------------------------------------
-- §18 — customer invoices are cost/AR creation: block them on a financially
-- closed event (INSERT creates new economics; UPDATE/DELETE mutates frozen
-- history). Reuses the 0069 guard verbatim.
-- ---------------------------------------------------------------------------
drop trigger if exists invoices_financial_guard on public.invoices;
create trigger invoices_financial_guard
  before insert or update or delete on public.invoices
  for each row execute function public.guard_event_financially_closed();

-- ---------------------------------------------------------------------------
-- §18/§19 — close_event_financially: add the ledger-backed revenue-recognition
-- gate and capture the accounting snapshot. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.close_event_financially(
  p_org_id uuid,
  p_event_id uuid,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.event_financial_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.event_financial_closures;
  v_fin public.event_finance_summaries;
  v_fingerprint text;
  v_replay jsonb;

  -- accounting snapshot
  v_is_ledger_backed boolean := false;
  v_id_ar uuid; v_id_ca uuid; v_id_dep uuid; v_id_def uuid;
  v_id_vat uuid; v_id_ap uuid; v_id_pay uuid;
  v_ar_close numeric(14,3); v_ca_close numeric(14,3); v_dep_close numeric(14,3);
  v_def_close numeric(14,3); v_vat_close numeric(14,3); v_ap_close numeric(14,3);
  v_pay_close numeric(14,3); v_treasury_close numeric(14,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOSE_EVENT_FINANCIALLY', 'event_id', p_event_id,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_financial_closures, v_replay);
  end if;

  -- Lock the event and re-verify readiness INSIDE the transaction.
  perform 1 from public.events where organization_id = p_org_id and id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Double-close guard: an active closure already exists.
  if exists (
    select 1 from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null
  ) then
    select * into v_closure from public.event_financial_closures
     where event_id = p_event_id and reopened_at is null;
    return v_closure;
  end if;

  select * into v_fin from public.event_finance_summaries
   where organization_id = p_org_id and event_id = p_event_id;
  if not found or coalesce(v_fin.accepted_revenue, 0) <= 0 then
    raise exception 'FINANCIAL_CLOSE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if coalesce(v_fin.outstanding_balance, 0) > 0 then
    raise exception 'FINANCIAL_CLOSE_OUTSTANDING_BALANCE' using errcode = '23514';
  end if;

  -- ==================== LEDGER-BACKED GATE + SNAPSHOT ====================
  -- Only when the ledger holds activity for this event (post-cutover or
  -- post-0086 activity); pre-ledger organisations keep the commercial-only
  -- close unchanged. §18: revenue must already be recognized — no deferred
  -- revenue (2100) and no contract asset (1120) may remain outstanding.
  -- §19: capture the accounting position at close time.
  if exists (
    select 1 from public.journal_entries
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    v_is_ledger_backed := true;
    perform public.ensure_system_chart(p_org_id);
    v_id_ar  := public._chart_id(p_org_id, '1100');
    v_id_ca  := public._chart_id(p_org_id, '1120');
    v_id_dep := public._chart_id(p_org_id, '2000');
    v_id_def := public._chart_id(p_org_id, '2100');
    v_id_vat := public._chart_id(p_org_id, '2150');
    v_id_ap  := public._chart_id(p_org_id, '2200');
    v_id_pay := public._chart_id(p_org_id, '2300');

    if public._event_account_balance(p_org_id, p_event_id, v_id_def) <> 0 then
      raise exception 'FINANCIAL_CLOSE_REVENUE_NOT_RECOGNIZED' using errcode = '23514';
    end if;
    if public._ledger_event_raw(p_org_id, p_event_id, v_id_ca) > 0 then
      raise exception 'FINANCIAL_CLOSE_CONTRACT_ASSET_OUTSTANDING' using errcode = '23514';
    end if;

    v_ar_close := public._ledger_event_raw(p_org_id, p_event_id, v_id_ar);
    v_ca_close := public._ledger_event_raw(p_org_id, p_event_id, v_id_ca);
    v_dep_close := public._event_account_balance(p_org_id, p_event_id, v_id_dep);
    v_def_close := public._event_account_balance(p_org_id, p_event_id, v_id_def);
    v_ap_close := public._event_account_balance(p_org_id, p_event_id, v_id_ap);
    v_pay_close := public._event_account_balance(p_org_id, p_event_id, v_id_pay);
    v_vat_close := - public._ledger_raw(p_org_id, v_id_vat);
    select coalesce(sum(l.debit) - sum(l.credit), 0) into v_treasury_close
      from public.journal_lines l
     where l.organization_id = p_org_id
       and l.account_id in (
         select t.chart_account_id from public.treasury_accounts t
          where t.organization_id = p_org_id
         union
         select c.id from public.chart_of_accounts c
          where c.organization_id = p_org_id and c.code in ('1000','1010','1020')
       );
  end if;

  insert into public.event_financial_closures (
    organization_id, event_id, closed_at, closed_by, close_note,
    revenue_at_close, collected_at_close, outstanding_at_close,
    costs_at_close, profit_at_close, margin_at_close,
    is_ledger_backed, deferred_revenue_at_close, contract_asset_at_close,
    accounts_receivable_at_close, customer_deposits_at_close,
    vat_payable_at_close, supplier_ap_at_close, payroll_payable_at_close,
    treasury_balance_at_close
  ) values (
    p_org_id, p_event_id, now(), auth.uid(),
    nullif(trim(coalesce(p_note, '')), ''),
    v_fin.accepted_revenue, v_fin.amount_paid, v_fin.outstanding_balance,
    v_fin.actual_cost, v_fin.actual_profit, v_fin.margin_percent,
    v_is_ledger_backed, v_def_close, v_ca_close, v_ar_close, v_dep_close,
    v_vat_close, v_ap_close, v_pay_close, v_treasury_close
  ) returning * into v_closure;

  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CLOSE_EVENT_FINANCIALLY', v_fingerprint,
    'event_financial_closure', v_closure.id, to_jsonb(v_closure)
  );
  perform public.record_audit(p_org_id, 'EVENT_FINANCIALLY_CLOSED', 'event', p_event_id::text,
    jsonb_build_object('closure_id', v_closure.id, 'profit', v_closure.profit_at_close::text,
      'revenue', v_closure.revenue_at_close::text));
  return v_closure;
end;
$$;

-- ---------------------------------------------------------------------------
-- §17 — extend accounting_reconciliation with the remaining named reports.
-- Signature unchanged; additive dimensions only. Every dimension is an
-- identity over the authoritative ledger, so a non-MATCHED row indicates a
-- genuine posting defect.
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
  v_id_ar uuid; v_id_ca uuid; v_id_dep uuid; v_id_exp uuid; v_id_def uuid; v_id_vat uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');
  v_id_ca := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');
  v_id_exp := public._chart_id(p_org_id, '5200');
  v_id_def := public._chart_id(p_org_id, '2100');
  v_id_vat := public._chart_id(p_org_id, '2150');

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

  -- ======================= §17 remaining named reports =======================

  return query
  -- Customer-payments total: operational RECORDED payments that actually went
  -- through posting vs the ledger treasury-side net of the payment journals.
  -- Pre-ledger payments (no journal) are excluded by construction — the
  -- ledger is authoritative for post-cutover activity only.
  with pay_driver as (
    select distinct e.event_id
      from public.journal_entries e
     where e.organization_id = p_org_id
       and e.source_type in ('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID')
       and e.event_id is not null
  )
  select 'CUSTOMER_PAYMENTS'::text,
         d.event_id,
         coalesce(f.event_number, d.event_id::text),
         'payments'::text,
         round(coalesce(op.op, 0), 3),
         round(coalesce(led.led, 0), 3),
         round(coalesce(op.op, 0) - coalesce(led.led, 0), 3),
         case when abs(coalesce(op.op, 0) - coalesce(led.led, 0)) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from pay_driver d
    left join public.event_finance_summaries f
      on f.organization_id = p_org_id and f.event_id = d.event_id
    left join lateral (
      select sum(cp.amount) as op
        from public.customer_payments cp
       where cp.organization_id = p_org_id
         and cp.event_id = d.event_id
         and cp.status = 'RECORDED'
         and exists (select 1 from public.journal_entries je
                      where je.organization_id = p_org_id
                        and je.source_type = 'CUSTOMER_PAYMENT'
                        and je.source_id = cp.id
                        and not je.is_reversal)
    ) op on true
    left join lateral (
      select sum(l.debit) - sum(l.credit) as led
        from public.journal_lines l
        join public.journal_entries e
          on e.organization_id = l.organization_id and e.id = l.entry_id
       where l.organization_id = p_org_id
         and e.event_id = d.event_id
         and e.source_type in ('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID')
         and l.account_id in (
           select t.chart_account_id from public.treasury_accounts t
            where t.organization_id = p_org_id
           union
           select c.id from public.chart_of_accounts c
            where c.organization_id = p_org_id and c.code in ('1000','1010','1020')
         )
    ) led on true;

  return query
  -- Invoice outstanding: commercial remaining (gross) vs ledger AR raw (1100).
  select 'INVOICES'::text,
         inv.event_id,
         inv.invoice_number,
         'ar_outstanding'::text,
         round(inv.total_amount - coalesce(pay.paid, 0), 3),
         round(public._ledger_event_raw(p_org_id, inv.event_id, v_id_ar), 3),
         round((inv.total_amount - coalesce(pay.paid, 0))
             - public._ledger_event_raw(p_org_id, inv.event_id, v_id_ar), 3),
         case when abs((inv.total_amount - coalesce(pay.paid, 0))
                     - public._ledger_event_raw(p_org_id, inv.event_id, v_id_ar)) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from public.invoices inv
    left join lateral (
      select sum(cp.amount) as paid
        from public.customer_payments cp
       where cp.organization_id = p_org_id
         and cp.event_id = inv.event_id
         and cp.status = 'RECORDED'
    ) pay on true
   where inv.organization_id = p_org_id
     and inv.status = 'ISSUED'
     -- Post-ledger invoices only: pre-cutover (historical) invoices have no
     -- AR in the ledger (cutover does not replay historical AR), so only
     -- invoices that actually went through the posting path reconcile.
     and exists (
       select 1 from public.journal_entries je
        where je.organization_id = p_org_id
          and je.source_type = 'INVOICE'
          and je.source_id = inv.id
          and not je.is_reversal
     );

  return query
  -- Closure snapshots: the §19 ledger-backed snapshot must equal the ledger as
  -- of the close time (ledger is append-only, so a mismatch means the snapshot
  -- was captured from the wrong source).
  select 'CLOSURE_SNAPSHOTS'::text,
         c.id,
         coalesce(f.event_number, c.event_id::text),
         m.metric,
         m.snap_val,
         case m.metric
           when 'deferred'          then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_def, c.closed_at)
           when 'contract_asset'    then   public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ca,  c.closed_at)
           when 'accounts_receivable' then public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ar,  c.closed_at)
           when 'customer_deposits' then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_dep, c.closed_at)
         end as led_val,
         round(m.snap_val - (
           case m.metric
             when 'deferred'          then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_def, c.closed_at)
             when 'contract_asset'    then   public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ca,  c.closed_at)
             when 'accounts_receivable' then public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ar,  c.closed_at)
             when 'customer_deposits' then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_dep, c.closed_at)
           end), 3),
         case when abs(m.snap_val - (
           case m.metric
             when 'deferred'          then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_def, c.closed_at)
             when 'contract_asset'    then   public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ca,  c.closed_at)
             when 'accounts_receivable' then public._ledger_event_raw_at(p_org_id, c.event_id, v_id_ar,  c.closed_at)
             when 'customer_deposits' then - public._ledger_event_raw_at(p_org_id, c.event_id, v_id_dep, c.closed_at)
           end)) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from public.event_financial_closures c
    left join public.event_finance_summaries f
      on f.organization_id = c.organization_id and f.event_id = c.event_id
    cross join lateral (
      values
        ('deferred',           c.deferred_revenue_at_close),
        ('contract_asset',     c.contract_asset_at_close),
        ('accounts_receivable', c.accounts_receivable_at_close),
        ('customer_deposits',  c.customer_deposits_at_close)
    ) as m(metric, snap_val)
   where c.organization_id = p_org_id and c.is_ledger_backed;

  return query
  -- VAT payable: owner-provided opening + derived post-cutover VAT must equal
  -- the ledger's 2150 balance (opening + non-opening == total).
  select 'VAT_PAYABLE'::text,
         p_org_id,
         'VAT Payable'::text,
         'vat_payable'::text,
         round(coalesce(op.opening_vat, 0) + coalesce(der.derived, 0), 3),
         round(- public._ledger_raw(p_org_id, v_id_vat), 3),
         round(coalesce(op.opening_vat, 0) + coalesce(der.derived, 0)
             + public._ledger_raw(p_org_id, v_id_vat), 3),
         case when abs(coalesce(op.opening_vat, 0) + coalesce(der.derived, 0)
                     + public._ledger_raw(p_org_id, v_id_vat)) <= 0.001
              then 'MATCHED' else 'DIFFERENCE' end
    from lateral (
      select coalesce((select s.accounting_cutover_vat_payable
                         from public.organization_settings s
                        where s.organization_id = p_org_id), 0) as opening_vat
    ) op
    cross join lateral (
      select coalesce(sum(l.credit - l.debit), 0) as derived
        from public.journal_lines l
        join public.journal_entries e
          on e.organization_id = l.organization_id and e.id = l.entry_id
       where l.organization_id = p_org_id
         and l.account_id = v_id_vat
         and e.source_type <> 'OPENING_BALANCE'
    ) der;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the new internal helper stays client-unexposed. The re-pointed
-- RPCs keep their existing grants (CREATE OR REPLACE preserves them).
-- ---------------------------------------------------------------------------
revoke all on function public._ledger_event_raw_at(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.assert_no_negative_balances()
  from public, anon, authenticated;
