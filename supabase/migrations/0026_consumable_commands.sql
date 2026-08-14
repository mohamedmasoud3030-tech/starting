-- ============================================================================
-- 0026 — S4B consumable commands (server-authoritative RPC boundary)
--
-- AUTHORIZATION MATRIX (enforced here, in the database — never in the client):
--
--   command                          | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT
--   ---------------------------------|-------|---------|------------|-----------|-----------
--   save_consumable_stock_item       |  yes  |   yes   |    no      |    no     |    no
--   receive_consumable_stock         |  yes  |   yes   |    yes     |    yes    |    no
--   issue_consumable_to_event        |  yes  |   yes   |    yes     |    yes    |    no
--   return_consumable_from_event     |  yes  |   yes   |    yes     |    yes    |    no
--   consume_consumable_at_event      |  yes  |   yes   |    yes     |    yes    |    no
--   waste_consumable_at_event        |  yes  |   yes   |    yes     |    yes    |    no
--   waste_consumable_stock           |  yes  |   yes   |    yes     |    yes    |    no
--   adjust_consumable_stock          |  yes  |   yes   |    no      |    no     |    no
--   reconcile_event_consumables      |  yes  |   yes   |    no      |    no     |    no
--
-- WAREHOUSE performs the physical operations it legitimately owns; sensitive
-- corrections (signed adjustments / opening balances) and the final Event
-- closeout are OWNER/MANAGER only, matching the S4A convention. No consumable
-- read model or audit payload carries commercial cost, so WAREHOUSE gains no
-- cost/profit visibility through this slice.
--
-- EXACT QUANTITY CONTRACT: quantities arrive as PostgreSQL numeric. Commands
-- REJECT (never round) any quantity with more than 3 decimal places, any
-- non-positive operational quantity, and any magnitude beyond numeric(12,3).
--
-- LOCK ORDER (stable across every command; see 0025 trigger which re-takes
-- the same locks at the data-write edge):
--
--     1. Event row          — Event-custody commands, reconciliation, and
--                             cancel_event() all serialize here first.
--     2. Stock-item row     — every warehouse-balance change of one item
--                             serializes here, across Events and
--                             warehouse-only commands.
--
-- Warehouse-only commands (receive/warehouse-waste/adjust) take only lock 2;
-- they can never hold lock 2 while waiting for lock 1, so no reversed-order
-- deadlock exists between Event and warehouse paths.
--
-- IDEMPOTENCY CONTRACT (identical to S4A):
--   same org + same key + same canonical payload  -> original row, no second
--     physical movement, no second audit event;
--   same org + same key + DIFFERENT payload       -> IDEMPOTENCY_KEY_PAYLOAD_MISMATCH;
--   concurrent identical retries                  -> idempotency re-checked
--     AFTER waiting on the shared lock, backed by the UNIQUE
--     (organization_id, idempotency_key) constraint as the final race guard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared exact-quantity validation. Rejects rather than rounds.
-- ---------------------------------------------------------------------------
create or replace function public.assert_consumable_quantity(
  p_quantity numeric,
  p_allow_negative boolean default false
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quantity is null then
    raise exception 'INVALID_QUANTITY';
  end if;
  -- More than 3 decimals would be silently rounded by numeric(12,3): reject.
  if round(p_quantity, 3) <> p_quantity then
    raise exception 'QUANTITY_PRECISION_EXCEEDED';
  end if;
  if abs(p_quantity) > 999999999.999 then
    raise exception 'QUANTITY_OUT_OF_RANGE';
  end if;
  if p_allow_negative then
    if p_quantity = 0 then
      raise exception 'INVALID_QUANTITY';
    end if;
  elsif p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
end;
$$;

revoke all on function public.assert_consumable_quantity(numeric, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_consumable_stock_item — create/update the stock-control profile of a
-- CONSUMABLE catalog item. OWNER/MANAGER (stock policy is commercial-adjacent
-- configuration, like catalog management).
-- ---------------------------------------------------------------------------
create or replace function public.save_consumable_stock_item(
  p_org_id uuid,
  p_catalog_item_id uuid,
  p_minimum_stock_quantity numeric,
  p_is_tracking_active boolean
)
returns public.consumable_stock_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.catalog_items;
  v_row public.consumable_stock_items;
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

  if p_minimum_stock_quantity is null or p_minimum_stock_quantity < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if round(p_minimum_stock_quantity, 3) <> p_minimum_stock_quantity then
    raise exception 'QUANTITY_PRECISION_EXCEEDED';
  end if;

  select * into v_item
    from public.catalog_items
   where organization_id = p_org_id and id = p_catalog_item_id;
  if not found then
    raise exception 'CATALOG_ITEM_NOT_FOUND' using errcode = '23503';
  end if;
  if v_item.item_type <> 'CONSUMABLE' then
    raise exception 'CATALOG_ITEM_NOT_CONSUMABLE' using errcode = '23514';
  end if;
  if v_item.status <> 'ACTIVE' then
    raise exception 'CATALOG_ITEM_NOT_ACTIVE';
  end if;

  insert into public.consumable_stock_items (
    organization_id, catalog_item_id,
    minimum_stock_quantity, is_tracking_active, created_by
  ) values (
    p_org_id, p_catalog_item_id,
    p_minimum_stock_quantity, coalesce(p_is_tracking_active, true), auth.uid()
  )
  on conflict (organization_id, catalog_item_id) do update
    set minimum_stock_quantity = excluded.minimum_stock_quantity,
        is_tracking_active = excluded.is_tracking_active
  returning * into v_row;

  perform public.record_audit(
    p_org_id, 'CONSUMABLE_STOCK_ITEM_SAVED', 'consumable_stock_item', v_row.id::text,
    jsonb_build_object(
      'catalog_item_id', p_catalog_item_id,
      'minimum_stock_quantity', p_minimum_stock_quantity::text,
      'is_tracking_active', v_row.is_tracking_active
    )
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal worker: shared movement writer.
--
-- Every public consumable command validates its own authorization/payload,
-- computes a canonical fingerprint, then delegates here. The worker:
--   1. replays idempotency (fast path, before any lock);
--   2. takes the Event lock first when the movement carries an Event;
--   3. RE-CHECKS idempotency after acquiring the Event lock (a concurrent
--      identical retry may have committed while we waited);
--   4. takes the stock-item lock and re-checks idempotency again for
--      warehouse-only movements;
--   5. re-derives balances under the locks and rejects violations with
--      command-grade errors (the 0025 trigger re-asserts them structurally);
--   6. inserts exactly one ledger row and exactly one audit event.
--
-- EXECUTE is granted to no client role: it is reachable only through the
-- SECURITY DEFINER commands below.
-- ---------------------------------------------------------------------------
create or replace function public.record_consumable_movement(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_event_id uuid,
  p_kind public.consumable_movement_kind,
  p_quantity numeric,
  p_reason text,
  p_reference text,
  p_idempotency_key uuid,
  p_fingerprint text,
  p_audit_action text
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.consumable_movements;
  v_event public.events;
  v_stock public.consumable_stock_items;
  v_on_hand numeric;
  v_outstanding numeric;
  v_warehouse_delta numeric;
  v_event_delta numeric;
begin
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  -- Fast-path replay before taking any lock.
  select * into v_movement
    from public.consumable_movements
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_movement.request_fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_movement;
  end if;

  v_warehouse_delta := case p_kind
    when 'RECEIVE'           then p_quantity
    when 'RETURN_FROM_EVENT' then p_quantity
    when 'ISSUE_TO_EVENT'    then -p_quantity
    when 'WAREHOUSE_WASTE'   then -p_quantity
    when 'ADJUSTMENT'        then p_quantity
    else 0
  end;
  v_event_delta := case p_kind
    when 'ISSUE_TO_EVENT'    then p_quantity
    when 'RETURN_FROM_EVENT' then -p_quantity
    when 'CONSUME_AT_EVENT'  then -p_quantity
    when 'WASTE_AT_EVENT'    then -p_quantity
    else 0
  end;

  -- FIRST lock: the Event row for custody movements.
  if p_event_id is not null then
    select * into v_event
      from public.events
     where organization_id = p_org_id and id = p_event_id
     for update;
    if not found then
      raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- A concurrent identical retry may have committed while we waited.
    select * into v_movement
      from public.consumable_movements
     where organization_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      if v_movement.request_fingerprint <> p_fingerprint then
        raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
      end if;
      return v_movement;
    end if;

    if exists (
      select 1 from public.event_consumable_reconciliations
       where organization_id = p_org_id and event_id = p_event_id
    ) then
      raise exception 'CONSUMABLES_ALREADY_RECONCILED';
    end if;

    -- Stock only leaves the warehouse for an Event actually being prepared
    -- or running. Returns/consumption/waste stay possible in ANY status —
    -- including CANCELLED — because issued stock is a physical obligation.
    if p_kind = 'ISSUE_TO_EVENT'
       and v_event.status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
      raise exception 'EVENT_NOT_ISSUABLE';
    end if;
  end if;

  -- SECOND lock: the stock-item row.
  select * into v_stock
    from public.consumable_stock_items
   where organization_id = p_org_id and id = p_stock_item_id
   for update;
  if not found then
    raise exception 'CONSUMABLE_STOCK_ITEM_NOT_FOUND' using errcode = '23503';
  end if;

  -- Warehouse-only movements did not pass the Event-lock replay re-check;
  -- re-check here now that we hold their serialization lock.
  if p_event_id is null then
    select * into v_movement
      from public.consumable_movements
     where organization_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      if v_movement.request_fingerprint <> p_fingerprint then
        raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
      end if;
      return v_movement;
    end if;
  end if;

  if not v_stock.is_tracking_active and p_kind in ('RECEIVE', 'ISSUE_TO_EVENT') then
    raise exception 'CONSUMABLE_TRACKING_INACTIVE';
  end if;

  -- Balance invariants, re-derived AFTER the locks (never from a cache).
  if v_warehouse_delta < 0 then
    select coalesce(sum(m.warehouse_delta), 0)
      into v_on_hand
      from public.consumable_movements m
     where m.organization_id = p_org_id and m.stock_item_id = p_stock_item_id;
    if v_on_hand + v_warehouse_delta < 0 then
      raise exception 'CONSUMABLE_STOCK_SHORTAGE'
        using detail = jsonb_build_object(
          'on_hand', v_on_hand::text,
          'requested', (-v_warehouse_delta)::text
        )::text;
    end if;
  end if;

  if v_event_delta < 0 then
    select coalesce(sum(m.event_delta), 0)
      into v_outstanding
      from public.consumable_movements m
     where m.organization_id = p_org_id
       and m.event_id = p_event_id
       and m.stock_item_id = p_stock_item_id;
    if v_outstanding + v_event_delta < 0 then
      raise exception 'CONSUMABLE_EXCEEDS_OUTSTANDING'
        using detail = jsonb_build_object(
          'outstanding', v_outstanding::text,
          'requested', (-v_event_delta)::text
        )::text;
    end if;
  end if;

  insert into public.consumable_movements (
    organization_id, stock_item_id, event_id, movement_kind, quantity,
    reason, reference,
    actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_stock_item_id, p_event_id, p_kind, p_quantity,
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    auth.uid(), p_idempotency_key, p_fingerprint
  )
  returning * into v_movement;

  -- One audit event per physical movement. Quantities are exact decimal text;
  -- no commercial cost is ever written into a consumable audit payload.
  perform public.record_audit(
    p_org_id, p_audit_action, 'consumable_movement', v_movement.id::text,
    jsonb_build_object(
      'stock_item_id', p_stock_item_id,
      'catalog_item_id', v_stock.catalog_item_id,
      'event_id', p_event_id,
      'movement_kind', p_kind,
      'quantity', p_quantity::text,
      'reason', v_movement.reason,
      'reference', v_movement.reference,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_movement;
end;
$$;

revoke all on function public.record_consumable_movement(
  uuid, uuid, uuid, public.consumable_movement_kind, numeric, text, text, uuid, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- receive_consumable_stock — physical warehouse receipt (S5 supplier receipts
-- will later create/link these movements; no purchasing workflow exists here).
-- ---------------------------------------------------------------------------
create or replace function public.receive_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'RECEIVE', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_RECEIVE',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_RECEIVED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_consumable_to_event — warehouse −q, Event custody +q. Rejects stock
-- shortage transactionally.
-- ---------------------------------------------------------------------------
create or replace function public.issue_consumable_to_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'ISSUE_TO_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_ISSUE',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_ISSUED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- return_consumable_from_event — USABLE stock back into the warehouse.
-- Custody −q, warehouse +q. Possible after cancellation (physical obligation).
-- ---------------------------------------------------------------------------
create or replace function public.return_consumable_from_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'RETURN_FROM_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_RETURN',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_RETURNED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- consume_consumable_at_event — custody −q; warehouse unchanged (the stock
-- already left at issue time; consumption never double-decrements).
-- ---------------------------------------------------------------------------
create or replace function public.consume_consumable_at_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reference text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'CONSUME_AT_EVENT', p_quantity,
    null, p_reference, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_CONSUME',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reference', nullif(trim(coalesce(p_reference, '')), '')
    )),
    'CONSUMABLE_CONSUMED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- waste_consumable_at_event — custody −q; never recreates warehouse stock.
-- ---------------------------------------------------------------------------
create or replace function public.waste_consumable_at_event(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, p_event_id, 'WASTE_AT_EVENT', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_EVENT_WASTE',
      'event_id', p_event_id,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_EVENT_WASTED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- waste_consumable_stock — deliberate warehouse-level spoilage/destruction.
-- Warehouse −q; requires an explainable reason (CHECK enforces >= 3 chars).
-- ---------------------------------------------------------------------------
create or replace function public.waste_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role, 'WAREHOUSE'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity);

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'WASTE_REASON_REQUIRED';
  end if;

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'WAREHOUSE_WASTE', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_WAREHOUSE_WASTE',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_WAREHOUSE_WASTED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- adjust_consumable_stock — controlled signed correction (opening balance,
-- verified count correction). OWNER/MANAGER only; explicit reason; the
-- resulting balance may never be negative. This is NOT a generic escape
-- hatch: it cannot touch Event custody, and every use is audited with its
-- reason and exact signed quantity.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_consumable_stock(
  p_org_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns public.consumable_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_consumable_quantity(p_quantity, true);

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;

  return public.record_consumable_movement(
    p_org_id, p_stock_item_id, null, 'ADJUSTMENT', p_quantity,
    p_reason, null, p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'CONSUMABLE_ADJUSTMENT',
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity::text,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )),
    'CONSUMABLE_ADJUSTED'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reconcile_event_consumables — final consumable closeout of an Event.
-- Impossible while ANY issued quantity remains unexplained. OWNER/MANAGER.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_event_consumables(
  p_org_id uuid,
  p_event_id uuid,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_consumable_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.event_consumable_reconciliations;
  v_event public.events;
  v_fingerprint text;
  v_issued numeric;
  v_returned numeric;
  v_consumed numeric;
  v_wasted numeric;
  v_outstanding numeric;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CONSUMABLE_RECONCILE',
    'event_id', p_event_id,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));

  select * into v_rec
    from public.event_consumable_reconciliations
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  -- The shared Event lock: no concurrent issue/return/consume/waste can land
  -- between the outstanding check and the reconciliation insert.
  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A concurrent identical retry may have committed while we waited.
  select * into v_rec
    from public.event_consumable_reconciliations
   where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_rec;
  end if;

  if exists (
    select 1 from public.event_consumable_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  ) then
    raise exception 'CONSUMABLES_ALREADY_RECONCILED';
  end if;

  select
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'CONSUME_AT_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'WASTE_AT_EVENT'), 0),
    coalesce(sum(m.event_delta), 0)
  into v_issued, v_returned, v_consumed, v_wasted, v_outstanding
  from public.consumable_movements m
  where m.organization_id = p_org_id and m.event_id = p_event_id;

  if v_outstanding > 0 then
    raise exception 'CONSUMABLE_OUTSTANDING_QUANTITY'
      using detail = jsonb_build_object('outstanding', v_outstanding::text)::text;
  end if;

  insert into public.event_consumable_reconciliations (
    organization_id, event_id,
    total_issued_quantity, total_returned_quantity,
    total_consumed_quantity, total_wasted_quantity,
    notes, actor_id, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id,
    v_issued, v_returned, v_consumed, v_wasted,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  )
  returning * into v_rec;

  perform public.record_audit(
    p_org_id, 'CONSUMABLES_RECONCILED', 'event_consumable_reconciliation', v_rec.id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'issued', v_issued::text,
      'returned', v_returned::text,
      'consumed', v_consumed::text,
      'wasted', v_wasted::text,
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
  public.save_consumable_stock_item(uuid, uuid, numeric, boolean),
  public.receive_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.issue_consumable_to_event(uuid, uuid, uuid, numeric, text, uuid),
  public.return_consumable_from_event(uuid, uuid, uuid, numeric, text, uuid),
  public.consume_consumable_at_event(uuid, uuid, uuid, numeric, text, uuid),
  public.waste_consumable_at_event(uuid, uuid, uuid, numeric, text, uuid),
  public.waste_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.adjust_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.reconcile_event_consumables(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.save_consumable_stock_item(uuid, uuid, numeric, boolean),
  public.receive_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.issue_consumable_to_event(uuid, uuid, uuid, numeric, text, uuid),
  public.return_consumable_from_event(uuid, uuid, uuid, numeric, text, uuid),
  public.consume_consumable_at_event(uuid, uuid, uuid, numeric, text, uuid),
  public.waste_consumable_at_event(uuid, uuid, uuid, numeric, text, uuid),
  public.waste_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.adjust_consumable_stock(uuid, uuid, numeric, text, uuid),
  public.reconcile_event_consumables(uuid, uuid, text, uuid)
  to authenticated;
