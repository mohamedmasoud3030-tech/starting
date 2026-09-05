-- ============================================================================
-- 0094 — Operator accounting read models (contract §20 "Stage 3")
--
-- AUTHORITY: docs/research/accounting-posting-contract.md
--   * §20 Stage 3 explicitly mandates accounting-specific read models gated
--     by cost.visibility / finance.manage: account balances, journal_history,
--     treasury balances, staff payable, supplier statement, etc.
--   * §5 line 168 fixes the per-event field vocabulary implemented in
--     accounting_customer_positions.
--   * §17 fixes the outstanding identity: (AR + Contract Asset) − Deposits.
--   * §21 fixes the raw vs normalized balance sign convention.
--   * §16: opening cutover never replays historical P&L; opening journals are
--     ordinary balanced entries and are therefore included in every report.
--
-- Architecture (per docs/research/operator-accounting-read-models.md §5):
--   * read-only SECURITY DEFINER functions, `stable`, `set search_path = ''`;
--   * NO new tables, NO views/materialized views, NO second treasury or
--     reconciliation model (0085/0093 surfaces are reused unchanged);
--   * journal_entries / journal_lines stay revoked from clients; these
--     functions are the only read path, gated by has_permission();
--   * attribution stays source_type / source_id / event_id — no new
--     dimension framework;
--   * all figures derive from the authoritative ledger (0084–0093); the only
--     operational inputs are labels (names/numbers/status) and the commercial
--     fields explicitly labeled commercial by contract §5.
--
-- Derived (documented, contract-consistent) choices:
--   * trial-balance / journal-history column sets and period semantics come
--     from §14/§21 and the merged 0084–0093 patterns, not from a contract
--     table; date filters are inclusive; accounts without lines are omitted;
--   * journal history pagination is LIMIT/OFFSET with a fully deterministic
--     order (entry_date desc, created_at desc, entry_number desc, line id);
--     p_limit clamps to [1,1000], p_offset to >= 0;
--   * payroll positions use payroll.read per 0079 Part C precedent, not
--     cost.visibility;
--   * customer_deposits_net = ledger 2000 (credit-normal), and
--     customer_deposits_gross = net + deposit VAT (2150 lines whose journal
--     source_type = CUSTOMER_PAYMENT), matching contract §16 "net for VAT";
--   * outstanding_ar uses the exact accounting_reconciliation arithmetic
--     (AR raw + contract asset raw + deposits raw), so negative values mean
--     net customer prepayment;
--   * supplier/payroll position lists keep zero rows (a settled supplier or
--     inactive staff member is a meaningful reporting row), matching the
--     accounting_reconciliation SUPPLIER/STAFF dimensions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trial balance — per-account debit/credit totals over an optional
--    inclusive date window on journal_lines.entry_date. Reversals are
--    ordinary lines and are included, so any window remains balanced:
--    SUM(debit_total) = SUM(credit_total) (§21 accounting equation).
-- ---------------------------------------------------------------------------
create or replace function public.accounting_trial_balance(
  p_org_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type public.account_type,
  normal_balance public.normal_balance,
  debit_total numeric,
  credit_total numeric,
  raw_balance numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ACCOUNTING_PERIOD_INVALID' using errcode = '22023';
  end if;

  return query
    select c.id,
           c.code,
           c.name,
           c.account_type,
           c.normal_balance,
           coalesce(sum(l.debit), 0),
           coalesce(sum(l.credit), 0),
           coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0),
           case when c.normal_balance = 'DEBIT'
                then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
                else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)
           end
      from public.chart_of_accounts c
      join public.journal_lines l
        on l.organization_id = c.organization_id
       and l.account_id = c.id
     where c.organization_id = p_org_id
       and (p_from is null or l.entry_date >= p_from)
       and (p_to is null or l.entry_date <= p_to)
     group by c.id, c.code, c.name, c.account_type, c.normal_balance
     order by c.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Journal history — one row per journal line, newest entry first, with
