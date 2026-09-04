-- ============================================================================
-- 0080: Office document read models.
--
-- Canonical server-side projections backing the printable office documents.
-- Unknown data never renders as zero: every model returns EMPTY when the
-- caller lacks the required visibility or the referenced record does not
-- exist in the caller's org (never a fabricated row of zeros).
--
--   * customer_statement(p_org_id, p_customer_id)
--       Movements behind the customer statement (كشف حساب عميل): CHARGE rows
--       from the accepted revenue of the customer's non-cancelled events and
--       PAYMENT rows from RECORDED customer payments. Amounts are always
--       positive; the sign is carried by row_kind. Totals come from the
--       canonical customer_360 row (not re-summed by the client).
--       Gate: cost.visibility (financial statement).
--
--   * customer_payment_receipt(p_org_id, p_payment_id)
--       The payment receipt (سند قبض) for a single payment: org identity,
--       payment reference, customer, event, amount, method, recorder, void
--       shape. VOIDED rows are returned with their void metadata so the
--       surface can render the voided watermark — but nothing here is a
--       "valid receipt"; validity is the server status, not the print.
--       Gate: cost.visibility (same boundary as the payments table select).
--
--   * event_warehouse_sheet_lines(p_org_id, p_event_id)
--       The warehouse preparation sheet (أمر تجهيز المخزن): required
--       quantities from the event's operational commercial lines (reusable
--       equipment + consumables, cost columns excluded) plus the canonical
--       dispatch/return state from the movement ledgers. No cost, margin,
--       or financial columns anywhere in the projection.
--       Gate: any active org member (operational, not financial).
--
--   * host_statement(p_org_id, p_staff_member_id)
--       The host statement (كشف حساب مضيف): one row per event from the
--       canonical host_event_payroll_summaries view plus the host's
--       identity. The per-event view carries 0 for advances by design
--       (multi-event payouts moved advances host-wide in 0076); this model
--       injects the host-wide canonical advances total (same source as
--       get_host_payroll_summary) into each row, and the surface presents
--       it once. Totals are the sum of the canonical rows (same rule the
--       payroll workspace uses). Gate: payroll.read.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Customer statement movements.
-- ---------------------------------------------------------------------------
create or replace function public.customer_statement(
  p_org_id uuid,
  p_customer_id uuid
)
returns table (
  row_kind text,
  occurred_at timestamptz,
  event_id uuid,
  event_number text,
  event_title text,
  amount numeric(14,3),
  payment_method text,
  reference text,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select id
    from public.customers
    where organization_id = p_org_id
      and id = p_customer_id
      and public.can_read_cost(p_org_id)
  ),
  charges as (
    select
      'CHARGE'::text as row_kind,
      e.start_at as occurred_at,
      e.id as event_id,
      e.event_number,
      e.title as event_title,
      f.accepted_revenue as amount,
      null::text as payment_method,
      null::text as reference,
      null::text as notes
    from public.events e
    join public.event_finance_summaries f
      on f.event_id = e.id
    where e.organization_id = p_org_id
      and e.customer_id = p_customer_id
      and e.status <> 'CANCELLED'
      and f.accepted_revenue > 0
      and public.can_read_cost(p_org_id)
  ),
  payments as (
    select
      'PAYMENT'::text as row_kind,
      p.paid_at as occurred_at,
      e.id as event_id,
      e.event_number,
      e.title as event_title,
      p.amount::numeric(14,3) as amount,
      p.payment_method::text as payment_method,
      p.reference,
      p.notes
    from public.customer_payments p
    join public.events e
      on e.organization_id = p.organization_id and e.id = p.event_id
    where p.organization_id = p_org_id
      and p.status = 'RECORDED'
      and e.customer_id = p_customer_id
      and public.can_read_cost(p_org_id)
  )
  select charges.*
  from charges, c
  union all
  select payments.*
  from payments, c
  order by occurred_at, event_number;
$$;

