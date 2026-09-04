-- ============================================================================
-- 0082 — Canonical operational readiness core, Event Command Center, and the
--        Today-daily-operations projections.
--
-- WHY THIS EXISTS
--   Before this migration the repository carried MULTIPLE readiness variants:
--   the per-event `event_readiness` (0015/0019), the batched
--   `event_readiness_batch` (0060), plus frontend helpers that translated
--   their statuses into prose. They drifted (staff rounding differs; the
--   batch had no consumables/procurement notion; UI screens invented
--   STAFF_MISSING/EQUIPMENT_SHORTAGE vocabularies). This migration converges
--   everything onto ONE server formula — `event_operational_readiness` — and
--   every former entry point becomes a thin wrapper over it. There is no
--   second formula anywhere else; the frontend renders the model.
--
-- READINESS IS OPERATIONAL — FINANCE NEVER TOUCHES IT
--   READY/NOT_READY considers ONLY: staff assignment, pre-event equipment
--   reservations, consumables issued to the event, and pending procurement.
--   Outstanding customer money is a SEPARATE commercial block (the command
--   center renders both side by side; a NOT_READY event may have zero money
--   missing, and a READY event may still have an outstanding balance — both
--   are normal, by design).
--
-- New surfaces:
--   * event_operational_readiness(p_org_id, p_event_id) → jsonb (THE core)
--   * event_readiness / event_readiness_batch          → wrappers over core
--   * event_command_center(p_org_id, p_event_id)       → jsonb overview model
--   * today_collections(p_org_id, p_now)               → "يحتاج تحصيل"
--   * today_closure_candidates(p_org_id, p_now)        → "جاهزة للإغلاق"
--   * management_alerts / management_metrics redefined to consume the new
--     vocabulary (bodies otherwise preserved from 0070/0071 verbatim).
--
-- `event_attendance_status` and everything biometric live in 0083 (they read
-- columns created there).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE canonical core. One formula, machine-readable reason codes.
-- ---------------------------------------------------------------------------
create or replace function public.event_operational_readiness(
  p_org_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff_required int;
  v_staff_assigned int;
  v_staff_missing int;
  v_equipment_shortage int;
  v_consumables_shortage int;
  v_procurement_pending int;
  v_reasons jsonb := '[]'::jsonb;
  v_status text;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.events e
    where e.organization_id = p_org_id and e.id = p_event_id
  ) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Staff: required = the commercial plan's STAFF lines rounded up to whole
  -- people (ceil of the SUM, so 2.5+2.5 guest-hosts = 5, matching what the
  -- office actually schedules); assigned = ACTIVE assignments.
  select
    coalesce(ceil(sum(l.quantity) filter (where l.item_type = 'STAFF')), 0)::int,
    0
  into v_staff_required
  from public.event_commercial_lines l
  where l.organization_id = p_org_id and l.event_id = p_event_id;

  select count(*)::int into v_staff_assigned
  from public.event_staff_assignments a
  where a.organization_id = p_org_id
    and a.event_id = p_event_id
    and a.status = 'ACTIVE';

  v_staff_missing := greatest(v_staff_required - v_staff_assigned, 0);

  -- Equipment (PRE-EVENT semantics): a line is covered when ACTIVE
  -- reservations exist for its catalog item for THIS event. Dispatched/
  -- returned states are lifecycle, not pre-event readiness. Same aggregation
  -- the mature per-event gate always used (sum of per-line quantity gaps), so
  -- no previously-READY event flips on upgrade.
  select coalesce(sum(greatest(ceil(l.quantity)::int - coalesce(r.qty, 0), 0)), 0)::int
  into v_equipment_shortage
  from public.event_commercial_lines l
  left join (
    select ec.catalog_item_id, sum(er.quantity)::int as qty
    from public.event_equipment_reservations er
    join public.equipment_capacity ec on ec.id = er.equipment_capacity_id
    where er.event_id = p_event_id and er.status = 'ACTIVE'
    group by ec.catalog_item_id
  ) r on r.catalog_item_id = l.source_catalog_item_id
  where l.organization_id = p_org_id
    and l.event_id = p_event_id
    and l.item_type = 'REUSABLE_EQUIPMENT';

  -- Consumables: required per catalog item vs the quantity ISSUED to the
  -- event (net of returns). Only material actually staged for the event
  -- covers the line.
  with needed as (
    select l.source_catalog_item_id as catalog_item_id,
           sum(l.quantity)::numeric(14,3) as required
    from public.event_commercial_lines l
    where l.organization_id = p_org_id
      and l.event_id = p_event_id
      and l.item_type = 'CONSUMABLE'
    group by l.source_catalog_item_id
  ), prepared as (
    select s.catalog_item_id,
           coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0)
         - coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0)
             as issued
    from public.consumable_movements m
    join public.consumable_stock_items s
      on s.organization_id = m.organization_id and s.id = m.stock_item_id
    where m.organization_id = p_org_id and m.event_id = p_event_id
    group by s.catalog_item_id
  )
  select count(*)::int into v_consumables_shortage
  from needed n
  left join prepared p on p.catalog_item_id = n.catalog_item_id
  where coalesce(p.issued, 0) < n.required;

  -- Procurement: only genuinely fulfilled orders satisfy the event.
  -- DRAFT (not yet committed) and CANCELLED never block; APPROVED, SENT,
  -- CONFIRMED and PARTIALLY_RECEIVED are "on their way, not in hand".
  select count(*)::int into v_procurement_pending
  from public.procurement_orders o
  where o.organization_id = p_org_id
    and o.event_id = p_event_id
    and o.status in ('APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED');

  if v_staff_missing > 0 then
    v_reasons := v_reasons || jsonb_build_array('STAFF_SHORTAGE');
  end if;
  if v_equipment_shortage > 0 then
    v_reasons := v_reasons || jsonb_build_array('EQUIPMENT_SHORTAGE');
  end if;
  if v_consumables_shortage > 0 then
    v_reasons := v_reasons || jsonb_build_array('CONSUMABLE_SHORTAGE');
  end if;
  if v_procurement_pending > 0 then
    v_reasons := v_reasons || jsonb_build_array('PROCUREMENT_PENDING');
  end if;

  v_status := case when jsonb_array_length(v_reasons) = 0 then 'READY' else 'NOT_READY' end;

  return jsonb_build_object(
    'status', v_status,
    'reasons', v_reasons,
    'staff_required', v_staff_required,
    'staff_assigned', v_staff_assigned,
    'staff_missing', v_staff_missing,
    'equipment_shortage', v_equipment_shortage,
    'consumables_shortage', v_consumables_shortage,
    'procurement_pending', v_procurement_pending
  );
