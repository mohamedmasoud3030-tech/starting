-- ============================================================================
-- 0070 — Smart Alerts Engine + Today Command Center (Phase E2/E3)
--
-- ONE canonical, server-authoritative alert source. No alert is computed inside
-- a React component; every screen consumes this function. Alerts are
-- organization-scoped (membership guard), permission-aware (finance alerts only
-- for cost roles), explainable (title + explanation), and drillable (a
-- destination path pointing at the underlying record).
--
-- Readiness is reused from the canonical `event_readiness_batch` — it is never
-- re-derived here. Severity is limited to INFO / WARNING / CRITICAL (CRITICAL is
-- reserved for integrity, which lives in the Integrity Center, not here).
-- ============================================================================

create or replace function public.management_alerts(
  p_org_id uuid,
  p_now timestamptz default now(),
  p_limit int default 50
)
returns table(
  alert_type text,
  severity text,
  entity_type text,
  entity_id uuid,
  title text,
  explanation text,
  destination text,
  event_id uuid,
  customer_id uuid,
  detected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active_ids uuid[];
  v_can_cost boolean;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_can_cost := public.can_read_cost(p_org_id);

  select coalesce(array_agg(id order by start_at), '{}'::uuid[]) into v_active_ids
  from public.events
  where organization_id = p_org_id
    and status not in ('CLOSED','CANCELLED');

  -- 1. Readiness shortfalls (staff / equipment / combined) for active events.
  return query
  select
    case
      when r.staff_missing > 0 and r.equipment_shortage > 0 then 'EVENT_NOT_READY_FOR_DISPATCH'
      when r.staff_missing > 0 then 'EVENT_STAFF_SHORTAGE'
      else 'EVENT_EQUIPMENT_SHORTAGE'
    end,
    'WARNING',
    'event',
    e.id,
    e.title || ' — ' || case
      when r.staff_missing > 0 and r.equipment_shortage > 0
        then 'فريق ومعدات ناقصة'
      when r.staff_missing > 0
        then 'الفريق ناقص ' || r.staff_missing::text
      else 'المعدات ناقصة ' || r.equipment_shortage::text
    end,
    'الجاهزية غير مكتملة لهذه المناسبة',
    '/events/' || e.id::text,
    e.id,
    e.customer_id,
    p_now
  from public.event_readiness_batch(p_org_id, v_active_ids) r
  join public.events e on e.id = r.event_id and e.organization_id = p_org_id
  where r.staff_missing > 0 or r.equipment_shortage > 0;

  -- 2. Event approaching its start time with incomplete preparation.
  return query
  select
    'EVENT_APPROACHING_UNPREPARED',
    'WARNING',
    'event',
    e.id,
    e.title || ' — يقترب موعدها والتجهيز غير مكتمل',
    'تبدأ المناسبة خلال 24 ساعة والجاهزية غير مكتملة',
    '/events/' || e.id::text,
    e.id,
    e.customer_id,
    p_now
  from public.events e
  join public.event_readiness_batch(p_org_id, v_active_ids) r on r.event_id = e.id
  where e.organization_id = p_org_id
    and e.status in ('CONFIRMED','PREPARING')
    and e.start_at > p_now
    and e.start_at <= p_now + interval '24 hours'
    and (r.staff_missing > 0 or r.equipment_shortage > 0);

  -- 3. Commercial quote alerts (expiring / expired-unresolved / accepted-not-converted).
  return query
  select
    case
      when q.status = 'ISSUED' and q.valid_until is not null and q.valid_until < p_now then 'QUOTE_EXPIRED_UNRESOLVED'
      when q.status = 'ISSUED' and q.valid_until is not null and q.valid_until <= p_now + interval '3 days' then 'QUOTE_EXPIRING'
      else 'ACCEPTED_QUOTE_NOT_CONVERTED'
    end,
    case
      when q.status = 'ISSUED' and q.valid_until is not null and q.valid_until <= p_now + interval '3 days' and q.valid_until >= p_now then 'INFO'
      else 'WARNING'
    end,
    'quote',
    q.id,
    case
      when q.status = 'ACCEPTED' then 'عرض مقبول لم يُحوَّل بعد إلى مناسبة'
      else 'عرض سعر ' || coalesce(q.quotation_number, '') || ' — ' || (q.customer_name_snapshot)
    end,
    case
      when q.status = 'ACCEPTED' then 'اعتمد العميل هذا العرض لكنه لم يتحول إلى مناسبة مؤكدة'
      when q.valid_until < p_now then 'انتهت صلاحية العرض ولم يُحسم بعد'
      else 'تقترب صلاحية العرض من الانتهاء'
    end,
    '/quotes/' || q.id::text,
    null::uuid,
    q.customer_id,
    p_now
  from public.quotations_customer q
  where q.organization_id = p_org_id
    and q.event_id is null
    and (
      q.status = 'ACCEPTED'
      or (q.status = 'ISSUED' and q.valid_until is not null and q.valid_until <= p_now + interval '3 days')
    );

  -- 4. Finance alerts (cost-role only).
  if v_can_cost then
    return query
    -- 4a. Outstanding balance.
    select
      'EVENT_BALANCE_OUTSTANDING',
      'WARNING',
      'event',
      f.event_id,
      f.event_number || ' — متبقٍ على العميل ' || f.outstanding_balance::text || ' OMR',
      'لم يُحصَّل كامل قيمة هذه المناسبة بعد',
      '/events/' || f.event_id::text,
      f.event_id,
      (select e.customer_id from public.events e where e.id = f.event_id),
      p_now
    from public.event_finance_summaries f
    where f.organization_id = p_org_id
      and f.outstanding_balance > 0
      and f.event_status <> 'CANCELLED';

    return query
    -- 4b. Operationally completed but financially open.
    select
      'COMPLETED_EVENT_FINANCIALLY_OPEN',
      'WARNING',
      'event',
      e.id,
      e.event_number || ' — مكتملة تشغيلياً وما زالت مفتوحة مالياً',
      'انتهت المناسبة تشغيلياً لكن لم تُغلق مالياً بعد',
      '/events/' || e.id::text,
      e.id,
      e.customer_id,
      p_now
    from public.events e
    where e.organization_id = p_org_id
      and e.status = 'CLOSED'
      and not exists (
        select 1 from public.event_financial_closures c
        where c.event_id = e.id and c.reopened_at is null
      );

    return query
    -- 4c. Overdue equipment return.
    select
      'OVERDUE_EQUIPMENT_RETURN',
      'WARNING',
      'event',
      e.id,
      e.title || ' — معدات ما زالت في الخارج',
      'انتهى موعد المناسبة وما زالت معداتها غير مرجعة',
      '/events/' || e.id::text,
      e.id,
      e.customer_id,
      p_now
    from public.events e
    where e.organization_id = p_org_id
      and e.status in ('DISPATCHED','RETURNING')
      and e.end_at < p_now
      and exists (
        select 1 from public.event_warehouse_lines w
        where w.event_id = e.id and w.outstanding_quantity > 0
      );
  end if;

  return;
end;
$$;

revoke all on function public.management_alerts(uuid, timestamptz, int) from public, anon;
grant execute on function public.management_alerts(uuid, timestamptz, int) to authenticated;
