-- ============================================================================
-- 0022 — S4 warehouse RLS, read models, and cancellation integration
--
-- READ MODEL SPLIT (commercial separation at the DATA boundary, not the UI):
--
--   event_warehouse_lines           — OPERATIONAL. Every org member, including
--                                     WAREHOUSE. Quantities only; NO valuation.
--   event_warehouse_lines_valued    — COMMERCIAL. can_read_cost() roles only
--                                     (OWNER/MANAGER/ACCOUNTANT). Adds the
--                                     immutable damage/loss valuation.
--
-- The warehouse operator gets everything needed to run the floor and nothing
-- that reveals equipment cost.
--
-- NULLABILITY: PostgreSQL cannot prove view-column nullability, so the
-- generated types mark every view column nullable. The views therefore do NOT
-- coerce genuinely-missing data to zero as a way of hiding it: `reserved`,
-- `dispatched`, `returned_good`, `damaged`, `lost` and `outstanding` are all
-- real derived integers (a reservation with no movements has 0 dispatched,
-- which is a true fact, not a masked absence), while `unit_valuation_omr` is
-- left NULL when no valuation basis exists rather than being faked as 0.000.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RLS — every new business table.
-- ---------------------------------------------------------------------------
alter table public.event_equipment_movements enable row level security;
alter table public.event_warehouse_reconciliations enable row level security;

-- Read: any active member of the owning organization. Movement rows carry no
-- commercial cost EXCEPT the valuation columns, so base-table SELECT is
-- restricted to cost readers and operational members read the view instead.
create policy event_equipment_movements_cost_read
  on public.event_equipment_movements
  for select using (public.can_read_cost(organization_id));

create policy event_warehouse_reconciliations_cost_read
  on public.event_warehouse_reconciliations
  for select using (public.can_read_cost(organization_id));

-- No INSERT/UPDATE/DELETE policy on either table: writes are only legal
-- through the SECURITY DEFINER commands in 0021. A direct client write is
-- rejected by RLS, and any privileged write is additionally rejected by the
-- append-only triggers from 0020.

-- ---------------------------------------------------------------------------
-- Operational read model — quantities only, safe for WAREHOUSE.
-- SECURITY DEFINER view semantics (owner privileges) with explicit
-- is_org_member() row scoping, matching the S1–S3 convention.
-- ---------------------------------------------------------------------------
create view public.event_warehouse_lines as
select
  r.id                                    as reservation_id,
  r.organization_id,
  r.event_id,
  r.equipment_capacity_id,
  ec.catalog_item_id,
  ci.name                                 as equipment_name,
  ci.unit                                 as equipment_unit,
  ec.total_quantity                       as capacity_total_quantity,
  r.status                                as reservation_status,
  r.reserved_from,
  r.reserved_until,
  s.reserved_quantity,
  s.dispatched_quantity,
  s.returned_good_quantity,
  s.damaged_quantity,
  s.lost_quantity,
  s.outstanding_quantity,
  (rec.id is not null)                    as is_reconciled,
  rec.reconciled_at
from public.event_equipment_reservations r
join public.equipment_capacity ec
  on ec.organization_id = r.organization_id
 and ec.id = r.equipment_capacity_id
join public.catalog_items ci
  on ci.organization_id = ec.organization_id
 and ci.id = ec.catalog_item_id
cross join lateral public.warehouse_reservation_state(r.organization_id, r.id) s
left join public.event_warehouse_reconciliations rec
  on rec.organization_id = r.organization_id
 and rec.event_id = r.event_id
where public.is_org_member(r.organization_id);

-- ---------------------------------------------------------------------------
-- Valued read model — adds the immutable damage/loss valuation. Cost readers
-- only (OWNER/MANAGER/ACCOUNTANT).
-- ---------------------------------------------------------------------------
create view public.event_warehouse_lines_valued as
select
  r.id                                    as reservation_id,
  r.organization_id,
  r.event_id,
  r.equipment_capacity_id,
  s.reserved_quantity,
  s.dispatched_quantity,
  s.returned_good_quantity,
  s.damaged_quantity,
  s.lost_quantity,
  s.outstanding_quantity,
  -- Sum of the per-movement IMMUTABLE snapshots. This is never recomputed
  -- from the CURRENT catalog cost, so a catalog price change cannot restate
  -- historical damage/loss value.
  coalesce(v.damage_loss_valuation_omr, 0)::numeric(14,3)
                                          as damage_loss_valuation_omr,
  -- Genuinely NULL when nothing was ever valued: not coerced to 0.000.
  v.latest_unit_valuation_omr             as unit_valuation_omr,
  v.valuation_basis
from public.event_equipment_reservations r
cross join lateral public.warehouse_reservation_state(r.organization_id, r.id) s
left join lateral (
  select
    sum(m.damage_loss_valuation_omr)                    as damage_loss_valuation_omr,
    max(m.unit_valuation_omr)                           as latest_unit_valuation_omr,
    max(m.valuation_basis::text)                        as valuation_basis
  from public.event_equipment_movements m
  where m.organization_id = r.organization_id
    and m.reservation_id = r.id
    and m.valuation_basis is not null
) v on true
where public.can_read_cost(r.organization_id);

