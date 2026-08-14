-- ============================================================================
-- 0023 — S4 concurrency + serviceability hardening
--
-- This forward-only migration closes four integrity gaps found during review:
--
-- 1) dispatch/return and final reconciliation did not share a common lock, so a
--    movement could race a reconciliation and land immediately after closure;
-- 2) dispatches for DIFFERENT reservations sharing one equipment-capacity row
--    locked different reservation rows, so the org-wide physical-capacity sum
--    could be read stale by both sessions;
-- 3) damaged/lost units reduced "outstanding" (correct for reconciliation) but
--    also accidentally looked available for a later dispatch (incorrect for
--    physical serviceability);
-- 4) manual reservation release and cancellation could release a reservation
--    that still had equipment physically outstanding. Conversely, a reservation
--    that had once been dispatched but was now fully accounted stayed ACTIVE.
--
-- Locking contract after this migration:
--   movement INSERT -> Event row lock -> capacity row lock when relevant
--   reconciliation   -> Event row lock
--   cancellation     -> Event row lock
--   reservation      -> capacity row lock
--
-- That gives every conflicting operation a shared serialization point.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reuse the existing trigger function signature so generated public types do
-- not change. UPDATE/DELETE remains append-only enforcement; INSERT becomes the
-- structural concurrency/serviceability guard for movement rows.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ledger_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event_status public.event_status;
  v_capacity_total int;
  v_physically_unavailable bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'WAREHOUSE_LEDGER_APPEND_ONLY' using errcode = '42501';
  end if;

  -- Every physical movement serializes with reconciliation/cancellation on the
  -- same Event. If reconciliation commits first, this statement resumes, sees
  -- the reconciliation row, and fails rather than inserting after closure.
  select e.status
    into v_event_status
    from public.events e
   where e.organization_id = new.organization_id
     and e.id = new.event_id
   for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = '23503';
  end if;

  if exists (
    select 1
      from public.event_warehouse_reconciliations r
     where r.organization_id = new.organization_id
       and r.event_id = new.event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  if new.movement_kind = 'DISPATCH' then
    if v_event_status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
      raise exception 'EVENT_NOT_DISPATCHABLE';
    end if;

    -- The capacity row is the shared lock for DIFFERENT reservations / Events
    -- that draw from the same physical pool.
    select c.total_quantity
      into v_capacity_total
      from public.equipment_capacity c
     where c.organization_id = new.organization_id
       and c.id = new.equipment_capacity_id
       and c.is_active
     for update;

    if not found then
      raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
    end if;

    -- Physical serviceability is deliberately NOT the same as reconciliation
    -- outstanding. A unit is reusable only after it comes back GOOD. Damage or
    -- loss accounts for the Event, but does not recreate a physical unit.
    --
    -- unavailable = dispatched - returned_good
    --
    -- Damaged/lost units therefore remain unavailable until a future audited
    -- repair/replacement adjustment mechanism explicitly restores capacity.
    select coalesce(sum(
      m.dispatched_quantity - m.returned_good_quantity
    ), 0)::bigint
      into v_physically_unavailable
      from public.event_equipment_movements m
     where m.organization_id = new.organization_id
       and m.equipment_capacity_id = new.equipment_capacity_id;

    if v_physically_unavailable + new.dispatched_quantity > v_capacity_total then
      raise exception 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY'
        using detail = jsonb_build_object(
          'total', v_capacity_total,
          'physically_unavailable', v_physically_unavailable,
          'requested', new.dispatched_quantity,
          'available', greatest(v_capacity_total - v_physically_unavailable, 0)
        )::text;
    end if;
  elsif (new.damaged_quantity + new.lost_quantity) > 0 then
    -- Damage/loss changes future serviceable capacity. Serialize it with any
    -- concurrent reservation/dispatch calculation on the same capacity row.
    perform 1
      from public.equipment_capacity c
     where c.organization_id = new.organization_id
       and c.id = new.equipment_capacity_id
     for update;

    if not found then
      raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

create trigger event_equipment_movements_concurrency_guard
  before insert on public.event_equipment_movements
  for each row execute function public.warehouse_ledger_is_append_only();

-- ---------------------------------------------------------------------------
-- Reservation availability now uses SERVICEABLE capacity. Damage/loss is
-- append-only and therefore a deterministic permanent reduction until a later
-- audited repair/replacement slice exists.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_availability(
  p_org_id uuid,
  p_capacity_id uuid,
  p_from timestamptz,
  p_until timestamptz,
  p_requested int default 0
)
returns table(total int, reserved bigint, available bigint, shortage bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with cap as (
    select
      c.total_quantity,
      coalesce((
        select sum(m.damaged_quantity + m.lost_quantity)
          from public.event_equipment_movements m
         where m.organization_id = c.organization_id
           and m.equipment_capacity_id = c.id
      ), 0)::bigint as unserviceable
    from public.equipment_capacity c
    where c.organization_id = p_org_id
      and c.id = p_capacity_id
      and c.is_active
      and public.is_org_member(c.organization_id)
  ), res as (
    select coalesce(sum(r.quantity), 0)::bigint as reserved
      from public.event_equipment_reservations r
     where r.equipment_capacity_id = p_capacity_id
       and r.status = 'ACTIVE'
       and tstzrange(r.reserved_from, r.reserved_until, '[)')
           && tstzrange(p_from, p_until, '[)')
  )
  select
    cap.total_quantity,
    res.reserved,
    greatest(cap.total_quantity::bigint - cap.unserviceable - res.reserved, 0)::bigint,
    greatest(
      p_requested::bigint
      - greatest(cap.total_quantity::bigint - cap.unserviceable - res.reserved, 0),
      0
    )::bigint
  from cap cross join res;
$$;

-- ---------------------------------------------------------------------------
-- Reservation creation already locks the capacity row. Make its check use the
-- same serviceability definition so lost/damaged equipment cannot be promised
-- to a future Event.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_capacity_id uuid,
  p_quantity int,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_capacity public.equipment_capacity;
  v_reserved bigint;
  v_unserviceable bigint;
  v_serviceable bigint;
  v_id uuid;
begin
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role,
    'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select id into v_id
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key
     and event_id = p_event_id
     and equipment_capacity_id = p_capacity_id;

  if found then
    select * into v_event
      from public.events
     where id = p_event_id and organization_id = p_org_id;
    select * into v_capacity
      from public.equipment_capacity
     where id = p_capacity_id and organization_id = p_org_id;
  else
    select * into v_event
      from public.events
     where organization_id = p_org_id and id = p_event_id;
    if not found or v_event.status = 'CANCELLED' then
      raise exception 'EVENT_NOT_RESERVABLE';
    end if;

    -- Shared serialization point with damage/loss + dispatch guard.
    select * into v_capacity
      from public.equipment_capacity
     where organization_id = p_org_id
       and id = p_capacity_id
       and is_active
     for update;
    if not found then
      raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
    end if;

    select coalesce(sum(m.damaged_quantity + m.lost_quantity), 0)::bigint
      into v_unserviceable
      from public.event_equipment_movements m
     where m.organization_id = p_org_id
       and m.equipment_capacity_id = p_capacity_id;

    v_serviceable := greatest(v_capacity.total_quantity::bigint - v_unserviceable, 0);

    select coalesce(sum(quantity), 0)
      into v_reserved
      from public.event_equipment_reservations
     where equipment_capacity_id = p_capacity_id
       and status = 'ACTIVE'
       and tstzrange(reserved_from, reserved_until, '[)')
           && tstzrange(v_event.start_at, v_event.end_at, '[)');

    if v_reserved + p_quantity > v_serviceable then
      raise exception 'EQUIPMENT_SHORTAGE'
        using detail = jsonb_build_object(
          'total', v_capacity.total_quantity,
          'unserviceable', v_unserviceable,
          'serviceable', v_serviceable,
          'reserved', v_reserved,
          'available', greatest(v_serviceable - v_reserved, 0),
          'shortage', v_reserved + p_quantity - v_serviceable
        )::text;
    end if;

    insert into public.event_equipment_reservations(
      organization_id, event_id, equipment_capacity_id, quantity,
      reserved_from, reserved_until, idempotency_key, created_by
    ) values (
      p_org_id, p_event_id, p_capacity_id, p_quantity,
      v_event.start_at, v_event.end_at, p_idempotency_key, auth.uid()
    ) returning id into v_id;

    perform public.record_audit(
      p_org_id, 'EQUIPMENT_RESERVED', 'event_equipment_reservation', v_id::text,
      jsonb_build_object('event_id', p_event_id, 'quantity', p_quantity)
    );
  end if;

  select coalesce(sum(m.damaged_quantity + m.lost_quantity), 0)::bigint
    into v_unserviceable
    from public.event_equipment_movements m
   where m.organization_id = p_org_id
     and m.equipment_capacity_id = p_capacity_id;
  v_serviceable := greatest(v_capacity.total_quantity::bigint - v_unserviceable, 0);

  select coalesce(sum(quantity), 0)
    into v_reserved
    from public.event_equipment_reservations
   where equipment_capacity_id = p_capacity_id
     and status = 'ACTIVE'
     and tstzrange(reserved_from, reserved_until, '[)')
         && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object(
    'reservation_id', v_id,
    'total', v_capacity.total_quantity,
    'unserviceable', v_unserviceable,
    'serviceable', v_serviceable,
    'reserved', v_reserved,
    'available', greatest(v_serviceable - v_reserved, 0),
    'shortage', 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- A manual release is not allowed to erase a physical recovery obligation.
-- Fully-accounted (including never-dispatched) reservations may still release.
-- ---------------------------------------------------------------------------
create or replace function public.release_equipment_reservation(
  p_org_id uuid,
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.event_equipment_reservations;
  v_state record;
begin
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role,
    'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;

  if not found or v_reservation.status <> 'ACTIVE' then
    return;
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if coalesce(v_state.outstanding_quantity, 0) > 0 then
    raise exception 'RESERVATION_HAS_OUTSTANDING_EQUIPMENT';
  end if;

  update public.event_equipment_reservations
     set status = 'RELEASED'
   where organization_id = p_org_id
     and id = p_reservation_id
     and status = 'ACTIVE';

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_RELEASED', 'event_equipment_reservation', p_reservation_id::text,
    jsonb_build_object('event_id', v_reservation.event_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation releases every reservation with ZERO outstanding physical
-- quantity, including a reservation that was dispatched earlier but is now
-- fully returned/accounted. Only genuinely outstanding reservations stay ACTIVE.
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

  select * into v
    from public.events
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

  -- Release only lines that have no physical recovery obligation NOW.
  update public.event_equipment_reservations r
     set status = 'CANCELLED'
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE'
     and coalesce((
       select sum(
         m.dispatched_quantity
         - m.returned_good_quantity
         - m.damaged_quantity
         - m.lost_quantity
       )
       from public.event_equipment_movements m
       where m.organization_id = r.organization_id
         and m.reservation_id = r.id
     ), 0) = 0;
  get diagnostics v_equipment = row_count;

  select count(*)::int into v_retained
    from public.event_equipment_reservations r
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE';

  insert into public.event_status_history(
    organization_id, event_id, from_status, to_status, actor_id, reason
  ) values (
    p_org_id, p_event_id, v.status, 'CANCELLED', auth.uid(), trim(p_reason)
  );

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
      'equipment_retained_outstanding', v_retained,
      'idempotency_key', p_idempotency_key
    )
  );

  return v;
end;
$$;

-- Re-assert the intended client execution surface after CREATE OR REPLACE.
revoke all on function
  public.equipment_availability(uuid, uuid, timestamptz, timestamptz, int),
  public.reserve_event_equipment(uuid, uuid, uuid, int, uuid),
  public.release_equipment_reservation(uuid, uuid),
  public.cancel_event(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.equipment_availability(uuid, uuid, timestamptz, timestamptz, int),
  public.reserve_event_equipment(uuid, uuid, uuid, int, uuid),
  public.release_equipment_reservation(uuid, uuid),
  public.cancel_event(uuid, uuid, text, uuid)
  to authenticated;
