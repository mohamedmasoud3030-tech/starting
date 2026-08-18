-- ============================================================================
-- 0071 — Management metrics (Phase E1)
--
-- One canonical, server-authoritative aggregate for the management dashboard.
-- Revenue / collected / outstanding / cost / profit are NEVER conflated and are
-- computed from the already-canonical `event_finance_summaries` (which itself
-- sums the three cost sources exactly once). Period boundaries respect
-- Asia/Muscat (the caller passes p_from/p_to as timestamptz instants; this
-- function treats an event as "in period" by its Muscat-local start_at).
-- ============================================================================

create or replace function public.management_metrics(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_now timestamptz default now()
)
returns table(
  events_today int,
  events_tomorrow int,
  events_week int,
  confirmed_upcoming int,
  events_preparing int,
  events_in_progress int,
  events_waiting_return int,
  events_low_readiness int,
  quotes_draft int,
  quotes_waiting int,
  quotes_accepted int,
  quotes_expired int,
  quotes_rejected int,
  quote_conversion_rate numeric,
  avg_quote_value numeric,
  top_packages jsonb,
  revenue numeric,
  collected numeric,
  outstanding numeric,
  actual_cost numeric,
  gross_profit numeric,
  margin_percent numeric,
  financially_open_completed int,
  overdue_balance numeric,
  ready_to_close int,
  close_blocked int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Muscat', p_now))::date;
  v_tomorrow date := v_today + 1;
  v_week_end date := v_today + 7;
  v_can_cost boolean := public.can_read_cost(p_org_id);
  v_active_ids uuid[];
  v_ready_events int := 0;
  v_revenue numeric := 0;
  v_collected numeric := 0;
  v_cost numeric := 0;
  v_profit numeric := 0;
  v_outstanding numeric := 0;
  v_overdue numeric := 0;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_active_ids
  from public.events
  where organization_id = p_org_id
    and status not in ('CLOSED','CANCELLED');

  -- Operational counts.
  select
    count(*) filter (where (timezone('Asia/Muscat', e.start_at))::date = v_today),
    count(*) filter (where (timezone('Asia/Muscat', e.start_at))::date = v_tomorrow),
    count(*) filter (where (timezone('Asia/Muscat', e.start_at))::date between v_today and v_week_end),
    count(*) filter (where e.status = 'CONFIRMED' and e.start_at > p_now),
    count(*) filter (where e.status = 'PREPARING'),
    count(*) filter (where e.status = 'IN_PROGRESS'),
    count(*) filter (where e.status in ('DISPATCHED','RETURNING'))
  into
    events_today, events_tomorrow, events_week, confirmed_upcoming,
    events_preparing, events_in_progress, events_waiting_return
  from public.events e
  where e.organization_id = p_org_id
    and e.status <> 'CANCELLED';

  -- Low-readiness count (reuse the canonical batch function).
  select count(*)::int into events_low_readiness
  from public.event_readiness_batch(p_org_id, v_active_ids) r
  where r.staff_missing > 0 or r.equipment_shortage > 0;

  -- Commercial quote counts + conversion rate + average value (issued in period).
  select
    count(*) filter (where status = 'DRAFT'),
    count(*) filter (where status = 'ISSUED'),
    count(*) filter (where status = 'ACCEPTED'),
    count(*) filter (where status = 'EXPIRED' or (status = 'ISSUED' and is_expired)),
    count(*) filter (where status = 'REJECTED')
  into quotes_draft, quotes_waiting, quotes_accepted, quotes_expired, quotes_rejected
  from public.quotations_customer q
  where q.organization_id = p_org_id;

  select
    case
      when count(*) filter (where status in ('ACCEPTED','CONVERTED')) = 0 then 0
      else round(
        (count(*) filter (where status = 'CONVERTED'))::numeric
          / (count(*) filter (where status in ('ACCEPTED','CONVERTED')))::numeric * 100, 1)
    end,
    coalesce(avg(total_selling) filter (where status in ('ISSUED','ACCEPTED','CONVERTED')), 0)
  into quote_conversion_rate, avg_quote_value
  from public.quotations_customer q
  where q.organization_id = p_org_id;

  -- Most-used packages (top 5 by applied snapshot provenance).
  select coalesce(jsonb_agg(t order by t->>'count' desc), '[]'::jsonb) into top_packages
  from (
    select jsonb_build_object('name', coalesce(p.name, 'غير معروف'), 'count', count(*)) as t
    from public.quotation_lines l
    left join public.packages p on p.id = l.source_package_id and p.organization_id = l.organization_id
    where l.organization_id = p_org_id and l.source_package_id is not null
    group by p.name
    order by count(*) desc
    limit 5
  ) s;

  -- Financial period metrics (from the canonical finance summary).
  if v_can_cost then
    select
      coalesce(sum(f.accepted_revenue), 0),
      coalesce(sum(f.amount_paid), 0),
      coalesce(sum(f.outstanding_balance), 0),
      coalesce(sum(f.actual_cost), 0),
      coalesce(sum(f.actual_profit), 0)
    into v_revenue, v_collected, v_outstanding, v_cost, v_profit
    from public.event_finance_summaries f
    join public.events e on e.id = f.event_id and e.organization_id = f.organization_id
    where f.organization_id = p_org_id
      and e.status <> 'CANCELLED'
      and e.start_at >= p_from
      and e.start_at < p_to;

    -- Overdue balance: outstanding on events already past (before today).
    select coalesce(sum(f.outstanding_balance), 0) into v_overdue
    from public.event_finance_summaries f
    join public.events e on e.id = f.event_id and e.organization_id = f.organization_id
    where f.organization_id = p_org_id
      and e.status <> 'CANCELLED'
      and e.start_at < p_now
      and f.outstanding_balance > 0;

    -- Financially open completed events.
    select count(*)::int into financially_open_completed
    from public.events e
    where e.organization_id = p_org_id
      and e.status = 'CLOSED'
      and not exists (
        select 1 from public.event_financial_closures c
        where c.event_id = e.id and c.reopened_at is null
      );

    -- Ready to close vs blocked (among operationally completed events).
    select count(*)::int into ready_to_close
    from public.event_finance_summaries f
    where f.organization_id = p_org_id
      and f.event_status = 'CLOSED'
      and f.accepted_revenue > 0
      and f.outstanding_balance <= 0;

    select count(*)::int into close_blocked
    from public.event_finance_summaries f
    where f.organization_id = p_org_id
      and f.event_status = 'CLOSED'
      and (f.accepted_revenue <= 0 or f.outstanding_balance > 0)
      and not exists (
        select 1 from public.event_financial_closures c
        where c.event_id = f.event_id and c.reopened_at is null
      );
  else
    v_revenue := 0; v_collected := 0; v_outstanding := 0;
    v_cost := 0; v_profit := 0; v_overdue := 0;
    financially_open_completed := 0; ready_to_close := 0; close_blocked := 0;
  end if;

  revenue := v_revenue;
  collected := v_collected;
  outstanding := v_outstanding;
  actual_cost := v_cost;
  gross_profit := v_profit;
  overdue_balance := v_overdue;
  margin_percent := case when v_revenue > 0 then round(v_profit / v_revenue * 100, 2) else null end;

  return next;
end;
$$;

revoke all on function public.management_metrics(uuid, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.management_metrics(uuid, timestamptz, timestamptz, timestamptz) to authenticated;
