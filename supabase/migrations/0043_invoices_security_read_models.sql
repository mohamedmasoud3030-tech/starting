-- ============================================================================
-- 0043 — S6+ invoicing RLS, least privilege and read models
--
-- Invoices and their installment schedules are financial data: readable only
-- by can_read_cost() (OWNER/MANAGER/ACCOUNTANT) at the data boundary. No client
-- write policy exists — commands are the only mutation path. The base ledgers
-- are not granted to the client; only the stable read models are.
-- ============================================================================

alter table public.invoices enable row level security;
alter table public.invoice_installments enable row level security;

create policy invoices_cost_reader_select on public.invoices
  for select using (public.can_read_cost(organization_id));
create policy invoice_installments_cost_reader_select on public.invoice_installments
  for select using (public.can_read_cost(organization_id));

-- ---------------------------------------------------------------------------
-- invoice_summaries — header + authoritative paid/remaining from S6 ledger.
-- ---------------------------------------------------------------------------
create view public.invoice_summaries as
select
  inv.id as invoice_id,
  inv.organization_id,
  inv.event_id,
  e.event_number,
  e.title as event_title,
  inv.quotation_id,
  inv.invoice_number,
  inv.issued_at,
  inv.due_at,
  inv.total_amount,
  inv.status as invoice_status,
  inv.note,
  inv.voided_by,
  inv.voided_at,
  inv.void_reason,
  inv.created_at,
  coalesce(cp.paid_total, 0)::numeric(14,3) as paid_total,
  (inv.total_amount - coalesce(cp.paid_total, 0))::numeric(14,3) as remaining_balance
from public.invoices inv
join public.events e
  on e.organization_id = inv.organization_id and e.id = inv.event_id
left join (
  select organization_id, event_id, sum(amount) as paid_total
  from public.customer_payments
  where status = 'RECORDED'
  group by organization_id, event_id
) cp on cp.organization_id = inv.organization_id and cp.event_id = inv.event_id
where public.can_read_cost(inv.organization_id);

-- ---------------------------------------------------------------------------
-- invoice_installment_summaries — schedule with DERIVED paid state.
-- effective_status is PAID when cumulative scheduled amount up to this
-- installment is covered by the cumulative RECORDED customer payments for the
-- event (never a second money source of truth).
-- ---------------------------------------------------------------------------
create view public.invoice_installment_summaries as
select
  i.id as installment_id,
  i.organization_id,
  i.invoice_id,
  inv.event_id,
  inv.invoice_number,
  i.seq,
  i.kind,
  i.due_date,
  i.amount,
  i.status as plan_status,
  coalesce(cp.paid_total, 0)::numeric(14,3) as invoice_paid_total,
  sum(i.amount) over (partition by i.invoice_id order by i.seq)::numeric(14,3) as cumulative_amount,
  case
    when sum(i.amount) over (partition by i.invoice_id order by i.seq)
         <= coalesce(cp.paid_total, 0)
      then 'PAID'::text
    else 'PENDING'::text
  end as effective_status
from public.invoice_installments i
join public.invoices inv
  on inv.organization_id = i.organization_id and inv.id = i.invoice_id
left join (
  select organization_id, event_id, sum(amount) as paid_total
  from public.customer_payments
  where status = 'RECORDED'
  group by organization_id, event_id
) cp on cp.organization_id = inv.organization_id and cp.event_id = inv.event_id
where public.can_read_cost(i.organization_id);

-- ---------------------------------------------------------------------------
-- Explicit Supabase default-grant revocation. Only the read models are granted.
-- ---------------------------------------------------------------------------
revoke all on table
  public.invoices,
  public.invoice_installments,
  public.invoice_summaries,
  public.invoice_installment_summaries
  from anon, authenticated;

grant select on table
  public.invoice_summaries,
  public.invoice_installment_summaries
  to authenticated;
