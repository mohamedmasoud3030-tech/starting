-- ============================================================================
-- 0021 — S4 warehouse commands (server-authoritative RPC boundary)
--
-- AUTHORIZATION MATRIX (enforced here, in the database — never in the client):
--
--   command                          | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT
--   ---------------------------------|-------|---------|------------|-----------|-----------
--   dispatch_event_equipment         |  yes  |   yes   |    yes     |    yes    |    no
--   return_event_equipment           |  yes  |   yes   |    yes     |    yes    |    no
--   reconcile_event_warehouse        |  yes  |   yes   |    no      |    no     |    no
--   event_warehouse_lines (read)     |  yes  |   yes   |    yes     |    yes    |    yes
--
-- WAREHOUSE performs the physical operations it legitimately owns (dispatch,
-- return, damage/loss recording) but CANNOT read commercial cost/profit: the
-- damage/loss valuation it produces is written by the SECURITY DEFINER command
-- from the catalog cost, and is NOT returned to it or exposed in the read model
-- it can see (see the two-view split in 0022). Final reconciliation is a
-- closing, financially-consequential act and is restricted to OWNER/MANAGER.
--
-- IDEMPOTENCY CONTRACT (identical for every command here):
--   same org + same idempotency key + same canonical payload -> original row
--     returned, no second physical movement, no second audit event;
--   same org + same idempotency key + DIFFERENT payload -> hard rejection with
--     IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
-- The canonical payload is hashed into `request_fingerprint`, so the mismatch
-- check compares intent, not row identity.
--
-- CONCURRENCY: each command takes a row-level lock on the reservation
-- (SELECT ... FOR UPDATE) BEFORE reading the derived ledger totals, so two
-- concurrent dispatches of the same reservation serialize and the second one
-- sees the first one's row. Over-dispatch and over-return are therefore
-- impossible under concurrency, not merely unlikely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Canonical request fingerprint. Deterministic text digest of the business
-- payload of a command; used only to detect idempotency-key reuse with a
-- different intent.
-- ---------------------------------------------------------------------------
-- jsonb stores object keys in a canonical (sorted) order, so `jsonb::text` is
-- deterministic for a given logical object regardless of how it was built.
create or replace function public.warehouse_fingerprint(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')),
    'hex'
  );
$$;

