-- ============================================================================
-- 0040 — S9 RLS, least privilege and stable staff payroll read models
--
-- Host payroll (attendance earned amounts, advances, payouts) is financial
-- data: readable only by can_read_cost() roles (OWNER/MANAGER/ACCOUNTANT) at
-- the data boundary — never merely hidden in the UI. SUPERVISOR may RECORD
-- attendance (command authorization) but cannot read wage amounts.
--
-- The base ledgers expose no client write policy; commands are the only
-- mutation path. The idempotency register is internal command machinery and
-- exposes no client read model.
-- ============================================================================

alter table public.staff_payroll_command_idempotency enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.staff_advances enable row level security;
alter table public.host_payouts enable row level security;

create policy staff_attendance_cost_reader_select on public.staff_attendance
  for select using (public.can_read_cost(organization_id));
create policy staff_advances_cost_reader_select on public.staff_advances
  for select using (public.can_read_cost(organization_id));
create policy host_payouts_cost_reader_select on public.host_payouts
  for select using (public.can_read_cost(organization_id));

-- No INSERT/UPDATE/DELETE policy on any S9 table.

-- ---------------------------------------------------------------------------
-- staff_attendance_summaries — per attendance record with staff + event context.
-- ---------------------------------------------------------------------------
create view public.staff_attendance_summaries as
select
  a.id as attendance_id,
  a.organization_id,
  a.event_id,
  e.event_number,
  e.title as event_title,
  a.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  a.assignment_id,
  a.attendance_date,
  a.shift,
  a.check_in,
  a.check_out,
  a.break_minutes,
  a.hours_worked,
  a.status as attendance_status,
  a.wage_method,
  a.wage_rate,
  a.earned_amount,
  a.notes,
  a.recorded_by,
  a.voided_by,
  a.voided_at,
  a.void_reason,
  a.status as record_status,
  a.created_at
from public.staff_attendance a
join public.staff_members s
  on s.organization_id = a.organization_id and s.id = a.staff_member_id
join public.events e
  on e.organization_id = a.organization_id and e.id = a.event_id
where public.can_read_cost(a.organization_id);

-- ---------------------------------------------------------------------------
-- staff_advances_summaries — per advance with staff context.
-- ---------------------------------------------------------------------------
create view public.staff_advances_summaries as
select
  adv.id as advance_id,
  adv.organization_id,
  adv.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  adv.amount,
  adv.advance_date,
  adv.reason,
  adv.status,
  adv.recorded_by,
  adv.voided_by,
  adv.voided_at,
  adv.void_reason,
  adv.created_at
from public.staff_advances adv
join public.staff_members s
  on s.organization_id = adv.organization_id and s.id = adv.staff_member_id
where public.can_read_cost(adv.organization_id);

-- ---------------------------------------------------------------------------
-- host_payout_summaries — per payout with staff + event context.
-- ---------------------------------------------------------------------------
create view public.host_payout_summaries as
select
  p.id as payout_id,
  p.organization_id,
  p.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  p.event_id,
  e.event_number,
  p.amount,
  p.payout_date,
  p.payment_method,
  p.reference,
  p.reason,
  p.status,
  p.recorded_by,
  p.voided_by,
  p.voided_at,
  p.void_reason,
  p.created_at
from public.host_payouts p
join public.staff_members s
  on s.organization_id = p.organization_id and s.id = p.staff_member_id
left join public.events e
  on e.organization_id = p.organization_id and e.id = p.event_id
where public.can_read_cost(p.organization_id);

