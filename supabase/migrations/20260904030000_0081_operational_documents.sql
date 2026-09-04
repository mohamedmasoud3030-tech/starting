-- ============================================================================
-- 0081: Operational and payroll document projections for the print center.
--
-- Forward-only companion to 0080. These four server-authoritative,
-- org-scoped, permission-gated projections back the remaining office
-- documents (team sheet, work order, payroll period sheet). Unknown data
-- never renders as zero: every model returns EMPTY when the caller lacks the
-- required visibility or the referenced record is not in the caller's org.
--
--   * event_team_sheet(p_org_id, p_event_id)
--       The event team sheet (كشف فريق المناسبة): the ACTIVE assignment
--       roster joined to the NON-CONFIDENTIAL attendance state — worst live
--       status (VOIDED rows excluded) plus earliest check-in / latest
--       check-out. Wage rates, expected compensation and earned amounts are
--       NOT projected, and none can be: they are not columns of this return
--       type. SECURITY DEFINER is deliberate — presence is operational data
--       for the event lead, while wage rows themselves stay cost-gated in
--       staff_attendance. Gate: any active org member.
--
--   * event_work_order_header(p_org_id, p_event_id)
--       The event work order (أمر تشغيل المناسبة) header: the canonical
--       event row plus the customer name and the responsible office user
--       (the member who last touched the event). Operations only — no
--       commercial totals, costs or margins exist in this projection.
--       Gate: any active org member.
--
--   * event_procurement_ops_lines(p_org_id, p_event_id)
--       Procurement/vendor dependencies for the work order: one row per
--       line of every live (non-CANCELLED) order linked to the event.
--       Agreed costs are confidential procurement data (can_read_cost at
--       the base tables) and are NOT projected here. Gate: any active org
--       member.
--
--   * payroll_period_sheet(p_org_id, p_from, p_to)
--       The payroll period sheet (كشف صرف / رواتب فترة): one row per host
--       with any recorded payroll fact inside [p_from, p_to] (inclusive).
--       Earned = live attendance rows in the period (same canonical
--       earned_amount ledger the per-event summaries use, VOIDED excluded);
--       advances = RECORDED staff_advances by advance_date; payouts =
--       RECORDED host_payouts by payout_date. Payout HEADERS are the cash
--       fact — their per-event allocation ledger (0076) only attributes
--       the same money to events for the per-event views, so summing
--       headers period-wide cannot double-count. balance_total = earned −
--       advances − payouts, all exact numeric. Gate: payroll.read — empty
--       for anyone else, never a row of fabricated zeros.
--
-- No new sequences: operational sheets are identified by the canonical
-- document numbers that already exist (event number / period range), per the
-- established numbering engine (next_document_number) which stays untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Event team sheet — roster + non-confidential presence.
-- ---------------------------------------------------------------------------
create or replace function public.event_team_sheet(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  staff_member_id uuid,
  staff_name text,
  staff_phone text,
  assignment_role text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  presence_status text,
  check_in timestamptz,
  check_out timestamptz,
  assignment_notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sm.id,
    sm.name,
    sm.phone,
    a.assignment_role::text,
    a.scheduled_start,
    a.scheduled_end,
    pres.presence_status,
    pres.check_in,
    pres.check_out,
    a.notes
  from public.events e
  join public.event_staff_assignments a
    on a.organization_id = e.organization_id
   and a.event_id = e.id
   and a.status = 'ACTIVE'
  join public.staff_members sm
    on sm.organization_id = a.organization_id
   and sm.id = a.staff_member_id
  left join lateral (
    select
      case
        when bool_or(x.status = 'LATE') then 'LATE'
        when bool_or(x.status = 'PARTIAL') then 'PARTIAL'
        when bool_or(x.status = 'PRESENT') then 'PRESENT'
        when bool_or(x.status = 'ABSENT') then 'ABSENT'
        else null
      end as presence_status,
      min(x.check_in) as check_in,
      max(x.check_out) as check_out
    from (
      select sa.status, sa.check_in, sa.check_out
      from public.staff_attendance sa
      where sa.organization_id = e.organization_id
        and sa.event_id = e.id
        and sa.staff_member_id = sm.id
        and sa.status <> 'VOIDED'
    ) x
  ) pres on true
  where e.organization_id = p_org_id
    and e.id = p_event_id
    and public.is_org_member(p_org_id)
  order by sm.name, a.scheduled_start, a.id;
$$;

revoke all on function public.event_team_sheet(uuid, uuid) from public, anon;
grant execute on function public.event_team_sheet(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Event work order header — canonical event truth for operations.
-- ---------------------------------------------------------------------------
create or replace function public.event_work_order_header(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  event_number text,
  title text,
  event_type text,
  status text,
  start_at timestamptz,
  end_at timestamptz,
  guest_count integer,
  venue_name text,
  location_details text,
  contact_name text,
  contact_phone text,
  notes text,
  customer_name text,
  responsible_user_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.event_number,
    e.title,
    e.event_type,
    e.status::text,
    e.start_at,
    e.end_at,
    e.guest_count,
    e.venue_name,
    e.location_details,
    e.contact_name,
    e.contact_phone,
    e.notes,
    cu.name as customer_name,
    coalesce(nullif(trim(coalesce(pr.full_name, '')), ''), '') as responsible_user_name
  from public.events e
  join public.customers cu
    on cu.organization_id = e.organization_id and cu.id = e.customer_id
  left join public.profiles pr
    on pr.id = e.updated_by
  where e.organization_id = p_org_id
    and e.id = p_event_id
    and public.is_org_member(p_org_id);
$$;

revoke all on function public.event_work_order_header(uuid, uuid) from public, anon;
grant execute on function public.event_work_order_header(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Procurement ops lines for the work order — no costs, no cancelled.
-- ---------------------------------------------------------------------------
create or replace function public.event_procurement_ops_lines(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  order_number text,
  supplier_name text,
  order_date date,
  expected_delivery_at timestamptz,
  order_status text,
  order_notes text,
  item_name text,
  unit text,
  quantity numeric(12,3)
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.order_number,
    coalesce(nullif(trim(coalesce(o.supplier_name_snapshot, '')), ''), s.name),
    o.order_date,
    o.expected_delivery_at,
    o.status::text,
    o.notes,
    l.description,
    l.unit,
    l.quantity::numeric(12,3)
  from public.procurement_orders o
  join public.procurement_order_lines l
    on l.organization_id = o.organization_id and l.order_id = o.id
  join public.suppliers s
    on s.organization_id = o.organization_id and s.id = o.supplier_id
  join public.events e
    on e.organization_id = o.organization_id and e.id = o.event_id
  where o.organization_id = p_org_id
    and o.event_id = p_event_id
    and o.status <> 'CANCELLED'
    and public.is_org_member(p_org_id)
  order by o.order_date, o.order_number, l.sort_order, l.id;
$$;

revoke all on function public.event_procurement_ops_lines(uuid, uuid) from public, anon;
grant execute on function public.event_procurement_ops_lines(uuid, uuid) to authenticated;

-- Cost-projection integrity is structural: neither the team sheet, the work
-- order header, nor the procurement ops lines carry any wage/rate/cost/
-- earned/compensation column (asserted against pg_attribute in the test).

-- ---------------------------------------------------------------------------
-- 4) Payroll period sheet — org-wide payables for one period (payroll.read).
-- ---------------------------------------------------------------------------
create or replace function public.payroll_period_sheet(
  p_org_id uuid,
  p_from date,
  p_to date
)
returns table (
  staff_member_id uuid,
  staff_name text,
  shift_count integer,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  balance_total numeric(14,3)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'PAYROLL_PERIOD_RANGE_REQUIRED' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'PAYROLL_PERIOD_RANGE_INVALID' using errcode = '22023';
  end if;
  -- Unknown visibility returns NOTHING (never zeros); the range itself is
  -- still validated first so a client bug surfaces deterministically.
  if auth.uid() is null or not public.can_read_payroll(p_org_id) then
    return;
  end if;

  return query
  with earned as (
    select
      a.organization_id,
      a.staff_member_id,
      count(*)::int as shift_count,
      sum(a.earned_amount)::numeric(14,3) as earned
    from public.staff_attendance a
    where a.organization_id = p_org_id
      and a.status <> 'VOIDED'
      and a.attendance_date between p_from and p_to
    group by a.organization_id, a.staff_member_id
  ),
  adv as (
    select
      v.organization_id,
      v.staff_member_id,
      sum(v.amount)::numeric(14,3) as advances
    from public.staff_advances v
    where v.organization_id = p_org_id
      and v.status = 'RECORDED'
      and v.advance_date between p_from and p_to
    group by v.organization_id, v.staff_member_id
  ),
  pay as (
    select
      p.organization_id,
      p.staff_member_id,
      sum(p.amount)::numeric(14,3) as payouts
    from public.host_payouts p
    where p.organization_id = p_org_id
      and p.status = 'RECORDED'
      and p.payout_date between p_from and p_to
    group by p.organization_id, p.staff_member_id
  ),
  hosts as (
    select earned.organization_id, earned.staff_member_id from earned
    union
    select adv.organization_id, adv.staff_member_id from adv
    union
    select pay.organization_id, pay.staff_member_id from pay
  )
  select
    sm.id,
    sm.name,
    coalesce(e.shift_count, 0),
    coalesce(e.earned, 0)::numeric(14,3),
    coalesce(a.advances, 0)::numeric(14,3),
    coalesce(p.payouts, 0)::numeric(14,3),
    (coalesce(e.earned, 0) - coalesce(a.advances, 0) - coalesce(p.payouts, 0))::numeric(14,3)
  from hosts h
  join public.staff_members sm
    on sm.organization_id = h.organization_id and sm.id = h.staff_member_id
  left join earned e
    on e.organization_id = h.organization_id and e.staff_member_id = h.staff_member_id
  left join adv a
    on a.organization_id = h.organization_id and a.staff_member_id = h.staff_member_id
  left join pay p
    on p.organization_id = h.organization_id and p.staff_member_id = h.staff_member_id
  order by sm.name, sm.id;
end;
$$;

revoke all on function public.payroll_period_sheet(uuid, date, date) from public, anon;
grant execute on function public.payroll_period_sheet(uuid, date, date) to authenticated;
