-- ============================================================================
-- 0044 — S9 owner attention: today's attendance gaps
--
-- Surfaces, for the owner attention center, the events happening today that
-- have ACTIVE staff assignments but fewer (or zero) attendance records logged
-- for today — i.e. "this hospitality is on, but nobody has been checked in
-- yet". Reveals no money, so any org member may call it.
-- ============================================================================

create or replace function public.today_attendance_gaps(
  p_org_id uuid,
  p_now timestamptz default now()
)
returns table (
  event_id uuid,
  event_title text,
  event_number text,
  assignment_count integer,
  attendance_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text := 'Asia/Muscat';
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role,
    'WAREHOUSE'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select
    e.id as event_id,
    e.title as event_title,
    e.event_number as event_number,
    count(distinct a.id)::int as assignment_count,
    coalesce(att.cnt, 0)::int as attendance_count
  from public.events e
  join public.event_staff_assignments a
    on a.organization_id = e.organization_id
   and a.event_id = e.id
   and a.status = 'ACTIVE'
  left join lateral (
    select count(*) as cnt
    from public.staff_attendance sa
    where sa.organization_id = e.organization_id
      and sa.event_id = e.id
      and sa.status <> 'VOIDED'
      and sa.attendance_date = (p_now at time zone v_tz)::date
  ) att on true
  where e.organization_id = p_org_id
    and e.status <> 'CANCELLED'
    and (e.start_at at time zone v_tz)::date = (p_now at time zone v_tz)::date
  group by e.id, e.title, e.event_number, att.cnt
  having coalesce(att.cnt, 0) < count(distinct a.id);
end;
$$;

grant execute on function public.today_attendance_gaps(uuid, timestamptz) to authenticated;
