-- ============================================================================
-- 0096 — Stage 3 read models (contract §20): the remaining named surfaces
--
--   * accounting_ar_aging               — per-event AR gross aging (1100)
--   * accounting_ap_aging               — per-supplier AP aging (2200)
--   * accounting_contract_asset_aging   — per-event contract-asset aging (1120)
--   * accounting_supplier_statement     — chronological AP activity + running
--   * accounting_customer_statement     — chronological customer activity,
--                                         §17 outstanding-identity running
--                                         balance, enhanced with allocation
--                                         detail (customer_payment_allocations)
--
-- Architecture (0094 pattern, unchanged): read-only SECURITY DEFINER /
-- STABLE / search_path='' functions; capability gate first; org filter on
-- header AND lines; financial figures from the journal only; operational
-- tables appear strictly as document labels/dates; deterministic ordering;
-- window aggregates computed BEFORE limit/offset.
--
-- Canonical reuse, no duplicated formulas:
--   * AR/CA balances           -> public._ledger_event_raw (0093)
--   * AP balance + attribution -> public._supplier_ap_position predicate (0093)
--   * running outstanding      -> AR_raw + CA_raw + dep_raw identity
--                                 (0093 reconciliation / 0094 outstanding_ar)
--   * allocation detail        -> customer_payment_allocations (0087), the
--                                 authoritative allocation record (§17)
--
-- The commercial 0080 customer_statement / host_statement / treasury_statement
-- office documents are untouched (§20 compatibility contract).
-- Design contract: docs/research/stage3-aging-statements.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. AR aging. AR exists only once invoiced (or opened at cutover); deposit-
--    only and CLOSED-unbilled events carry no 1100 lines and never appear.
--    Amounts are gross (AR carries its VAT component per contract §5).
--    Buckets are a documented derivation: CURRENT <=30, DAYS_31_60,
--    DAYS_61_90, OVER_90, measured from the AR-origin journal date.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_ar_aging(
  p_org_id uuid,
  p_as_of date default current_date
)
returns table (
  event_id uuid,
  event_number text,
  customer_id uuid,
  customer_name text,
  ar_gross numeric,
  ar_origin_date date,
  age_days int,
  aging_bucket text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id_ar uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');

  return query
    select x.event_id,
           x.event_number,
           x.customer_id,
           x.customer_name,
           x.ar_gross,
           x.ar_origin_date,
           (p_as_of - x.ar_origin_date)::int,
           case when (p_as_of - x.ar_origin_date) <= 30 then 'CURRENT'
                when (p_as_of - x.ar_origin_date) <= 60 then 'DAYS_31_60'
                when (p_as_of - x.ar_origin_date) <= 90 then 'DAYS_61_90'
                else 'OVER_90' end
      from (
        select e.id as event_id,
               e.event_number,
               e.customer_id,
               cu.name as customer_name,
               round(public._ledger_event_raw(p_org_id, e.id, v_id_ar), 3) as ar_gross,
               (select min(en.entry_date)
                  from public.journal_entries en
                  join public.journal_lines ln
                    on ln.organization_id = en.organization_id
                   and ln.entry_id = en.id
                 where en.organization_id = p_org_id
                   and en.event_id = e.id
                   and en.is_reversal = false
                   and en.source_type in ('INVOICE', 'OPENING_BALANCE')
                   and ln.account_id = v_id_ar) as ar_origin_date
          from public.events e
          join public.customers cu
            on cu.organization_id = e.organization_id
           and cu.id = e.customer_id
         where e.organization_id = p_org_id
      ) x
     where x.ar_gross > 0
     order by 7 desc nulls last, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. AP aging. Balance reuses the canonical _supplier_ap_position (includes
--    OPENING_BALANCE attribution). Origin = earliest non-reversal supplier
--    invoice / opening entry touching 2200 (same attribution predicate).
-- ---------------------------------------------------------------------------
create or replace function public.accounting_ap_aging(
  p_org_id uuid,
  p_as_of date default current_date
)
returns table (
  supplier_id uuid,
  supplier_name text,
  ap_balance numeric,
  ap_origin_date date,
  age_days int,
  aging_bucket text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id_ap uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ap := public._chart_id(p_org_id, '2200');

  return query
    select x.supplier_id,
           x.supplier_name,
           x.ap_balance,
           x.ap_origin_date,
           (p_as_of - x.ap_origin_date)::int,
           case when (p_as_of - x.ap_origin_date) <= 30 then 'CURRENT'
                when (p_as_of - x.ap_origin_date) <= 60 then 'DAYS_31_60'
                when (p_as_of - x.ap_origin_date) <= 90 then 'DAYS_61_90'
                else 'OVER_90' end
      from (
        select s.id as supplier_id,
               s.name as supplier_name,
               round(pos.ap_balance, 3) as ap_balance,
               (select min(en.entry_date)
                  from public.journal_entries en
                  join public.journal_lines ln
                    on ln.organization_id = en.organization_id
                   and ln.entry_id = en.id
                 where en.organization_id = p_org_id
                   and ln.account_id = v_id_ap
                   and en.is_reversal = false
                   and (
                     (en.source_type = 'SUPPLIER_INVOICE'
                      and exists (select 1 from public.supplier_invoices si
                                   where si.organization_id = p_org_id
                                     and si.id = en.source_id
                                     and si.supplier_id = s.id))
                     or (en.source_type = 'OPENING_BALANCE'
                         and en.source_id = s.id)
                   )) as ap_origin_date
          from public.suppliers s
          join lateral (
            select public._supplier_ap_position(p_org_id, s.id) as ap_balance
          ) pos on true
         where s.organization_id = p_org_id
      ) x
     where x.ap_balance > 0
     order by 5 desc nulls last, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Contract-asset aging. CA is created at CLOSED-unbilled recognition
--    (gross, contract §4 Option B) and removed by reclassification to AR on
--    later invoicing — journal state alone drives the lifecycle.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_contract_asset_aging(
  p_org_id uuid,
  p_as_of date default current_date
)
returns table (
  event_id uuid,
  event_number text,
  customer_id uuid,
  customer_name text,
  contract_asset_gross numeric,
  recognition_date date,
  age_days int,
  aging_bucket text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id_ca uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ca := public._chart_id(p_org_id, '1120');

  return query
    select x.event_id,
           x.event_number,
           x.customer_id,
           x.customer_name,
           x.contract_asset_gross,
           x.recognition_date,
           (p_as_of - x.recognition_date)::int,
           case when (p_as_of - x.recognition_date) <= 30 then 'CURRENT'
                when (p_as_of - x.recognition_date) <= 60 then 'DAYS_31_60'
                when (p_as_of - x.recognition_date) <= 90 then 'DAYS_61_90'
                else 'OVER_90' end
      from (
        select e.id as event_id,
               e.event_number,
               e.customer_id,
               cu.name as customer_name,
               round(public._ledger_event_raw(p_org_id, e.id, v_id_ca), 3) as contract_asset_gross,
               (select min(en.entry_date)
                  from public.journal_entries en
                  join public.journal_lines ln
                    on ln.organization_id = en.organization_id
                   and ln.entry_id = en.id
                 where en.organization_id = p_org_id
                   and en.event_id = e.id
                   and en.is_reversal = false
                   and en.source_type in ('UNBILLED_RECOGNITION', 'OPENING_BALANCE')
                   and ln.account_id = v_id_ca) as recognition_date
          from public.events e
          join public.customers cu
            on cu.organization_id = e.organization_id
           and cu.id = e.customer_id
         where e.organization_id = p_org_id
      ) x
     where x.contract_asset_gross > 0
     order by 7 desc nulls last, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Supplier statement. Chronological AP journal activity for one supplier
--    using the exact _supplier_ap_position attribution predicate; running
--    balance is credit-normal AP, windowed BEFORE pagination. Document
--    labels come from supplier_invoices / supplier_payments.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_supplier_statement(
  p_org_id uuid,
  p_supplier_id uuid,
  p_from date default null,
  p_to date default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  entry_date date,
  created_at timestamptz,
  entry_number text,
  source_type public.journal_source_type,
  is_reversal boolean,
  document_number text,
  document_date date,
  event_id uuid,
  event_number text,
  ap_debit numeric,
  ap_credit numeric,
  running_balance numeric,
  memo text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id_ap uuid;
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers
                  where organization_id = p_org_id and id = p_supplier_id) then
    return;
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ap := public._chart_id(p_org_id, '2200');

  return query
    select b.entry_date,
           b.created_at,
           b.entry_number,
           b.source_type,
           b.is_reversal,
           b.document_number,
           b.document_date,
           b.event_id,
           b.event_number,
           b.ap_debit,
           b.ap_credit,
           round(sum(b.ap_credit - b.ap_debit) over (
             order by b.entry_date, b.created_at, b.entry_number
             rows between unbounded preceding and current row), 3) as running_balance,
           b.memo
      from (
        select e.entry_date,
               e.created_at,
               e.entry_number,
               e.source_type,
               e.is_reversal,
               coalesce(si.invoice_number, sp.reference) as document_number,
               coalesce(si.invoice_date, sp.payment_date) as document_date,
               e.event_id,
               ev.event_number,
               round(coalesce(sum(l.debit), 0), 3) as ap_debit,
               round(coalesce(sum(l.credit), 0), 3) as ap_credit,
               e.memo
          from public.journal_entries e
          join public.journal_lines l
            on l.organization_id = e.organization_id
           and l.entry_id = e.id
           and l.account_id = v_id_ap
          left join public.supplier_invoices si
            on si.organization_id = e.organization_id
           and si.id = e.source_id
           and e.source_type in ('SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_VOID')
          left join public.supplier_payments sp
            on sp.organization_id = e.organization_id
           and sp.id = e.source_id
           and e.source_type in ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_VOID')
          left join public.events ev
            on ev.organization_id = e.organization_id
           and ev.id = e.event_id
         where e.organization_id = p_org_id
           and (
             (e.source_type in ('SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_VOID')
              and exists (select 1 from public.supplier_invoices si0
                           where si0.organization_id = p_org_id
                             and si0.id = e.source_id
                             and si0.supplier_id = p_supplier_id))
             or (e.source_type in ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_VOID')
              and exists (select 1 from public.supplier_payments sp0
                           where sp0.organization_id = p_org_id
                             and sp0.id = e.source_id
                             and sp0.supplier_id = p_supplier_id))
             or (e.source_type = 'OPENING_BALANCE'
                 and e.source_id = p_supplier_id)
           )
           and (p_from is null or e.entry_date >= p_from)
           and (p_to is null or e.entry_date <= p_to)
         group by e.entry_date, e.created_at, e.entry_number, e.source_type,
                  e.is_reversal, si.invoice_number, sp.reference,
                  si.invoice_date, sp.payment_date, e.event_id,
                  ev.event_number, e.memo
      ) b
     order by b.entry_date, b.created_at, b.entry_number
     limit greatest(coalesce(p_limit, 100), 0)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Customer statement enhanced with allocation. Chronological customer-
--    side journal activity (event-scoped). impact_on_outstanding is the
--    movement on AR(1100) + Contract Asset(1120) + Deposits(2000) raw — the
--    exact 0093 reconciliation / 0094 outstanding_ar identity; negative
--    running values mean net customer prepayment (0094 documented). The
--    allocations column carries the authoritative gross/net/VAT allocation
--    detail (§17) for entries whose source document participates in one.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_customer_statement(
  p_org_id uuid,
  p_customer_id uuid default null,
  p_event_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  entry_date date,
  created_at timestamptz,
  entry_number text,
  source_type public.journal_source_type,
  is_reversal boolean,
  event_id uuid,
  event_number text,
  customer_id uuid,
  customer_name text,
  document_number text,
  impact_on_outstanding numeric,
  running_outstanding numeric,
  allocations jsonb,
  memo text
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
begin
  if not public.has_permission(p_org_id, 'cost.visibility') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_event_id is not null
     and not exists (select 1 from public.events
                      where organization_id = p_org_id and id = p_event_id) then
    return;
  end if;
  if p_customer_id is not null
     and not exists (select 1 from public.customers
                      where organization_id = p_org_id and id = p_customer_id) then
    return;
  end if;

  perform public.ensure_system_chart(p_org_id);
  v_id_ar := public._chart_id(p_org_id, '1100');
  v_id_ca := public._chart_id(p_org_id, '1120');
  v_id_dep := public._chart_id(p_org_id, '2000');

  return query
    select b.entry_date,
           b.created_at,
           b.entry_number,
           b.source_type,
           b.is_reversal,
           b.event_id,
           b.event_number,
           b.customer_id,
           b.customer_name,
           b.document_number,
           b.impact_on_outstanding,
           round(sum(b.impact_on_outstanding) over (
             order by b.entry_date, b.created_at, b.entry_number
             rows between unbounded preceding and current row), 3) as running_outstanding,
           b.allocations,
           b.memo
      from (
        select e.entry_date,
               e.created_at,
               e.entry_number,
               e.source_type,
               e.is_reversal,
               e.event_id,
               ev.event_number,
               ev.customer_id,
               cu.name as customer_name,
               coalesce(iv.invoice_number, cp.reference) as document_number,
               round(coalesce(sum(l.debit - l.credit), 0), 3) as impact_on_outstanding,
               (select jsonb_agg(jsonb_build_object(
                          'payment_reference', ap.reference,
                          'invoice_number', ai.invoice_number,
                          'gross_amount', a.gross_amount,
                          'net_amount', a.net_amount,
                          'vat_amount', a.vat_amount)
                        order by a.created_at)
                  from public.customer_payment_allocations a
                  left join public.customer_payments ap
                    on ap.organization_id = a.organization_id
                   and ap.id = a.payment_id
                  left join public.invoices ai
                    on ai.organization_id = a.organization_id
                   and ai.id = a.invoice_id
                 where a.organization_id = p_org_id
                   and a.event_id = e.event_id
                   and (a.payment_id = e.source_id
                        or a.invoice_id = e.source_id)) as allocations,
               e.memo
          from public.journal_entries e
          join public.journal_lines l
            on l.organization_id = e.organization_id
           and l.entry_id = e.id
           and l.account_id in (v_id_ar, v_id_ca, v_id_dep)
          join public.events ev
            on ev.organization_id = e.organization_id
           and ev.id = e.event_id
          join public.customers cu
            on cu.organization_id = ev.organization_id
           and cu.id = ev.customer_id
          left join public.invoices iv
            on iv.organization_id = e.organization_id
           and iv.id = e.source_id
           and e.source_type in ('INVOICE', 'INVOICE_VOID',
                                 'CUSTOMER_DEPOSIT_APPLIED',
                                 'CUSTOMER_DEPOSIT_RELEASED')
          left join public.customer_payments cp
            on cp.organization_id = e.organization_id
           and cp.id = e.source_id
           and e.source_type in ('CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENT_VOID')
         where e.organization_id = p_org_id
           and e.event_id is not null
           and e.source_type in (
             'CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENT_VOID',
             'CUSTOMER_DEPOSIT_APPLIED', 'CUSTOMER_DEPOSIT_RELEASED',
             'INVOICE', 'INVOICE_VOID',
             'REVENUE_RECOGNITION', 'UNBILLED_RECOGNITION',
             'CONTRACT_ASSET_RECLASSIFICATION', 'REVENUE_REVERSAL',
             'OPENING_BALANCE')
           and (p_event_id is null or e.event_id = p_event_id)
           and (p_customer_id is null or ev.customer_id = p_customer_id)
           and (p_from is null or e.entry_date >= p_from)
           and (p_to is null or e.entry_date <= p_to)
         group by e.entry_date, e.created_at, e.entry_number, e.source_type,
                  e.is_reversal, e.event_id, ev.event_number, ev.customer_id,
                  cu.name, iv.invoice_number, cp.reference, e.source_id, e.memo
      ) b
     order by b.entry_date, b.created_at, b.entry_number
     limit greatest(coalesce(p_limit, 100), 0)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges (0094 shape): no table exposure, execute for authenticated,
-- capability enforced inside each function.
-- ---------------------------------------------------------------------------
revoke all on function public.accounting_ar_aging(uuid, date) from public, anon;
revoke all on function public.accounting_ap_aging(uuid, date) from public, anon;
revoke all on function public.accounting_contract_asset_aging(uuid, date) from public, anon;
revoke all on function public.accounting_supplier_statement(uuid, uuid, date, date, int, int) from public, anon;
revoke all on function public.accounting_customer_statement(uuid, uuid, uuid, date, date, int, int) from public, anon;
grant execute on function public.accounting_ar_aging(uuid, date) to authenticated;
grant execute on function public.accounting_ap_aging(uuid, date) to authenticated;
grant execute on function public.accounting_contract_asset_aging(uuid, date) to authenticated;
grant execute on function public.accounting_supplier_statement(uuid, uuid, date, date, int, int) to authenticated;
grant execute on function public.accounting_customer_statement(uuid, uuid, uuid, date, date, int, int) to authenticated;