-- ---------------------------------------------------------------------------
-- Event-level warehouse summary — drives the operator's "حالة التسوية" badge.
-- Operational (no valuation), so WAREHOUSE can see it.
-- ---------------------------------------------------------------------------
create or replace function public.event_warehouse_summary(
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
  v_reserved int;
  v_dispatched int;
  v_good int;
  v_damaged int;
  v_lost int;
  v_outstanding int;
  v_reconciled boolean;
  v_status text;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select
    coalesce(sum(s.reserved_quantity), 0)::int,
    coalesce(sum(s.dispatched_quantity), 0)::int,
    coalesce(sum(s.returned_good_quantity), 0)::int,
    coalesce(sum(s.damaged_quantity), 0)::int,
    coalesce(sum(s.lost_quantity), 0)::int,
    coalesce(sum(s.outstanding_quantity), 0)::int
  into v_reserved, v_dispatched, v_good, v_damaged, v_lost, v_outstanding
  from public.event_equipment_reservations r
  cross join lateral public.warehouse_reservation_state(p_org_id, r.id) s
  where r.organization_id = p_org_id and r.event_id = p_event_id;

  v_reconciled := exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  );

  v_status := case
    when v_reconciled then 'RECONCILED'
    when v_outstanding > 0 then 'OUTSTANDING'
    when v_dispatched > 0 then 'READY_TO_RECONCILE'
    when v_reserved > 0 then 'AWAITING_DISPATCH'
    else 'NO_EQUIPMENT'
  end;

  return jsonb_build_object(
    'status', v_status,
    'reserved', v_reserved,
    'dispatched', v_dispatched,
    'returned_good', v_good,
    'damaged', v_damaged,
    'lost', v_lost,
    'outstanding', v_outstanding,
    'is_reconciled', v_reconciled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation integration (S3 defect repair, required for S4 correctness).
--
-- DEFECT: cancel_event() in 0015 flips EVERY ACTIVE reservation to CANCELLED.
-- Once S4 exists that is wrong and unsafe: it would "release" equipment that
-- is physically in the field, erasing the outstanding obligation to bring it
-- back and making the Event look settled while stock is missing.
--
-- REPAIR (forward-only, minimal): cancellation releases only reservations with
-- NO dispatched quantity. A reservation with dispatched units stays ACTIVE and
-- operationally outstanding until it is returned/damaged/lost and reconciled
-- through an authoritative command. Regression coverage:
-- supabase/tests/warehouse_dispatch.test.sql.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_event(
  p_org_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_staff int;
  v_equipment int;
  v_retained int;
begin
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  select * into v from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v.status = 'CANCELLED' then
    return v;
  end if;
  if v.status not in ('DRAFT', 'QUOTED', 'CONFIRMED', 'PREPARING') then
    raise exception 'EVENT_CANNOT_BE_CANCELLED';
  end if;

  update public.event_staff_assignments
     set status = 'CANCELLED'
   where event_id = p_event_id and status = 'ACTIVE';
  get diagnostics v_staff = row_count;

  -- Release ONLY undispatched reservations.
  update public.event_equipment_reservations r
     set status = 'CANCELLED'
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE'
     and not exists (
       select 1 from public.event_equipment_movements m
        where m.organization_id = r.organization_id
          and m.reservation_id = r.id
          and m.movement_kind = 'DISPATCH'
     );
  get diagnostics v_equipment = row_count;

  -- Physically dispatched reservations are deliberately retained ACTIVE.
  select count(*)::int into v_retained
    from public.event_equipment_reservations r
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE';

  insert into public.event_status_history (
    organization_id, event_id, from_status, to_status, actor_id, reason
  ) values (p_org_id, p_event_id, v.status, 'CANCELLED', auth.uid(), trim(p_reason));

  update public.events
     set status = 'CANCELLED',
         cancellation_reason = trim(p_reason),
         updated_by = auth.uid()
   where id = p_event_id
  returning * into v;

  perform public.record_audit(
    p_org_id, 'EVENT_CANCELLED', 'event', p_event_id::text,
    jsonb_build_object(
      'reason', trim(p_reason),
      'staff_released', v_staff,
      'equipment_released', v_equipment,
      'equipment_retained_dispatched', v_retained,
      'idempotency_key', p_idempotency_key
    )
  );

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on table
  public.event_equipment_movements,
  public.event_warehouse_reconciliations,
  public.event_warehouse_lines,
  public.event_warehouse_lines_valued
  from anon;

-- SELECT only. There is no client INSERT/UPDATE/DELETE grant on the ledger or
-- the reconciliation: the RPC commands are the only write path.
grant select on table
  public.event_equipment_movements,
  public.event_warehouse_reconciliations,
  public.event_warehouse_lines,
  public.event_warehouse_lines_valued
  to authenticated;

revoke all on function public.event_warehouse_summary(uuid, uuid) from public, anon;
grant execute on function public.event_warehouse_summary(uuid, uuid) to authenticated;

revoke all on function public.cancel_event(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.cancel_event(uuid, uuid, text, uuid) to authenticated;