end;
$$;

revoke all on function public.event_operational_readiness(uuid, uuid) from public, anon;
grant execute on function public.event_operational_readiness(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The former entry points become wrappers — one formula, many doors.
--
--    * `event_readiness` keeps its (jsonb) contract and STILL emits the
--      literal 'READY' on success: the 0079 dispatch gate compares
--      `->>'status' <> 'READY'` and must keep working unchanged.
--    * `event_readiness_batch` keeps every column 0070/0071 read
--      (event_id/status/staff_missing/equipment_shortage) and adds the
--      canonical fields. Old status spellings (STAFF_MISSING, …) are gone —
--      consumers migrated with this migration; readiness tests updated to
--      the converged vocabulary.
-- ---------------------------------------------------------------------------
create or replace function public.event_readiness(p_org_id uuid, p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.event_operational_readiness(p_org_id, p_event_id);
$$;

revoke all on function public.event_readiness(uuid, uuid) from public, anon;
grant execute on function public.event_readiness(uuid, uuid) to authenticated;

drop function if exists public.event_readiness_batch(uuid, uuid[]);
create function public.event_readiness_batch(
  p_org_id uuid,
  p_event_ids uuid[]
)
returns table (
  event_id uuid,
  status text,
  staff_missing int,
  equipment_shortage int,
  reasons text[],
  staff_required int,
  staff_assigned int,
  consumables_shortage int,
  procurement_pending int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ids.id,
    r ->> 'status',
    (r ->> 'staff_missing')::int,
    (r ->> 'equipment_shortage')::int,
    array(select jsonb_array_elements_text(r -> 'reasons')),
    (r ->> 'staff_required')::int,
    (r ->> 'staff_assigned')::int,
    (r ->> 'consumables_shortage')::int,
    (r ->> 'procurement_pending')::int
  from unnest(p_event_ids) as ids(id)
  cross join lateral (
    select case
      when exists (
        select 1 from public.events e
        where e.organization_id = p_org_id and e.id = ids.id
      ) and public.is_org_member(p_org_id)
      then public.event_operational_readiness(p_org_id, ids.id)
      else null
    end as r
  ) core
  where core.r is not null;
$$;

revoke all on function public.event_readiness_batch(uuid, uuid[]) from public, anon;
grant execute on function public.event_readiness_batch(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Event Command Center — the one round trip behind the overview.
--
--    Shape is the client contract in src/features/events/commandCenter.api.ts.
--    Money columns are exact decimal TEXT (never floats) and null unless the
--    caller may read costs; `commercial.attention` (needs-collection) is a
--    boolean every event viewer gets so operations can route the office to
--    the right human — without any amount being disclosed.
-- ---------------------------------------------------------------------------
create or replace function public.event_command_center(p_org_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_readiness jsonb;
  v_event public.events;
  v_assigned int;
  v_checked_in int;
  v_checked_out int;
  v_inside int;
  v_warehouse_lines int;
  v_team_rows int;
  v_quotation_status text;
  v_invoice_status text;
  v_accepted bool;
  v_value numeric(14,3);
  v_collected numeric(14,3);
  v_outstanding numeric(14,3);
  v_can_cost boolean;
  v_next jsonb;
  v_day_match boolean;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_event from public.events
   where organization_id = p_org_id and id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_readiness := public.event_operational_readiness(p_org_id, p_event_id);

  -- Attendance progress (live rows only; VOIDED excluded everywhere).
  select
    count(*) filter (where a.status = 'ACTIVE')::int,
    0, 0, 0
  into v_assigned, v_checked_in, v_checked_out, v_inside
  from public.event_staff_assignments a
  where a.organization_id = p_org_id and a.event_id = p_event_id;

  select
    count(*) filter (where s.check_in is not null
                       and s.status <> 'VOIDED' and s.status <> 'ABSENT')::int,
    count(*) filter (where s.check_out is not null
                       and s.status <> 'VOIDED' and s.status <> 'ABSENT')::int,
    count(*) filter (where s.check_in is not null and s.check_out is null
                       and s.status <> 'VOIDED')::int
  into v_checked_in, v_checked_out, v_inside
  from public.staff_attendance s
  where s.organization_id = p_org_id and s.event_id = p_event_id;

  -- Documents: quotation / invoice headline state + sheet sizes.
  select coalesce(
    q.status::text,
    case when e.accepted_quotation_id is not null then 'ACCEPTED' else 'NONE' end
  )
  into v_quotation_status
  from public.events e
  left join public.quotations q on q.organization_id = e.organization_id
    and q.id = e.accepted_quotation_id
  where e.id = p_event_id;

  select i.status::text into v_invoice_status
  from public.invoices i
  where i.organization_id = p_org_id and i.event_id = p_event_id
  order by i.created_at desc
  limit 1;

  select count(*)::int into v_warehouse_lines
  from public.event_warehouse_lines w
  where w.event_id = p_event_id;

  select count(*)::int into v_team_rows
  from public.event_team_sheet(p_org_id, p_event_id);

  -- Commercial block — the canonical quotation-minus-recorded-payments
  -- arithmetic identical to event_finance_summaries (0068). Amounts only
  -- with cost visibility; attention (boolean) for any event viewer.
  v_accepted := v_event.accepted_quotation_id is not null;
  select coalesce(q.total_selling, 0)::numeric(14,3) into v_value
  from public.quotations q
  where q.organization_id = p_org_id and q.id = v_event.accepted_quotation_id;
  v_value := coalesce(v_value, 0);
  select coalesce(sum(p.amount), 0)::numeric(14,3) into v_collected
  from public.customer_payments p
  where p.organization_id = p_org_id and p.event_id = p_event_id
    and p.status = 'RECORDED';
  v_outstanding := v_value - coalesce(v_collected, 0);
  v_can_cost := public.can_read_cost(p_org_id);

  -- Deterministic next action (server-chosen; the client never re-prioritizes).
  v_next := case
    when (v_readiness -> 'reasons') @> '["STAFF_SHORTAGE"]'::jsonb
      then jsonb_build_object('code', 'COMPLETE_STAFF_ASSIGNMENT', 'label', 'أكمل إسناد الفريق')
    when (v_readiness -> 'reasons') @> '["EQUIPMENT_SHORTAGE"]'::jsonb
      then jsonb_build_object('code', 'COVER_EQUIPMENT', 'label', 'غطِّ نقص المعدات')
    when (v_readiness -> 'reasons') @> '["CONSUMABLE_SHORTAGE"]'::jsonb
      then jsonb_build_object('code', 'COVER_CONSUMABLES', 'label', 'جهّز المواد الاستهلاكية')
    when (v_readiness -> 'reasons') @> '["PROCUREMENT_PENDING"]'::jsonb
      then jsonb_build_object('code', 'FOLLOW_UP_PROCUREMENT', 'label', 'تابع أوامر الشراء')
    when v_readiness ->> 'status' = 'READY'
     and v_event.status in ('CONFIRMED', 'PREPARING')
      then jsonb_build_object('code', 'PROCEED_DISPATCH', 'label', 'أنهِ التجهيز وأكّد الإرسال')
    else null
  end;

  -- Event-day attendance prompt: today (Muscat), ready, team not fully in.
  v_day_match := (v_event.start_at at time zone 'Asia/Muscat')::date
              = (now() at time zone 'Asia/Muscat')::date;
  if v_next is null
     and v_day_match
     and v_event.status in ('DISPATCHED', 'IN_PROGRESS')
     and v_assigned > 0
     and v_checked_in < v_assigned then
    v_next := jsonb_build_object('code', 'RECORD_ATTENDANCE', 'label', 'سجّل حضور الفريق المتبقي');
  end if;

  return jsonb_build_object(
    'operational', v_readiness || jsonb_build_object(
           'equipment_lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'label', l.description,
                      'required', ceil(l.quantity)::int,
                      'reserved', coalesce(r.qty, 0),
                      'missing', greatest(ceil(l.quantity)::int - coalesce(r.qty, 0), 0)
                    ) order by l.description)
             from public.event_commercial_lines l
             left join (
               select ec.catalog_item_id, sum(er.quantity)::int as qty
               from public.event_equipment_reservations er
               join public.equipment_capacity ec on ec.id = er.equipment_capacity_id
               where er.event_id = p_event_id and er.status = 'ACTIVE'
               group by ec.catalog_item_id
             ) r on r.catalog_item_id = l.source_catalog_item_id
             where l.organization_id = p_org_id and l.event_id = p_event_id
               and l.item_type = 'REUSABLE_EQUIPMENT'
               and greatest(ceil(l.quantity)::int - coalesce(r.qty, 0), 0) > 0
           ), '[]'::jsonb),
           'consumable_lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'label', n.description,
                      'required', n.required,
                      'prepared', coalesce(prep.issued, 0),
                      'missing', greatest(n.required - coalesce(prep.issued, 0), 0),
                      'unit', n.unit
                    ) order by n.description)
             from (
               select l.description, l.unit, sum(l.quantity)::numeric(14,3) as required,
                      l.source_catalog_item_id
               from public.event_commercial_lines l
               where l.organization_id = p_org_id and l.event_id = p_event_id
                 and l.item_type = 'CONSUMABLE'
               group by l.source_catalog_item_id, l.description, l.unit
             ) n
             left join (
               select s.catalog_item_id,
                      coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0)
                    - coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0)
                        as issued
               from public.consumable_movements m
               join public.consumable_stock_items s
                 on s.organization_id = m.organization_id and s.id = m.stock_item_id
               where m.organization_id = p_org_id and m.event_id = p_event_id
               group by s.catalog_item_id
             ) prep on prep.catalog_item_id = n.source_catalog_item_id
             where coalesce(prep.issued, 0) < n.required
           ), '[]'::jsonb),
           'procurement_orders', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'order_number', o.order_number,
                      'supplier_name', s.name,
                      'order_status', o.status::text
                    ) order by o.order_number)
             from public.procurement_orders o
             join public.suppliers s on s.id = o.supplier_id
             where o.organization_id = p_org_id and o.event_id = p_event_id
               and o.status in ('APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED')
           ), '[]'::jsonb)
         ),
    'attendance', jsonb_build_object(
      'assigned', v_assigned,
      'checked_in', v_checked_in,
      'checked_out', v_checked_out,
      'pending_confirmations', v_inside
    ),
    'documents', jsonb_build_object(
      'quotation_status', v_quotation_status,
      'invoice_status', v_invoice_status,
      'warehouse_sheet_lines', v_warehouse_lines,
      'team_sheet_rows', v_team_rows
    ),
    'commercial', jsonb_build_object(
      'attention', v_accepted and v_outstanding > 0,
      'has_accepted_quotation', v_accepted,
      'value', case when v_can_cost then v_value::text else null end,
      'collected', case when v_can_cost then v_collected::text else null end,
      'outstanding', case when v_can_cost then v_outstanding::text else null end
    ),
    'next_action', v_next
  );
