-- ============================================================================
-- 0068 — Unified actual profitability (Phase D5/D6)
--
-- One source of truth for event economics. Replaces the event_finance_summaries
-- view so it keeps every existing column (backward compatible for the current
-- finance read model) AND adds the unified actual-cost/profit columns:
--
--   accepted_revenue  = accepted quotation total_selling (CONTRACTED revenue)
--   amount_paid       = Σ RECORDED customer payments      (CASH collected)
--   outstanding       = revenue − collected               (receivable)
--   staff_cost        = Σ payroll earned amounts          (actual host/supervisor cost)
--   procurement_cost  = active committed (or delivered)   (purchases)
--   expense_cost      = Σ RECORDED event_expenses         (transport/fuel/…)
--   actual_cost       = staff_cost + procurement_cost + expense_cost
--   actual_profit     = revenue − actual_cost
--   margin_percent    = actual_profit / revenue × 100
--
-- Revenue, collected and outstanding are NEVER conflated. Purchases are NOT
-- double-counted: they come from procurement alone, not from event_expenses.
-- ============================================================================

drop view if exists public.event_finance_summaries;
drop function if exists public._view_event_finance_summaries();

create or replace function public._view_event_finance_summaries()
returns table(
  organization_id uuid,
  event_id uuid,
  event_number text,
  event_status public.event_status,
  accepted_revenue numeric,
  expected_cost numeric,
  expected_profit numeric,
  amount_paid numeric,
  outstanding_balance numeric,
  committed_cost numeric,
  delivered_cost numeric,
  gross_margin numeric,
  staff_cost numeric,
  procurement_cost numeric,
  expense_cost numeric,
  actual_cost numeric,
  actual_profit numeric,
  margin_percent numeric
)
language sql stable security definer set search_path = ''
as $$
  select
    e.organization_id,
    e.id as event_id,
    e.event_number,
    e.status as event_status,
    coalesce(q.total_selling, 0)::numeric(14,3) as accepted_revenue,
    coalesce(q.total_expected_cost, 0)::numeric(14,3) as expected_cost,
    coalesce(q.total_expected_profit, 0)::numeric(14,3) as expected_profit,
    coalesce((select sum(p.amount) from public.customer_payments p
       where p.organization_id = e.organization_id and p.event_id = e.id
         and p.status = 'RECORDED'), 0)::numeric(14,3) as amount_paid,
    (coalesce(q.total_selling, 0)
       - coalesce((select sum(p.amount) from public.customer_payments p
            where p.organization_id = e.organization_id and p.event_id = e.id
              and p.status = 'RECORDED'), 0))::numeric(14,3) as outstanding_balance,
    coalesce(pc.active_committed_cost, 0)::numeric(14,3) as committed_cost,
    coalesce(pc.delivered_cost, 0)::numeric(14,3) as delivered_cost,
    (coalesce(q.total_selling, 0)
       - case
           when pc.active_order_count > 0 then coalesce(pc.active_committed_cost, 0)
           else coalesce(q.total_expected_cost, 0)
         end)::numeric(14,3) as gross_margin,
    -- Actual cost sources (each counted exactly once):
    coalesce(st.staff_cost, 0)::numeric(14,3) as staff_cost,
    (case
       when coalesce(pc.active_committed_cost, 0) > 0 then coalesce(pc.active_committed_cost, 0)
       else coalesce(pc.delivered_cost, 0)
     end)::numeric(14,3) as procurement_cost,
    coalesce(ex.expense_cost, 0)::numeric(14,3) as expense_cost,
    (coalesce(st.staff_cost, 0)
       + (case
            when coalesce(pc.active_committed_cost, 0) > 0 then coalesce(pc.active_committed_cost, 0)
            else coalesce(pc.delivered_cost, 0)
          end)
       + coalesce(ex.expense_cost, 0))::numeric(14,3) as actual_cost,
    (coalesce(q.total_selling, 0)
       - (coalesce(st.staff_cost, 0)
            + (case
                 when coalesce(pc.active_committed_cost, 0) > 0 then coalesce(pc.active_committed_cost, 0)
                 else coalesce(pc.delivered_cost, 0)
               end)
            + coalesce(ex.expense_cost, 0)))::numeric(14,3) as actual_profit,
    case when coalesce(q.total_selling, 0) > 0
      then round((coalesce(q.total_selling, 0)
            - (coalesce(st.staff_cost, 0)
                 + (case
                      when coalesce(pc.active_committed_cost, 0) > 0 then coalesce(pc.active_committed_cost, 0)
                      else coalesce(pc.delivered_cost, 0)
                    end)
                 + coalesce(ex.expense_cost, 0))) / q.total_selling * 100, 2)
      else null
    end as margin_percent
  from public.events e
  left join public.quotations q
    on q.organization_id = e.organization_id and q.id = e.accepted_quotation_id
  left join public.event_procurement_cost_summaries pc
    on pc.organization_id = e.organization_id and pc.event_id = e.id
  left join (
    select hp.event_id, sum(hp.earned_total)::numeric(14,3) as staff_cost
      from public.host_event_payroll_summaries hp
     group by hp.event_id
  ) st on st.event_id = e.id
  left join (
    select x.event_id, sum(x.amount)::numeric(14,3) as expense_cost
      from public.event_expenses x
     where x.status = 'RECORDED'
     group by x.event_id
  ) ex on ex.event_id = e.id
  where public.can_read_cost(e.organization_id);
$$;
create view public.event_finance_summaries with (security_invoker=true)
  as select * from public._view_event_finance_summaries();

revoke all on function public._view_event_finance_summaries() from public, anon, authenticated;
grant execute on function public._view_event_finance_summaries() to authenticated;
revoke all on table public.event_finance_summaries from anon, authenticated;
grant select on table public.event_finance_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- Per-category expense totals (the clickable breakdown behind D6).
-- ---------------------------------------------------------------------------
create or replace function public._view_event_expense_category_summaries()
returns table(
  organization_id uuid, event_id uuid, category public.expense_category,
  total numeric, count bigint
)
language sql stable security definer set search_path = ''
as $$
  select e.organization_id, e.event_id, e.category,
    sum(e.amount)::numeric(14,3) as total, count(*)::bigint as count
  from public.event_expenses e
  where e.status = 'RECORDED' and public.can_read_cost(e.organization_id)
  group by e.organization_id, e.event_id, e.category;
$$;
create view public.event_expense_category_summaries with (security_invoker=true)
  as select * from public._view_event_expense_category_summaries();

revoke all on function public._view_event_expense_category_summaries() from public, anon, authenticated;
grant execute on function public._view_event_expense_category_summaries() to authenticated;
revoke all on table public.event_expense_category_summaries from anon, authenticated;
grant select on table public.event_expense_category_summaries to authenticated;