--    reversal linkage (reversed_by via the single-reversal unique index of
--    0084). Deterministic total order => stable LIMIT/OFFSET pagination.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_journal_history(
  p_org_id uuid,
  p_from date default null,
  p_to date default null,
  p_source_type public.journal_source_type default null,
  p_event_id uuid default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  entry_id uuid,
  entry_number text,
  entry_date date,
  event_at timestamptz,
  source_type public.journal_source_type,
  source_id uuid,
  event_id uuid,
  memo text,
  is_reversal boolean,
  reversal_of uuid,
  reversed_by uuid,
  account_id uuid,
  account_code text,
  account_name text,
  debit numeric,
  credit numeric,
  line_memo text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_offset int;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ACCOUNTING_PERIOD_INVALID' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select e.id,
           e.entry_number,
           e.entry_date,
           e.event_at,
           e.source_type,
           e.source_id,
           e.event_id,
           e.memo,
           e.is_reversal,
           e.reversal_of,
           r.id,
           l.account_id,
           c.code,
           c.name,
           l.debit,
           l.credit,
           l.line_memo
      from public.journal_entries e
      join public.journal_lines l
        on l.organization_id = e.organization_id
       and l.entry_id = e.id
      join public.chart_of_accounts c
        on c.organization_id = l.organization_id
       and c.id = l.account_id
      left join public.journal_entries r
        on r.organization_id = e.organization_id
       and r.reversal_of = e.id
       and r.is_reversal
     where e.organization_id = p_org_id
       and (p_from is null or e.entry_date >= p_from)
       and (p_to is null or e.entry_date <= p_to)
       and (p_source_type is null or e.source_type = p_source_type)
       and (p_event_id is null or e.event_id = p_event_id)
     order by e.entry_date desc, e.created_at desc, e.entry_number desc, l.id
     limit v_limit
     offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Customer / AR positions per event — contract §5 line-168 vocabulary.
--    Ledger-derived figures come from the authoritative journal via
--    _ledger_event_raw (0093) so opening journals and post-cutover postings
--    are both counted; commercial_value / commercial_pre_vat are commercial
--    (operational) figures and are never summed into accounting columns.
--    outstanding_ar uses the exact §17 arithmetic implemented by
--    accounting_reconciliation (AR raw + CA raw + deposits raw).
-- ---------------------------------------------------------------------------
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
           round(
             - public._ledger_event_raw(p_org_id, f.event_id, v_id_dep)
             + coalesce(
                 (select sum(l.credit) - sum(l.debit)
                    from public.journal_lines l
                    join public.journal_entries e
                      on e.organization_id = l.organization_id
                     and e.id = l.entry_id
                   where l.organization_id = p_org_id
                     and l.account_id = v_id_vat
                     and e.event_id = f.event_id
                     and e.source_type = 'CUSTOMER_PAYMENT'), 0), 3),
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
-- 4. Supplier AP positions — thin gated wrapper over the authoritative
--    _supplier_ap_position (0093, account 2200 incl. OPENING_BALANCE rows).
--    open_invoice_count = non-voided (RECORDED) supplier invoices (0090 is
--    the authoritative document table). Zero rows are retained: a settled
--    supplier is a meaningful reporting row (matches 0093 SUPPLIER rows).
-- ---------------------------------------------------------------------------
create or replace function public.accounting_supplier_positions(
  p_org_id uuid
)
returns table (
  supplier_id uuid,
  supplier_name text,
  ap_balance numeric,
  open_invoice_count bigint,
  last_posting_date date
)
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
    select s.id,
           s.name,
           round(public._supplier_ap_position(p_org_id, s.id), 3),
           (select count(*)
              from public.supplier_invoices si
             where si.organization_id = p_org_id
               and si.supplier_id = s.id
               and si.status = 'RECORDED'),
           (select max(e.entry_date)
              from public.journal_entries e
             where e.organization_id = p_org_id
               and (
                 (e.source_type in ('SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_VOID')
                  and exists (select 1 from public.supplier_invoices si2
                               where si2.organization_id = p_org_id
                                 and si2.id = e.source_id
                                 and si2.supplier_id = s.id))
                 or (e.source_type in ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_VOID')
                  and exists (select 1 from public.supplier_payments sp
                               where sp.organization_id = p_org_id
                                 and sp.id = e.source_id
                                 and sp.supplier_id = s.id))
                 or (e.source_type = 'OPENING_BALANCE' and e.source_id = s.id)
               ))
      from public.suppliers s
     where s.organization_id = p_org_id
     order by s.name, s.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Payroll positions per staff member — wrapper over the authoritative
--    _staff_payroll_position (0093: 2300 payable / 1150 receivable, incl.
--    OPENING_BALANCE attributions) plus outstanding advances via
--    _staff_advance_remaining (0092). Gated payroll.read per 0079 Part C.
--    net_position = payable − receivable, the same arithmetic the 0093
--    STAFF reconciliation dimension compares against operational E − A − P.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_payroll_positions(
  p_org_id uuid
)
returns table (
  staff_member_id uuid,
  staff_name text,
  payable numeric,
  receivable numeric,
  net_position numeric,
  advances_outstanding numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_org_id, 'payroll.read') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
    select m.id,
           m.name,
           round(pos.payable, 3),
           round(pos.receivable, 3),
           round(pos.payable - pos.receivable, 3),
           round(coalesce(
             (select sum(public._staff_advance_remaining(p_org_id, a.id))
                from public.staff_advances a
               where a.organization_id = p_org_id
                 and a.staff_member_id = m.id
                 and a.status = 'RECORDED'), 0), 3)
      from public.staff_members m
      join lateral (
        select * from public._staff_payroll_position(p_org_id, m.id)
      ) pos on true
     where m.organization_id = p_org_id
     order by m.name, m.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Opening cutover status — strictly read-only view of the 0093 cutover
--    stamp plus a census of OPENING_BALANCE journals grouped by resolved
--    entity kind (TREASURY / CUSTOMER / PAYROLL / SUPPLIER / VAT, matching
--    the source_id conventions of 0085 and 0093). Never previews or commits.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_cutover_status(
  p_org_id uuid
)
returns table (
  committed boolean,
  cutover_at timestamptz,
  cutover_by uuid,
  vat_payable numeric,
  opening_journal_count bigint,
  opening_entities jsonb
)
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
    select (os.accounting_cutover_at is not null),
           os.accounting_cutover_at,
           os.accounting_cutover_by,
           coalesce(os.accounting_cutover_vat_payable, 0),
           (select count(*)
              from public.journal_entries e
             where e.organization_id = p_org_id
               and e.source_type = 'OPENING_BALANCE'),
           jsonb_strip_nulls(jsonb_build_object(
             'TREASURY', (
               select jsonb_agg(e.source_id order by e.entry_number)
                 from public.journal_entries e
                where e.organization_id = p_org_id
                  and e.source_type = 'OPENING_BALANCE'
                  and exists (select 1 from public.treasury_accounts t
                               where t.organization_id = p_org_id
                                 and t.id = e.source_id)),
             'CUSTOMER', (
               select jsonb_agg(e.source_id order by e.entry_number)
                 from public.journal_entries e
                where e.organization_id = p_org_id
                  and e.source_type = 'OPENING_BALANCE'
                  and exists (select 1 from public.events ev
                               where ev.organization_id = p_org_id
                                 and ev.id = e.source_id)),
             'PAYROLL', (
               select jsonb_agg(e.source_id order by e.entry_number)
                 from public.journal_entries e
                where e.organization_id = p_org_id
                  and e.source_type = 'OPENING_BALANCE'
                  and exists (select 1 from public.staff_members sm
                               where sm.organization_id = p_org_id
                                 and sm.id = e.source_id)),
             'SUPPLIER', (
               select jsonb_agg(e.source_id order by e.entry_number)
                 from public.journal_entries e
                where e.organization_id = p_org_id
                  and e.source_type = 'OPENING_BALANCE'
                  and exists (select 1 from public.suppliers sp
                               where sp.organization_id = p_org_id
                                 and sp.id = e.source_id)),
             'VAT', (
               select jsonb_agg(e.source_id order by e.entry_number)
                 from public.journal_entries e
                where e.organization_id = p_org_id
                  and e.source_type = 'OPENING_BALANCE'
                  and e.source_id = p_org_id)
           ))
      from (values (1)) seed(n)
      left join public.organization_settings os
        on os.organization_id = p_org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: journal tables stay revoked from clients; these functions are
-- the gated read path. EXECUTE only to authenticated; each function
-- re-checks its capability internally. No grants to anon.
-- ---------------------------------------------------------------------------
revoke all on function public.accounting_trial_balance(uuid, date, date) from public, anon;
revoke all on function public.accounting_journal_history(uuid, date, date, public.journal_source_type, uuid, int, int) from public, anon;
revoke all on function public.accounting_customer_positions(uuid, uuid) from public, anon;
revoke all on function public.accounting_supplier_positions(uuid) from public, anon;
revoke all on function public.accounting_payroll_positions(uuid) from public, anon;
revoke all on function public.accounting_cutover_status(uuid) from public, anon;

grant execute on function public.accounting_trial_balance(uuid, date, date) to authenticated;
grant execute on function public.accounting_journal_history(uuid, date, date, public.journal_source_type, uuid, int, int) to authenticated;
grant execute on function public.accounting_customer_positions(uuid, uuid) to authenticated;
grant execute on function public.accounting_supplier_positions(uuid) to authenticated;
grant execute on function public.accounting_payroll_positions(uuid) to authenticated;
grant execute on function public.accounting_cutover_status(uuid) to authenticated;