end;
$$;

revoke all on function public.event_command_center(uuid, uuid) from public, anon;
grant execute on function public.event_command_center(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Today: «يحتاج تحصيل» — events whose collection work is live.
--
--    Muscat day boundaries are computed FROM p_now SERVER-SIDE (near-midnight
--    correctness is a SQL concern, not the browser's clock/timezone). Rows:
--    today's events or already-started-but-unclosed events with an accepted
--    quotation and a positive balance. Amounts are exact decimal text and the
--    whole projection is gated: no cost/payment capability → no rows (never
--    a leak-shaped empty success on a partial key).
-- ---------------------------------------------------------------------------
create or replace function public.today_collections(
  p_org_id uuid,
  p_now timestamptz default now()
)
returns table (
  event_id uuid,
  event_number text,
  event_title text,
  customer_name text,
  start_at timestamptz,
  -- Exact decimal TEXT on the wire (canonical convention for money reads).
  outstanding text,
  overdue boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The projection is money-facing: a caller without cost or payment
  -- capability is REFUSED (an empty success would invite probing), matching
  -- how every other financial read model behaves.
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (public.can_read_cost(p_org_id) or public.has_permission(p_org_id, 'payment.record')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
  with day as (
    select (p_now at time zone 'Asia/Muscat')::date as today
  ), collected as (
    select p.event_id, sum(p.amount)::numeric(14,3) as paid
    from public.customer_payments p
    where p.organization_id = p_org_id and p.status = 'RECORDED'
    group by p.event_id
  )
  select
    e.id,
    e.event_number,
    e.title,
    coalesce(c.name, '—')::text,
    e.start_at,
    (coalesce(q.total_selling, 0)::numeric(14,3) - coalesce(col.paid, 0))::text as outstanding,
    ((e.start_at at time zone 'Asia/Muscat')::date < day.today) as overdue
  from day
  join public.events e on e.organization_id = p_org_id
  left join public.customers c on c.id = e.customer_id
  left join public.quotations q on q.organization_id = e.organization_id
    and q.id = e.accepted_quotation_id
  left join collected col on col.event_id = e.id
  where e.status not in ('CANCELLED', 'CLOSED')
    and e.accepted_quotation_id is not null
    and coalesce(q.total_selling, 0) > coalesce(col.paid, 0)
    and (
      ((e.start_at at time zone 'Asia/Muscat')::date = day.today)
      or ((e.start_at at time zone 'Asia/Muscat')::date < day.today)
    )
  order by overdue desc, e.start_at asc, e.event_number asc
  limit 20;
end;
$$;

revoke all on function public.today_collections(uuid, timestamptz) from public, anon;
grant execute on function public.today_collections(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Today: «جاهزة للإغلاق» — canonical lifecycle/close semantics.
--
--    CLOSE_OPS: RETURNING events; blockers are the SAME outstanding checks
--    the RETURNING→CLOSED transition itself enforces (warehouse + consumable
--    summaries — reused, not reimplemented).
--    CLOSE_FINANCIAL: CLOSED events without an active financial closure; the
--    blocker is the outstanding balance computed with the same canonical
--    arithmetic as close_event_financially's guard. Calendar age never
--    qualifies an event — only lifecycle state does.
--    Outstanding TEXT is cost-gated; the operational row is not.
-- ---------------------------------------------------------------------------
create or replace function public.today_closure_candidates(
  p_org_id uuid,
  p_now timestamptz default now()
)
returns table (
  event_id uuid,
  event_number text,
  event_title text,
  start_at timestamptz,
  action text,
  outstanding text,
  blockers text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Closure actions belong to the office, not to strangers: event.manage
  -- (operational close) or cost visibility (financial close).
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (public.has_permission(p_org_id, 'event.manage') or public.can_read_cost(p_org_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
  select
    x.event_id, x.event_number, x.event_title, x.start_at, x.action,
    case when public.can_read_cost(p_org_id) then x.outstanding::text else null end,
    x.blockers
  from (
    select
      e.id as event_id,
      e.event_number,
      e.title as event_title,
      e.start_at,
      'CLOSE_OPS'::text as action,
      (coalesce(q.total_selling, 0)::numeric(14,3) - coalesce(col.paid, 0))::numeric as outstanding,
      (array_remove(array[
        case when (public.event_warehouse_summary(p_org_id, e.id) ->> 'outstanding')::numeric > 0
          then 'معدات غير مرجعة بالكامل' end,
        case when (public.event_consumable_summary(p_org_id, e.id) ->> 'outstanding')::numeric > 0
          then 'مواد غير مسوّاة بالكامل' end
      ], null::text)) as blockers
    from public.events e
    left join public.quotations q on q.organization_id = e.organization_id
      and q.id = e.accepted_quotation_id
    left join (
      select p.event_id, sum(p.amount) as paid
      from public.customer_payments p
      where p.organization_id = p_org_id and p.status = 'RECORDED'
      group by p.event_id
    ) col on col.event_id = e.id
    where e.organization_id = p_org_id
      and e.status = 'RETURNING'

    union all

    select
      e.id,
      e.event_number,
      e.title,
      e.start_at,
      'CLOSE_FINANCIAL',
      (coalesce(q.total_selling, 0)::numeric(14,3) - coalesce(col.paid, 0))::numeric,
      case
        when coalesce(q.total_selling, 0) <= 0
          then array['لا يوجد عرض سعر معتمد — الإغلاق المالي يتطلب قيمة معتمدة']
        when coalesce(q.total_selling, 0) > coalesce(col.paid, 0)
          then array['متبقٍ على العميل ' || (q.total_selling - coalesce(col.paid, 0))::text || ' OMR']
        else '{}'::text[]
      end
    from public.events e
    left join public.quotations q on q.organization_id = e.organization_id
      and q.id = e.accepted_quotation_id
    left join (
      select p.event_id, sum(p.amount) as paid
      from public.customer_payments p
      where p.organization_id = p_org_id and p.status = 'RECORDED'
      group by p.event_id
    ) col on col.event_id = e.id
    where e.organization_id = p_org_id
      and e.status = 'CLOSED'
      and not exists (
        select 1 from public.event_financial_closures c
        where c.event_id = e.id and c.reopened_at is null
      )
  ) x
  order by cardinality(x.blockers) asc, x.start_at asc, x.event_number asc
  limit 20;
end;
$$;

revoke all on function public.today_closure_candidates(uuid, timestamptz) from public, anon;
grant execute on function public.today_closure_candidates(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Alerts & metrics now consume the canonical vocabulary.
--    management_alerts body preserved from 0070 except: section 1 covers all
--    FOUR operational dimensions (previously staff+equipment only) and
--    section 2 keys off status='NOT_READY'. The finance sections stay
--    SEPARATE alert types (money never merges into readiness).
-- ---------------------------------------------------------------------------
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

  -- 1. Canonical NOT_READY events: one alert whose title lists the reasons.
  return query
  select
    'EVENT_NOT_READY_FOR_DISPATCH',
    case when cardinality(r.reasons) > 1 then 'CRITICAL' else 'WARNING' end,
    'event',
    e.id,
    e.title || ' — ' || array_to_string(
      (select array_agg(
         case rr
           when 'STAFF_SHORTAGE' then 'فريق ناقص ' || r.staff_missing::text
           when 'EQUIPMENT_SHORTAGE' then 'معدات ناقصة ' || r.equipment_shortage::text
           when 'CONSUMABLE_SHORTAGE' then 'مواد ناقصة ' || r.consumables_shortage::text
           when 'PROCUREMENT_PENDING' then 'تموين لم يصل ' || r.procurement_pending::text
         end) from unnest(r.reasons) as rr),
      '، '),
    'الجاهزية التشغيلية غير مكتملة لهذه المناسبة — افتح مركز القيادة',
    '/events/' || e.id::text,
    e.id,
    e.customer_id,
    p_now
  from public.event_readiness_batch(p_org_id, v_active_ids) r
  join public.events e on e.id = r.event_id and e.organization_id = p_org_id
  where r.status = 'NOT_READY';

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
    and r.status = 'NOT_READY';

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

  -- 4. Finance alerts (cost-role only) — deliberately SEPARATE from readiness.
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

-- 0071 metrics: low-readiness count becomes the canonical NOT_READY count.
-- Redefine with the body preserved from 0071 except that one CTE below.
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

  -- Low-readiness count: the CANONICAL status (0082) — staff, equipment,
  -- consumables and pending procurement all count, finance never does.
  select count(*)::int into events_low_readiness
  from public.event_readiness_batch(p_org_id, v_active_ids) r
  where r.status = 'NOT_READY';

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

