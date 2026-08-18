-- ============================================================================
-- 0072 — Customer 360, Global Search, Integrity Center, Reports (Phase E4-E7)
--
-- Four focused, server-authoritative read surfaces sharing the canonical
-- finance/quote/event projections. No cross-organization access; financial
-- figures stay behind can_read_cost; search is bounded (LIMIT per entity,
-- never the whole table into the browser).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- E4: Customer 360 — one row per customer with commercial + financial history.
-- ---------------------------------------------------------------------------
create or replace function public.customer_360(p_org_id uuid)
returns table(
  customer_id uuid,
  name text,
  phone text,
  whatsapp text,
  customer_type public.customer_type,
  notes text,
  is_active boolean,
  first_interaction_at timestamptz,
  last_interaction_at timestamptz,
  quotes_count int,
  accepted_quotes int,
  rejected_quotes int,
  events_count int,
  upcoming_events int,
  completed_events int,
  last_event_at timestamptz,
  total_commercial_value numeric,
  total_collected numeric,
  outstanding numeric,
  gross_profit numeric,
  days_since_last_event int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id as customer_id,
    c.name,
    c.phone,
    c.whatsapp,
    c.customer_type,
    c.notes,
    c.is_active,
    least(c.created_at,
      coalesce((select min(q.created_at) from public.quotations q where q.customer_id = c.id and q.organization_id = c.organization_id), c.created_at)) as first_interaction_at,
    greatest(c.created_at,
      coalesce((select max(q.created_at) from public.quotations q where q.customer_id = c.id and q.organization_id = c.organization_id), c.created_at),
      coalesce((select max(e.created_at) from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id), c.created_at)) as last_interaction_at,
    (select count(*)::int from public.quotations q where q.customer_id = c.id and q.organization_id = c.organization_id) as quotes_count,
    (select count(*)::int from public.quotations q where q.customer_id = c.id and q.organization_id = c.organization_id and q.status = 'ACCEPTED') as accepted_quotes,
    (select count(*)::int from public.quotations q where q.customer_id = c.id and q.organization_id = c.organization_id and q.status = 'REJECTED') as rejected_quotes,
    (select count(*)::int from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id) as events_count,
    (select count(*)::int from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id and e.status not in ('CLOSED','CANCELLED') and e.start_at > now()) as upcoming_events,
    (select count(*)::int from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id and e.status = 'CLOSED') as completed_events,
    (select max(e.start_at) from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id) as last_event_at,
    coalesce((select sum(f.accepted_revenue) from public.event_finance_summaries f join public.events e on e.id = f.event_id where e.customer_id = c.id and e.organization_id = c.organization_id), 0)::numeric(14,3) as total_commercial_value,
    coalesce((select sum(f.amount_paid) from public.event_finance_summaries f join public.events e on e.id = f.event_id where e.customer_id = c.id and e.organization_id = c.organization_id), 0)::numeric(14,3) as total_collected,
    coalesce((select sum(f.outstanding_balance) from public.event_finance_summaries f join public.events e on e.id = f.event_id where e.customer_id = c.id and e.organization_id = c.organization_id), 0)::numeric(14,3) as outstanding,
    case when public.can_read_cost(c.organization_id)
      then coalesce((select sum(f.actual_profit) from public.event_finance_summaries f join public.events e on e.id = f.event_id where e.customer_id = c.id and e.organization_id = c.organization_id), 0)::numeric(14,3)
      else null
    end as gross_profit,
    case
      when (select max(e.start_at) from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id) is null then null
      else (extract(epoch from (now() - (select max(e.start_at) from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id))) / 86400)::int
    end as days_since_last_event
  from public.customers c
  where c.organization_id = p_org_id
    and public.is_org_member(c.organization_id);
$$;

revoke all on function public.customer_360(uuid) from public, anon;
grant execute on function public.customer_360(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- E5: Global Search — bounded, grouped, organization-scoped.
-- ---------------------------------------------------------------------------
create or replace function public.global_search(p_org_id uuid, p_term text)
returns table(
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  destination text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_term, '')), '') is null then
    return;
  end if;

  return query
  select 'customer'::text, c.id, c.name, coalesce(c.phone, ''),
    '/customers/' || c.id::text
  from public.customers c
  where c.organization_id = p_org_id
    and (lower(c.name) like '%' || lower(trim(p_term)) || '%'
      or coalesce(lower(c.phone), '') like '%' || lower(trim(p_term)) || '%')
  limit 8;

  return query
  select 'event'::text, e.id, e.title, e.event_number || ' · ' || e.venue_name,
    '/events/' || e.id::text
  from public.events e
  where e.organization_id = p_org_id
    and (lower(e.title) like '%' || lower(trim(p_term)) || '%'
      or lower(e.event_number) like '%' || lower(trim(p_term)) || '%')
  limit 8;

  return query
  select 'quote'::text, q.id, coalesce(q.quotation_number, 'مسودة'), q.customer_name_snapshot,
    '/quotes/' || q.id::text
  from public.quotations_customer q
  where q.organization_id = p_org_id
    and (lower(coalesce(q.quotation_number, '')) like '%' || lower(trim(p_term)) || '%'
      or lower(q.customer_name_snapshot) like '%' || lower(trim(p_term)) || '%')
  limit 8;

  return query
  select 'invoice'::text, i.invoice_id, i.invoice_number, i.event_number,
    '/events/' || i.event_id::text
  from public.invoice_summaries i
  where i.organization_id = p_org_id
    and lower(i.invoice_number) like '%' || lower(trim(p_term)) || '%'
  limit 8;