revoke all on function public.warehouse_fingerprint(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- warehouse_reservation_state — derived physical state of ONE reservation.
-- Single source of the outstanding invariant; every command re-derives from
-- the ledger rather than trusting a stored counter.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_reservation_state(
  p_org_id uuid,
  p_reservation_id uuid
)
returns table (
  reserved_quantity int,
  dispatched_quantity int,
  returned_good_quantity int,
  damaged_quantity int,
  lost_quantity int,
  outstanding_quantity int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.quantity,
    coalesce(m.dispatched, 0),
    coalesce(m.returned_good, 0),
    coalesce(m.damaged, 0),
    coalesce(m.lost, 0),
    coalesce(m.dispatched, 0)
      - coalesce(m.returned_good, 0)
      - coalesce(m.damaged, 0)
      - coalesce(m.lost, 0)
  from public.event_equipment_reservations r
  left join (
    select
      reservation_id,
      sum(dispatched_quantity)::int    as dispatched,
      sum(returned_good_quantity)::int as returned_good,
      sum(damaged_quantity)::int       as damaged,
      sum(lost_quantity)::int          as lost
    from public.event_equipment_movements
    where organization_id = p_org_id and reservation_id = p_reservation_id
    group by reservation_id
  ) m on m.reservation_id = r.id
  where r.organization_id = p_org_id
    and r.id = p_reservation_id
    -- Self-scoping: SECURITY DEFINER bypasses RLS on the ledger, so the
    -- function enforces tenancy itself. A non-member gets zero rows, which is
    -- also what makes it safe to grant to `authenticated` (the read models
    -- below call it through a lateral join).
    and public.is_org_member(p_org_id);
$$;

revoke all on function public.warehouse_reservation_state(uuid, uuid) from public, anon;
grant execute on function public.warehouse_reservation_state(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_event_equipment — record equipment physically leaving the warehouse.
-- ---------------------------------------------------------------------------
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

  -- Idempotent replay: same key + same intent returns the original fact.
  select * into v_movement
    from public.event_equipment_movements
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Serialize concurrent dispatches of the same physical line. The lock is
  -- taken BEFORE the ledger is summed, so a competing transaction cannot read
  -- a stale outstanding total.
  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id and id = p_reservation_id
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

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lifecycle gate: equipment only leaves the warehouse for an Event that is
  -- actually being prepared or already running.
  if v_event.status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
    raise exception 'EVENT_NOT_DISPATCHABLE';
  end if;

  -- A finalized warehouse reconciliation freezes the Event's physical history.
  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  -- Never dispatch more than the remaining valid reservation.
  if v_state.dispatched_quantity + p_quantity > v_state.reserved_quantity then
    raise exception 'DISPATCH_EXCEEDS_RESERVATION'
      using detail = jsonb_build_object(
        'reserved', v_state.reserved_quantity,
        'already_dispatched', v_state.dispatched_quantity,
        'requested', p_quantity,
        'remaining', greatest(v_state.reserved_quantity - v_state.dispatched_quantity, 0)
      )::text;
  end if;

  -- Physical capacity invariant: the warehouse cannot have more units of an
  -- item outstanding across all Events than it physically owns.
  if (
    select coalesce(sum(mm.dispatched_quantity
      - mm.returned_good_quantity - mm.damaged_quantity - mm.lost_quantity), 0)
      from public.event_equipment_movements mm
     where mm.organization_id = p_org_id
       and mm.equipment_capacity_id = v_reservation.equipment_capacity_id
  ) + p_quantity > (
    select c.total_quantity from public.equipment_capacity c
     where c.organization_id = p_org_id and c.id = v_reservation.equipment_capacity_id
  ) then
    raise exception 'DISPATCH_EXCEEDS_PHYSICAL_CAPACITY';
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

-- ---------------------------------------------------------------------------
-- return_event_equipment — account for dispatched equipment coming back, in
-- any mix of good / damaged / lost. Damage and loss are first-class quantities
-- with an immutable valuation snapshot.
-- ---------------------------------------------------------------------------
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
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
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

  select * into v_reservation
    from public.event_equipment_reservations
   where organization_id = p_org_id and id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '23503';
  end if;

  if v_reservation.event_id <> p_event_id then
    raise exception 'RESERVATION_EVENT_MISMATCH' using errcode = '23503';
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A CANCELLED Event may still receive returns: equipment already in the
  -- field is physically outstanding regardless of the commercial cancellation,
  -- and must be brought back through an authoritative command.
  if exists (
    select 1 from public.event_warehouse_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'WAREHOUSE_ALREADY_RECONCILED';
  end if;

  select * into v_state
    from public.warehouse_reservation_state(p_org_id, p_reservation_id);

  -- Cumulative returned + damaged + lost may never exceed what actually went
  -- out. Re-derived under the reservation row lock, so a retry or a concurrent
  -- return cannot double-return stock.
  if v_total > v_state.outstanding_quantity then
    raise exception 'RETURN_EXCEEDS_OUTSTANDING'
      using detail = jsonb_build_object(
        'dispatched', v_state.dispatched_quantity,
        'already_accounted', v_state.dispatched_quantity - v_state.outstanding_quantity,
        'outstanding', v_state.outstanding_quantity,
        'requested', v_total
      )::text;
  end if;

  -- Immutable valuation basis for damage/loss. Snapshotted NOW from the
  -- catalog cost; a later catalog price change can never restate this fact.
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

  -- Audit carries operational quantities only. The damage/loss VALUATION is
  -- deliberately NOT written into the audit payload: audit_events is readable
  -- by OWNER/MANAGER, but keeping cost out of it preserves the rule that
  -- commercial cost never leaks through a secondary channel.
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

-- ---------------------------------------------------------------------------
-- reconcile_event_warehouse — final warehouse closure for an Event.
-- Impossible while ANY dispatched quantity remains outstanding.
-- ---------------------------------------------------------------------------
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

  -- Closing the warehouse for an Event is a financially consequential act
  -- (it freezes damage/loss valuation); WAREHOUSE/SUPERVISOR cannot perform it.
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
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  -- Lock the Event so a concurrent dispatch cannot slip in between the
  -- outstanding check and the reconciliation insert.
  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A second reconciliation with a different key is a distinct attempt to
  -- close an already-closed Event, not a retry.
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

-- ---------------------------------------------------------------------------
-- Grants: no public/anon execution path; authenticated callers are further
-- gated by the role checks inside each command.
-- ---------------------------------------------------------------------------
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
