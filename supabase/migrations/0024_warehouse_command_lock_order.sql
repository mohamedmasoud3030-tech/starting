-- ============================================================================
-- 0024 — S4 warehouse command lock-order repair
--
-- Legitimate command paths must take locks in one stable order:
--   Event -> reservation -> capacity
--
-- 0023 adds a structural INSERT guard, but the original 0021 commands acquired
-- the reservation before the movement INSERT acquired the Event lock. That is
-- safe for integrity but can deadlock against cancel_event(), which locks the
-- Event first and then updates reservations. These replacements move the Event
-- lock to the command boundary and also re-check idempotency AFTER waiting on
-- the shared lock, so a concurrent retry returns the original fact instead of
-- falling through to a UNIQUE violation.
-- ============================================================================

create or replace function public.dispatch_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_reservation_id uuid,
  p_quantity int,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_equipment_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.event_equipment_movements;
  v_event public.events;
  v_reservation public.event_equipment_reservations;
  v_state record;
  v_fingerprint text;
  v_capacity_total int;
  v_physically_unavailable bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role,
    'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'DISPATCH',
    'event_id', p_event_id,
    'reservation_id', p_reservation_id,
    'quantity', p_quantity,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  -- Fast-path replay before taking locks.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- FIRST shared lock: every movement, reconciliation and cancellation for the
  -- same Event serializes here.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A concurrent identical retry may have committed while we waited.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if v_event.status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
    raise exception 'EVENT_NOT_DISPATCHABLE';
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  -- SECOND lock: per-reservation quantity serialization.
  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '23503';
  end if;

  if v_reservation.event_id <> p_event_id then
    raise exception 'RESERVATION_EVENT_MISMATCH' using errcode = '23503';
  end if;

  if v_reservation.status <> 'ACTIVE' then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if v_state.dispatched_quantity + p_quantity > v_state.reserved_quantity then
    raise exception 'DISPATCH_EXCEEDS_RESERVATION'
      using detail = jsonb_build_object(
        'reserved', v_state.reserved_quantity,
        'already_dispatched', v_state.dispatched_quantity,
        'requested', p_quantity,
        'remaining', greatest(v_state.reserved_quantity - v_state.dispatched_quantity, 0)
      )::text;
  end if;

  -- THIRD shared lock: different Events/reservations drawing from the same
  -- physical capacity serialize here. A unit is serviceable again only when it
  -- returns GOOD; damaged/lost units remain unavailable.
  select c.total_quantity
    into v_capacity_total
    from public.equipment_capacity c
   where c.organization_id = p_org_id
     and c.id = v_reservation.equipment_capacity_id
     and c.is_active
   for update;
  if not found then
    raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode = '23503';
  end if;

  select coalesce(sum(
    m.dispatched_quantity - m.returned_good_quantity
  ), 0)::bigint
    into v_physically_unavailable
    from public.event_equipment_movements m
   where m.organization_id = p_org_id
     and m.equipment_capacity_id = v_reservation.equipment_capacity_id;

  if v_physically_unavailable + p_quantity > v_capacity_total then
    raise exception 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY'
      using detail = jsonb_build_object(
        'total', v_capacity_total,
        'physically_unavailable', v_physically_unavailable,
        'requested', p_quantity,
        'available', greatest(v_capacity_total - v_physically_unavailable, 0)
      )::text;
  end if;

  insert into public.event_equipment_movements (
    organization_id, event_id, reservation_id, equipment_capacity_id,
    movement_kind, dispatched_quantity,
    reference, condition_notes,
    actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_reservation_id, v_reservation.equipment_capacity_id,
    'DISPATCH', p_quantity,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_movement;

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_DISPATCHED', 'event_equipment_movement', v_movement.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reservation_id', p_reservation_id,
      'equipment_capacity_id', v_reservation.equipment_capacity_id,
      'quantity', p_quantity,
      'reference', v_movement.reference,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_movement;
end;
$$;

create or replace function public.return_event_equipment(
  p_org_id uuid,
  p_event_id uuid,
  p_reservation_id uuid,
  p_returned_good_quantity int,
  p_damaged_quantity int,
  p_lost_quantity int,
  p_reference text,
  p_condition_notes text,
  p_idempotency_key uuid
)
returns public.event_equipment_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.event_equipment_movements;
  v_event public.events;
  v_reservation public.event_equipment_reservations;
  v_state record;
  v_fingerprint text;
  v_good int := coalesce(p_returned_good_quantity, 0);
  v_damaged int := coalesce(p_damaged_quantity, 0);
  v_lost int := coalesce(p_lost_quantity, 0);
  v_total int;
  v_unit_cost numeric(12,3);
  v_valuation numeric(14,3);
  v_basis public.warehouse_valuation_basis;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role,
    'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RETURN',
    'event_id', p_event_id,
    'reservation_id', p_reservation_id,
    'returned_good', v_good,
    'damaged', v_damaged,
    'lost', v_lost,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'condition_notes', nullif(trim(coalesce(p_condition_notes, '')), '')
  ));

  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if v_good < 0 or v_damaged < 0 or v_lost < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  v_total := v_good + v_damaged + v_lost;
  if v_total < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- FIRST shared lock: serialize with reconciliation/cancellation.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Concurrent retry may have committed while waiting on the Event.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  -- SECOND lock: per-reservation outstanding serialization.
  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id
     and id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '23503';
  end if;

  if v_reservation.event_id <> p_event_id then
    raise exception 'RESERVATION_EVENT_MISMATCH' using errcode = '23503';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  if v_total > v_state.outstanding_quantity then
    raise exception 'RETURN_EXCEEDS_OUTSTANDING'
      using detail = jsonb_build_object(
        'dispatched', v_state.dispatched_quantity,
        'already_accounted', v_state.dispatched_quantity - v_state.outstanding_quantity,
        'outstanding', v_state.outstanding_quantity,
        'requested', v_total
      )::text;
  end if;

  if (v_damaged + v_lost) > 0 then
    select ci.cost_price into v_unit_cost
      from public.equipment_capacity ec
      join public.catalog_items ci
        on ci.organization_id = ec.organization_id
       and ci.id = ec.catalog_item_id
     where ec.organization_id = p_org_id
       and ec.id = v_reservation.equipment_capacity_id;

    if v_unit_cost is null then
      raise exception 'VALUATION_BASIS_UNAVAILABLE';
    end if;

    v_basis := 'CATALOG_COST_SNAPSHOT';
    v_valuation := round(v_unit_cost * (v_damaged + v_lost), 3);
  end if;

  insert into public.event_equipment_movements (
    organization_id, event_id, reservation_id, equipment_capacity_id,
    movement_kind,
    returned_good_quantity, damaged_quantity, lost_quantity,
    valuation_basis, unit_valuation_omr, damage_loss_valuation_omr,
    reference, condition_notes,
    actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_reservation_id, v_reservation.equipment_capacity_id,
    'RETURN',
    v_good, v_damaged, v_lost,
    v_basis, v_unit_cost, v_valuation,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_condition_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_movement;

  perform public.record_audit(
    p_org_id, 'EQUIPMENT_RETURNED', 'event_equipment_movement', v_movement.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reservation_id', p_reservation_id,
      'equipment_capacity_id', v_reservation.equipment_capacity_id,
      'returned_good', v_good,
      'damaged', v_damaged,
      'lost', v_lost,
      'reference', v_movement.reference,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_movement;
end;
$$;

create or replace function public.reconcile_event_warehouse(
  p_org_id uuid,
  p_event_id uuid,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_warehouse_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.event_warehouse_reconciliations;
  v_event public.events;
  v_fingerprint text;
  v_outstanding int;
  v_reserved int;
  v_dispatched int;
  v_good int;
  v_damaged int;
  v_lost int;
  v_valuation numeric(14,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECONCILE',
    'event_id', p_event_id,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  select * into v_rec
    from public.event_warehouse_reconciliations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  -- Shared Event lock with dispatch/return/cancel.
  select * into v_event
    from public.events
   where organization_id = p_org_id
     and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Concurrent identical reconciliation may have committed while waiting.
  select * into v_rec
    from public.event_warehouse_reconciliations
   where organization_id = p_org_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
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

  if v_outstanding > 0 then
    raise exception 'WAREHOUSE_OUTSTANDING_QUANTITY'
      using detail = jsonb_build_object('outstanding', v_outstanding)::text;
  end if;

  select coalesce(sum(damage_loss_valuation_omr), 0)::numeric(14,3)
    into v_valuation
    from public.event_equipment_movements
   where organization_id = p_org_id and event_id = p_event_id;

  insert into public.event_warehouse_reconciliations (
    organization_id, event_id,
    total_reserved_quantity, total_dispatched_quantity,
    total_returned_good_quantity, total_damaged_quantity, total_lost_quantity,
    total_damage_loss_valuation_omr,
    notes, actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id,
    v_reserved, v_dispatched, v_good, v_damaged, v_lost,
    v_valuation,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_rec;

  perform public.record_audit(
    p_org_id, 'WAREHOUSE_RECONCILED', 'event_warehouse_reconciliation', v_rec.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'reserved', v_reserved,
      'dispatched', v_dispatched,
      'returned_good', v_good,
      'damaged', v_damaged,
      'lost', v_lost,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_rec;
end;
$$;

revoke all on function
  public.dispatch_event_equipment(uuid, uuid, uuid, int, text, text, uuid),
  public.return_event_equipment(uuid, uuid, uuid, int, int, int, text, text, uuid),
  public.reconcile_event_warehouse(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.dispatch_event_equipment(uuid, uuid, uuid, int, text, text, uuid),
  public.return_event_equipment(uuid, uuid, uuid, int, int, int, text, text, uuid),
  public.reconcile_event_warehouse(uuid, uuid, text, uuid)
  to authenticated;
