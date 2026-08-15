-- ============================================================================
-- 0037 — S6 RLS, least privilege and stable frontend read models
--
-- Customer financial data (payment amounts, event economics) is readable only
-- by can_read_cost() roles (OWNER/MANAGER/ACCOUNTANT). Operational roles
-- (SUPERVISOR/WAREHOUSE) are default-deny: they never see customer payment
-- amounts or margins, at the data boundary — not merely hidden in the UI.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RLS: organization-scoped, default-deny. The base ledger exposes no client
-- write policy; commands are the only mutation path. The idempotency register
-- is internal command machinery and exposes no client read model.
-- ---------------------------------------------------------------------------
alter table public.payments_command_idempotency enable row level security;
alter table public.customer_payments enable row level security;

create policy customer_payments_cost_reader_select on public.customer_payments
  for select using (public.can_read_cost(organization_id));

-- No INSERT/UPDATE/DELETE policy on any S6 table.

-- ---------------------------------------------------------------------------
-- CustomerPaymentSummary — cost-bearing payment history for cost readers.
-- ---------------------------------------------------------------------------
create view public.customer_payment_summaries as
select
  p.id as payment_id,
  p.organization_id,
  p.event_id,
  e.event_number,
  p.amount,
  p.payment_method,
  p.reference,
  p.notes,
  p.paid_at,
  p.status,
  p.recorded_by,
  p.voided_by,
  p.voided_at,
  p.void_reason,
  p.created_at
from public.customer_payments p
join public.events e
  on e.organization_id = p.organization_id and e.id = p.event_id
where public.can_read_cost(p.organization_id);

-- ---------------------------------------------------------------------------
-- EventFinanceSummary — one authoritative economics row per event.
--
-- Revenue and expected cost/profit come from the ACCEPTED quotation snapshot
-- (never re-derived from current commercial lines). Paid/outstanding come from
-- the RECORDED payment ledger (VOIDED excluded). Committed/delivered cost come
-- from the existing S5 procurement cost summary. The current gross margin uses
-- committed procurement cost when active orders exist, otherwise the accepted
-- quotation's expected cost — both are existing authoritative numbers; no new
-- accounting model is introduced.
-- ---------------------------------------------------------------------------
create view public.event_finance_summaries as
select
  e.organization_id,
  e.id as event_id,
  e.event_number,
  e.status as event_status,
  coalesce(q.total_selling, 0)::numeric(14,3) as accepted_revenue,
  coalesce(q.total_expected_cost, 0)::numeric(14,3) as expected_cost,
  coalesce(q.total_expected_profit, 0)::numeric(14,3) as expected_profit,
  coalesce((
    select sum(p.amount)
      from public.customer_payments p
     where p.organization_id = e.organization_id
       and p.event_id = e.id
       and p.status = 'RECORDED'
  ), 0)::numeric(14,3) as amount_paid,
  (coalesce(q.total_selling, 0) - coalesce((
    select sum(p.amount)
      from public.customer_payments p
     where p.organization_id = e.organization_id
       and p.event_id = e.id
       and p.status = 'RECORDED'
  ), 0))::numeric(14,3) as outstanding_balance,
  coalesce(pc.active_committed_cost, 0)::numeric(14,3) as committed_cost,
  coalesce(pc.delivered_cost, 0)::numeric(14,3) as delivered_cost,
  (
    coalesce(q.total_selling, 0)
    - case
        when pc.active_order_count > 0 then coalesce(pc.active_committed_cost, 0)
        else coalesce(q.total_expected_cost, 0)
      end
  )::numeric(14,3) as gross_margin
from public.events e
left join public.quotations q
  on q.organization_id = e.organization_id and q.id = e.accepted_quotation_id
left join public.event_procurement_cost_summaries pc
  on pc.organization_id = e.organization_id and pc.event_id = e.id
where public.can_read_cost(e.organization_id);

-- ---------------------------------------------------------------------------
-- Explicit Supabase default-grant revocation. Raw tables are not frontend
-- contracts; only the stable read models are granted SELECT.
-- ---------------------------------------------------------------------------
revoke all on table
  public.payments_command_idempotency,
  public.customer_payments,
  public.customer_payment_summaries,
  public.event_finance_summaries
  from anon, authenticated;

grant select on table
  public.customer_payment_summaries,
  public.event_finance_summaries
  to authenticated;