revoke all on function public.customer_statement(uuid, uuid) from public, anon;
grant execute on function public.customer_statement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Payment receipt (single payment, authoritative fields).
-- ---------------------------------------------------------------------------
create or replace function public.customer_payment_receipt(
  p_org_id uuid,
  p_payment_id uuid
)
returns table (
  payment_id uuid,
  receipt_number text,
  org_name text,
  org_phone text,
  customer_name text,
  event_number text,
  event_title text,
  amount numeric(12,3),
  payment_method text,
  reference text,
  notes text,
  paid_at timestamptz,
  status text,
  recorded_by_name text,
  voided_at timestamptz,
  void_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as payment_id,
    upper(left(p.id::text, 8)) as receipt_number,
    coalesce(os.name_en, o.name) as org_name,
    os.phone_primary as org_phone,
    cu.name as customer_name,
    e.event_number,
    e.title as event_title,
    p.amount,
    p.payment_method::text as payment_method,
    p.reference,
    p.notes,
    p.paid_at,
    p.status::text as status,
    rp.full_name as recorded_by_name,
    p.voided_at,
    p.void_reason
  from public.customer_payments p
  join public.events e
    on e.organization_id = p.organization_id and e.id = p.event_id
  join public.customers cu
    on cu.organization_id = e.organization_id and cu.id = e.customer_id
  join public.organizations o
    on o.id = p.organization_id
  left join public.organization_settings os
    on os.organization_id = o.id
  left join public.profiles rp
    on rp.id = p.recorded_by
  where p.organization_id = p_org_id
    and p.id = p_payment_id
    and public.can_read_cost(p_org_id);
$$;

revoke all on function public.customer_payment_receipt(uuid, uuid) from public, anon;
grant execute on function public.customer_payment_receipt(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Warehouse preparation/return sheet lines.
--    Required quantities come from the event's operational commercial lines;
--    state quantities come from the canonical movement ledgers. No cost or
--    financial columns are projected.
-- ---------------------------------------------------------------------------
create or replace function public.event_warehouse_sheet_lines(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  line_kind text,
  item_name text,
  unit text,
  required_qty numeric(12,3),
  prepared_qty numeric(12,3),
  dispatched_qty numeric(12,3),
  returned_good_qty numeric(12,3),
  damaged_qty numeric(12,3),
  lost_qty numeric(12,3),
  outstanding_qty numeric(12,3)
)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select id
    from public.events
    where organization_id = p_org_id
      and id = p_event_id
      and public.is_org_member(p_org_id)
  ),
  equipment_lines as (
    select
      'EQUIPMENT'::text as line_kind,
      l.description as item_name,
      l.unit,
      ceil(l.quantity) as required_qty,
      coalesce((
        select sum(r.quantity)::numeric(12,3)
        from public.event_equipment_reservations r
        join public.equipment_capacity ec
          on ec.organization_id = r.organization_id and ec.id = r.equipment_capacity_id
        where r.event_id = l.event_id
          and r.status = 'ACTIVE'
          and l.source_catalog_item_id is not null
          and ec.catalog_item_id = l.source_catalog_item_id
      ), 0) as prepared_qty,
      coalesce((
        select sum(m.dispatched_quantity)::numeric(12,3)
        from public.event_equipment_movements m
        join public.equipment_capacity ec
          on ec.organization_id = m.organization_id and ec.id = m.equipment_capacity_id
        where m.event_id = l.event_id
          and m.movement_kind = 'DISPATCH'
          and l.source_catalog_item_id is not null
          and ec.catalog_item_id = l.source_catalog_item_id
      ), 0) as dispatched_qty,
      coalesce((
        select sum(m.returned_good_quantity)::numeric(12,3)
        from public.event_equipment_movements m
        join public.equipment_capacity ec
          on ec.organization_id = m.organization_id and ec.id = m.equipment_capacity_id
        where m.event_id = l.event_id
          and m.movement_kind = 'RETURN'
          and l.source_catalog_item_id is not null
          and ec.catalog_item_id = l.source_catalog_item_id
      ), 0) as returned_good_qty,
      coalesce((
        select sum(m.damaged_quantity)::numeric(12,3)
        from public.event_equipment_movements m
        join public.equipment_capacity ec
          on ec.organization_id = m.organization_id and ec.id = m.equipment_capacity_id
        where m.event_id = l.event_id
          and m.movement_kind = 'RETURN'
          and l.source_catalog_item_id is not null
          and ec.catalog_item_id = l.source_catalog_item_id
      ), 0) as damaged_qty,
      coalesce((
        select sum(m.lost_quantity)::numeric(12,3)
        from public.event_equipment_movements m
        join public.equipment_capacity ec
          on ec.organization_id = m.organization_id and ec.id = m.equipment_capacity_id
        where m.event_id = l.event_id
          and m.movement_kind = 'RETURN'
          and l.source_catalog_item_id is not null
          and ec.catalog_item_id = l.source_catalog_item_id
      ), 0) as lost_qty,
      l.sort_order
    from public.event_commercial_lines l
    where l.event_id = p_event_id
      and l.item_type = 'REUSABLE_EQUIPMENT'
      and l.quantity > 0
  ),
  consumable_lines as (
    select
      'CONSUMABLE'::text as line_kind,
      l.description as item_name,
      l.unit,
      l.quantity as required_qty,
      coalesce((
        select sum(cm.quantity)::numeric(12,3)
        from public.consumable_movements cm
        join public.consumable_stock_items s
          on s.organization_id = cm.organization_id and s.id = cm.stock_item_id
        where cm.event_id = l.event_id
          and cm.movement_kind = 'ISSUE_TO_EVENT'
          and l.source_catalog_item_id is not null
          and s.catalog_item_id = l.source_catalog_item_id
      ), 0) as prepared_qty,
      0::numeric(12,3) as dispatched_qty,
      0::numeric(12,3) as returned_good_qty,
      0::numeric(12,3) as damaged_qty,
      0::numeric(12,3) as lost_qty,
      l.sort_order
    from public.event_commercial_lines l
    where l.event_id = p_event_id
      and l.item_type = 'CONSUMABLE'
      and l.quantity > 0
  )
  select
    el.line_kind,
    el.item_name,
    el.unit,
    el.required_qty::numeric(12,3),
    el.prepared_qty,
    el.dispatched_qty,
    el.returned_good_qty,
    el.damaged_qty,
    el.lost_qty,
    greatest(el.required_qty::numeric(12,3) - el.prepared_qty, 0) as outstanding_qty
  from equipment_lines el, e
  union all
  select
    cl.line_kind,
    cl.item_name,
    cl.unit,
    cl.required_qty,
    cl.prepared_qty,
    cl.dispatched_qty,
    cl.returned_good_qty,
    cl.damaged_qty,
    cl.lost_qty,
    greatest(cl.required_qty - cl.prepared_qty, 0) as outstanding_qty
  from consumable_lines cl, e
  order by line_kind, item_name;
$$;

revoke all on function public.event_warehouse_sheet_lines(uuid, uuid) from public, anon;
grant execute on function public.event_warehouse_sheet_lines(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Host statement (per-event canonical payroll rows + identity).
-- ---------------------------------------------------------------------------
create or replace function public.host_statement(
  p_org_id uuid,
  p_staff_member_id uuid
)
returns table (
  staff_member_id uuid,
  host_name text,
  host_phone text,
  event_id uuid,
  event_number text,
  event_title text,
  start_at timestamptz,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  due_total numeric(14,3),
  paid_total numeric(14,3),
  late_total numeric(14,3),
  attendance_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_advances numeric(14,3);
begin
  if auth.uid() is null or not public.can_read_payroll(p_org_id) then
    return;
  end if;

  -- Advances are HOST-WIDE canonical totals (same source as the payroll
  -- rollup); the per-event view intentionally carries 0 here. The surface
  -- presents advances once, not per event row.
  select gs.advances_total into v_advances
  from public.get_host_payroll_summary(p_org_id, p_staff_member_id) gs;

  return query
  select
    sm.id as staff_member_id,
    sm.name as host_name,
    sm.phone as host_phone,
    s.event_id,
    s.event_number,
    s.event_title,
    e.start_at,
    s.earned_total,
    v_advances as advances_total,
    s.payouts_total,
    s.due_total,
    s.paid_total,
    s.late_total,
    s.attendance_count
  from public.host_event_payroll_summaries s
  join public.staff_members sm
    on sm.organization_id = s.organization_id and sm.id = s.staff_member_id
  join public.events e
    on e.organization_id = s.organization_id and e.id = s.event_id
  where s.organization_id = p_org_id
    and s.staff_member_id = p_staff_member_id
  order by e.start_at, e.event_number;
end;
$$;

revoke all on function public.host_statement(uuid, uuid) from public, anon;
grant execute on function public.host_statement(uuid, uuid) to authenticated;