end;
$$;

revoke all on function public.global_search(uuid, text) from public, anon;
grant execute on function public.global_search(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- E6: Integrity Center — findings that represent states that "should not exist".
-- Detection only; never auto-fix.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_findings(p_org_id uuid)
returns table(
  severity text,
  category text,
  finding_code text,
  problem text,
  why_it_matters text,
  entity_type text,
  entity_id uuid,
  destination text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_cost boolean := public.can_read_cost(p_org_id);
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Commercial integrity.
  return query
  select
    'CRITICAL', 'commercial', 'EVENT_LINKED_TO_NON_ACCEPTED_QUOTE',
    'مناسبة مرتبطة بعرض سعر غير معتمد',
    'قد تعكس قيمة المناسبة مرجعاً تجارياً غير صحيح',
    'event', e.id, '/events/' || e.id::text
  from public.events e
  join public.quotations q on q.id = e.accepted_quotation_id and q.organization_id = e.organization_id
  where e.organization_id = p_org_id
    and q.status not in ('ACCEPTED','CONVERTED');

  return query
  select
    'CRITICAL', 'commercial', 'MULTIPLE_EVENTS_FROM_QUOTE',
    'أكثر من مناسبة من نفس عرض السعر المعتمد',
    'يؤدي إلى تكرار قيمة تجارية واحدة في أكثر من مناسبة',
    'quote', q.id, '/quotes/' || q.id::text
  from public.quotations q
  where q.organization_id = p_org_id
    and q.status = 'CONVERTED'
    and (select count(*)::int from public.events e where e.accepted_quotation_id = q.id and e.organization_id = q.organization_id) > 1;

  if v_can_cost then
    return query
    -- Financial integrity: negative outstanding (payments exceeding revenue).
    select
      'CRITICAL', 'financial', 'NEGATIVE_OUTSTANDING',
      'متبقٍ سالب (المدفوع تجاوز قيمة العرض)',
      'يعني وجود مدفوعات أكبر من القيمة التجارية المعتمدة',
      'event', f.event_id, '/events/' || f.event_id::text
    from public.event_finance_summaries f
    where f.organization_id = p_org_id
      and f.outstanding_balance < 0;

    return query
    -- Financial integrity: multiple active financial closures (defensive).
    select
      'CRITICAL', 'financial', 'MULTIPLE_ACTIVE_CLOSURES',
      'أكثر من إغلاق مالي نشط لنفس المناسبة',
      'يُفقد التاريخ المالي وضوحه ويعني تلف بيانات',
      'event', c.event_id, '/events/' || c.event_id::text
    from public.event_financial_closures c
    where c.organization_id = p_org_id
      and c.reopened_at is null
    group by c.event_id
    having count(*) > 1;
  end if;

  -- Operational integrity.
  return query
  select
    'CRITICAL', 'operational', 'CLOSED_WITH_OUTSTANDING_EQUIPMENT',
    'مناسبة مغلقة ومعدات ما زالت في الخارج',
    'يخالف قاعدة الإغلاق: يجب إرجاع المعدات قبل الإغلاق',
    'event', e.id, '/events/' || e.id::text
  from public.events e
  where e.organization_id = p_org_id
    and e.status = 'CLOSED'
    and exists (
      select 1 from public.event_warehouse_lines w
      where w.event_id = e.id and w.outstanding_quantity > 0
    );

  return query
  -- Operational integrity: staff double-booked across two events.
  select distinct on (a.staff_member_id)
    'CRITICAL', 'operational', 'DUPLICATE_STAFF_ALLOCATION',
    'موظف مخصص لمناسبتين متداخلتين في الوقت',
    'تعارض موارد لا يجب أن يحدث (قيد قاعدة البيانات)',
    'event', a.event_id, '/events/' || a.event_id::text
  from public.event_staff_assignments a
  join public.event_staff_assignments b
    on b.staff_member_id = a.staff_member_id
   and b.id <> a.id
   and b.status = 'ACTIVE'
   and tstzrange(a.scheduled_start, a.scheduled_end, '[)') && tstzrange(b.scheduled_start, b.scheduled_end, '[)')
  where a.organization_id = p_org_id
    and a.status = 'ACTIVE';

  return;
end;
$$;

revoke all on function public.integrity_findings(uuid) from public, anon;
grant execute on function public.integrity_findings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- E7: Reports — focused, canonical aggregations.
-- ---------------------------------------------------------------------------

-- Revenue & profitability by event (period-filtered, Muscat-local start).
create or replace function public.report_events(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns table(
  event_id uuid,
  event_number text,
  title text,
  status public.event_status,
  start_at timestamptz,
  guest_count int,
  revenue numeric,
  collected numeric,
  outstanding numeric,
  actual_cost numeric,
  gross_profit numeric,
  margin_percent numeric
)
language sql stable security definer set search_path = ''
as $$
  select f.event_id, f.event_number, e.title, e.status, e.start_at, e.guest_count,
    f.accepted_revenue, f.amount_paid, f.outstanding_balance,
    f.actual_cost, f.actual_profit, f.margin_percent
  from public.event_finance_summaries f
  join public.events e on e.id = f.event_id and e.organization_id = f.organization_id
  where f.organization_id = p_org_id
    and public.can_read_cost(p_org_id)
    and e.start_at >= p_from and e.start_at < p_to
  order by e.start_at;
$$;

-- Revenue & profitability by customer (all-time).
create or replace function public.report_customers(p_org_id uuid)
returns table(
  customer_id uuid,
  name text,
  events_count int,
  total_value numeric,
  collected numeric,
  outstanding numeric,
  actual_cost numeric,
  gross_profit numeric
)
language sql stable security definer set search_path = ''
as $$
  select c.id as customer_id, c.name as name,
    (select count(*)::int from public.events e where e.customer_id = c.id and e.organization_id = c.organization_id) as events_count,
    coalesce(sum(f.accepted_revenue), 0)::numeric(14,3) as total_value,
    coalesce(sum(f.amount_paid), 0)::numeric(14,3) as collected,
    coalesce(sum(f.outstanding_balance), 0)::numeric(14,3) as outstanding,
    coalesce(sum(f.actual_cost), 0)::numeric(14,3) as actual_cost,
    coalesce(sum(f.actual_profit), 0)::numeric(14,3) as gross_profit
  from public.customers c
  left join public.events e on e.customer_id = c.id and e.organization_id = c.organization_id
  left join public.event_finance_summaries f on f.event_id = e.id and f.organization_id = c.organization_id
  where c.organization_id = p_org_id
    and public.can_read_cost(p_org_id)
  group by c.id, c.name
  order by coalesce(sum(f.accepted_revenue), 0) desc;
$$;

-- Package performance: usage count vs actual profitability (surface BOTH).
create or replace function public.report_packages(p_org_id uuid)
returns table(
  package_id uuid,
  package_name text,
  usage_count int,
  commercial_value numeric,
  actual_cost numeric,
  gross_profit numeric,
  margin_percent numeric
)
language sql stable security definer set search_path = ''
as $$
  select
    p.id as package_id,
    p.name as package_name,
    count(distinct l.quotation_id)::int as usage_count,
    coalesce(sum(q.total_selling), 0)::numeric(14,3) as commercial_value,
    coalesce(sum(f.actual_cost), 0)::numeric(14,3) as actual_cost,
    coalesce(sum(f.actual_profit), 0)::numeric(14,3) as gross_profit,
    case when coalesce(sum(q.total_selling), 0) > 0
      then round(coalesce(sum(f.actual_profit), 0) / coalesce(sum(q.total_selling), 0) * 100, 2)
      else null end as margin_percent
  from public.packages p
  left join public.quotation_lines l
    on l.source_package_id = p.id and l.organization_id = p.organization_id
  left join public.quotations q
    on q.id = l.quotation_id and q.organization_id = p.organization_id
  left join public.events e
    on e.accepted_quotation_id = q.id and e.organization_id = p.organization_id
  left join public.event_finance_summaries f
    on f.event_id = e.id and f.organization_id = p.organization_id
  where p.organization_id = p_org_id
    and public.can_read_cost(p_org_id)
  group by p.id, p.name
  order by usage_count desc;
$$;

revoke all on function public.report_events(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.report_customers(uuid) from public, anon;
revoke all on function public.report_packages(uuid) from public, anon;
grant execute on function public.report_events(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_customers(uuid) to authenticated;
grant execute on function public.report_packages(uuid) to authenticated;