-- ---------------------------------------------------------------------------
-- host_event_payroll_summaries — per (organization, staff_member, event):
-- earned (due), advances, payouts, and derived paid / late. One row per host
-- per event, for the event payroll tab and the host archive.
-- ---------------------------------------------------------------------------
create view public.host_event_payroll_summaries as
select
  a.organization_id,
  a.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  a.event_id,
  e.event_number,
  e.title as event_title,
  count(*)::int as attendance_count,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as earned_total,
  coalesce((
    select sum(adv.amount) from public.staff_advances adv
     where adv.organization_id = a.organization_id
       and adv.staff_member_id = a.staff_member_id
       and adv.status = 'RECORDED'
  ), 0)::numeric(14,3) as advances_total,
  coalesce((
    select sum(p.amount) from public.host_payouts p
     where p.organization_id = a.organization_id
       and p.staff_member_id = a.staff_member_id
       and p.event_id = a.event_id
       and p.status = 'RECORDED'
  ), 0)::numeric(14,3) as payouts_total,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as due_total,
  (
    coalesce((
      select sum(adv.amount) from public.staff_advances adv
       where adv.organization_id = a.organization_id
         and adv.staff_member_id = a.staff_member_id
         and adv.status = 'RECORDED'
    ), 0)
    + coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as paid_total,
  (
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)
    - coalesce((
      select sum(adv.amount) from public.staff_advances adv
       where adv.organization_id = a.organization_id
         and adv.staff_member_id = a.staff_member_id
         and adv.status = 'RECORDED'
    ), 0)
    - coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as late_total
from public.staff_attendance a
join public.staff_members s
  on s.organization_id = a.organization_id and s.id = a.staff_member_id
join public.events e
  on e.organization_id = a.organization_id and e.id = a.event_id
where public.can_read_cost(a.organization_id)
group by a.organization_id, a.staff_member_id, s.name, s.staff_type, a.event_id, e.event_number, e.title;

-- ---------------------------------------------------------------------------
-- get_host_payroll_summary — single authoritative payroll rollup for a host,
-- optionally scoped to one event. Returns one row.
-- ---------------------------------------------------------------------------
create or replace function public.get_host_payroll_summary(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid default null
)
returns table (
  staff_member_id uuid,
  event_id uuid,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  due_total numeric(14,3),
  paid_total numeric(14,3),
  late_total numeric(14,3),
  attendance_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_read_cost(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select
    p_staff_member_id as staff_member_id,
    p_event_id as event_id,
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'
      and (p_event_id is null or a.event_id = p_event_id)), 0)::numeric(14,3) as earned_total,
    coalesce((
      select sum(adv.amount) from public.staff_advances adv
       where adv.organization_id = p_org_id
         and adv.staff_member_id = p_staff_member_id
         and adv.status = 'RECORDED'
    ), 0)::numeric(14,3) as advances_total,
    coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = p_org_id
         and p.staff_member_id = p_staff_member_id
         and (p_event_id is null or p.event_id = p_event_id)
         and p.status = 'RECORDED'
    ), 0)::numeric(14,3) as payouts_total,
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'
      and (p_event_id is null or a.event_id = p_event_id)), 0)::numeric(14,3) as due_total,
    (
      coalesce((
        select sum(adv.amount) from public.staff_advances adv
         where adv.organization_id = p_org_id
           and adv.staff_member_id = p_staff_member_id
           and adv.status = 'RECORDED'
      ), 0)
      + coalesce((
        select sum(p.amount) from public.host_payouts p
         where p.organization_id = p_org_id
           and p.staff_member_id = p_staff_member_id
           and (p_event_id is null or p.event_id = p_event_id)
           and p.status = 'RECORDED'
      ), 0)
    )::numeric(14,3) as paid_total,
    (
      coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'
        and (p_event_id is null or a.event_id = p_event_id)), 0)
      - coalesce((
        select sum(adv.amount) from public.staff_advances adv
         where adv.organization_id = p_org_id
           and adv.staff_member_id = p_staff_member_id
           and adv.status = 'RECORDED'
      ), 0)
      - coalesce((
        select sum(p.amount) from public.host_payouts p
         where p.organization_id = p_org_id
           and p.staff_member_id = p_staff_member_id
           and (p_event_id is null or p.event_id = p_event_id)
           and p.status = 'RECORDED'
      ), 0)
    )::numeric(14,3) as late_total,
    count(a.id) filter (where a.status <> 'VOIDED'
      and (p_event_id is null or a.event_id = p_event_id))::int as attendance_count
  from public.staff_attendance a
  where a.organization_id = p_org_id
    and a.staff_member_id = p_staff_member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Explicit Supabase default-grant revocation. Raw tables are not frontend
-- contracts; only the stable read models are granted SELECT.
-- ---------------------------------------------------------------------------
revoke all on table
  public.staff_payroll_command_idempotency,
  public.staff_attendance,
  public.staff_advances,
  public.host_payouts,
  public.staff_attendance_summaries,
  public.staff_advances_summaries,
  public.host_payout_summaries,
  public.host_event_payroll_summaries
  from anon, authenticated;

grant select on table
  public.staff_attendance_summaries,
  public.staff_advances_summaries,
  public.host_payout_summaries,
  public.host_event_payroll_summaries
  to authenticated;

grant execute on function
  public.get_host_payroll_summary(uuid, uuid, uuid)
  to authenticated;
