-- ============================================================================
-- 0025 — S4B consumable inventory — SCHEMA
--
-- DOMAIN MODELLING DECISION
-- -------------------------
-- Consumables (coffee, tea, dates, sugar, water, tissues, charcoal, incense,
-- disposable cups, cleaning materials …) are a QUANTITY LEDGER, not a
-- time-window reservation. They are deliberately NOT modelled through the S4A
-- reusable-equipment tables: the two inventories have different physical
-- meanings and different lifecycles (see docs/architecture/05-inventory-model).
--
-- There is NO mutable current_quantity column anywhere. All balances are
-- DERIVED from `consumable_movements`, an append-only ledger of immutable
-- physical facts:
--
--   warehouse_on_hand(item)          = Σ warehouse_delta
--   event_outstanding(event, item)   = Σ event_delta
--                                    = issued − returned − consumed − wasted
--
-- Both balances are enforced >= 0 by the database itself (command locks plus
-- the structural BEFORE INSERT guard below), never by the frontend.
--
-- EXACT QUANTITY MODEL
-- --------------------
-- Consumables use fractional units (kg, litre, pack, box, piece). The exact
-- persisted precision is numeric(12,3) — the SAME 3-decimal exact boundary the
-- repository already uses for money and for event-line quantities
-- (parseQuantityMilli in src/lib/money.ts). PostgreSQL numeric is the
-- authoritative arithmetic; the frontend normalizes decimal text into exact
-- integer milli-units and never does binary floating-point inventory math.
-- Commands REJECT more than 3 decimal places rather than silently rounding a
-- physical quantity.
--
-- MOVEMENT SEMANTICS (physical meanings, not statuses)
-- ----------------------------------------------------
--   RECEIVE            warehouse +q                 physical receipt only; the
--                                                   S5 supplier slice will link
--                                                   its receipts to this same
--                                                   movement kind rather than
--                                                   inventing a second balance
--   ISSUE_TO_EVENT     warehouse −q, custody +q     rejects stock shortage
--   RETURN_FROM_EVENT  warehouse +q, custody −q     only USABLE stock comes back
--   CONSUME_AT_EVENT   custody −q                   stock already left at issue
--   WASTE_AT_EVENT     custody −q                   never recreates warehouse stock
--   WAREHOUSE_WASTE    warehouse −q                 requires an explicit reason
--   ADJUSTMENT         warehouse ±q (signed)        OWNER/MANAGER only, reason
--                                                   required, resulting stock
--                                                   may never be negative;
--                                                   covers opening balance and
--                                                   verified count corrections
--
-- FINANCIAL BOUNDARY
-- ------------------
-- S4B records PHYSICAL QUANTITY TRUTH only. No COGS, FIFO, weighted-average
-- costing or GL postings are invented here: the repository has no accounting
-- posting contract yet, and computing "historical inventory cost" from the
-- MUTABLE current catalog cost would be a lie. The ledger keys (org, item,
-- kind, exact quantity, actor, time, reference, idempotency identity) are
-- exactly what a future authoritative costing slice needs.
--
-- LOT / EXPIRY BOUNDARY
-- ---------------------
-- Batch/expiry control is explicitly DEFERRED to a named future slice
-- (S5+ supplier receipts, where lots physically originate). No decorative
-- lot/expiry columns are created here: a stored-but-unenforced expiry field
-- would be a half-model that lies to the operator during issue.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Movement kinds — each is a distinct physical meaning (see table above).
-- ---------------------------------------------------------------------------
create type public.consumable_movement_kind as enum (
  'RECEIVE',
  'ISSUE_TO_EVENT',
  'RETURN_FROM_EVENT',
  'CONSUME_AT_EVENT',
  'WASTE_AT_EVENT',
  'WAREHOUSE_WASTE',
  'ADJUSTMENT'
);

-- ---------------------------------------------------------------------------
-- consumable_stock_items — the org-scoped stock-control profile of ONE
-- CONSUMABLE catalog item. It deliberately duplicates NO catalog identity
-- (name/unit stay in catalog_items); it only adds stock-control facts:
-- whether the item is tracked and its minimum/reorder threshold.
--
-- This row is also the SHARED LOCK for every warehouse-stock-changing
-- movement of the item (see the locking contract in 0026).
-- ---------------------------------------------------------------------------
create table public.consumable_stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  catalog_item_id uuid not null,

  is_tracking_active boolean not null default true,
  minimum_stock_quantity numeric(12,3) not null default 0
    check (minimum_stock_quantity >= 0),

  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Tenant-safe composite FK: a stock profile can never point at another
  -- organization's catalog item, independent of RLS.
  constraint consumable_stock_items_catalog_fk
    foreign key (organization_id, catalog_item_id)
    references public.catalog_items(organization_id, id) on delete restrict,

  constraint consumable_stock_items_org_id_unique unique (organization_id, id),
  constraint consumable_stock_items_org_catalog_unique unique (organization_id, catalog_item_id)
);

create index consumable_stock_items_org_idx
  on public.consumable_stock_items (organization_id);

create trigger consumable_stock_items_set_updated_at
  before update on public.consumable_stock_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Structural item-type guard: ONLY a CONSUMABLE catalog item may be stock
-- controlled. An FK cannot express this, so a trigger enforces it at the
-- data-write edge (the save command in 0026 also checks it first for a clean
-- error).
-- ---------------------------------------------------------------------------
create or replace function public.consumable_stock_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.catalog_items ci
     where ci.organization_id = new.organization_id
       and ci.id = new.catalog_item_id
       and ci.item_type = 'CONSUMABLE'
  ) then
    raise exception 'CATALOG_ITEM_NOT_CONSUMABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger consumable_stock_items_type_guard
  before insert or update on public.consumable_stock_items
  for each row execute function public.consumable_stock_item_guard();

-- Defense in depth from the catalog side: an item that has a stock profile
-- can never be re-typed away from CONSUMABLE, which would orphan the ledger's
-- business meaning.
create or replace function public.catalog_item_type_change_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.item_type is distinct from old.item_type
     and old.item_type = 'CONSUMABLE'
     and exists (
       select 1 from public.consumable_stock_items s
        where s.organization_id = old.organization_id
          and s.catalog_item_id = old.id
     ) then
    raise exception 'CATALOG_ITEM_HAS_CONSUMABLE_STOCK' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger catalog_items_consumable_type_guard
  before update of item_type on public.catalog_items
  for each row execute function public.catalog_item_type_change_guard();

-- ---------------------------------------------------------------------------
-- consumable_movements — the append-only authoritative quantity ledger.
--
-- `quantity` is the positive physical amount of the movement, EXCEPT for
-- ADJUSTMENT where it is the signed correction delta. The two derived deltas
-- are stored as GENERATED columns so every balance is a trivial exact SUM and
-- can never drift from the movement's physical meaning.
-- ---------------------------------------------------------------------------
create table public.consumable_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_item_id uuid not null,
  event_id uuid,
  movement_kind public.consumable_movement_kind not null,

  quantity numeric(12,3) not null,

  -- Exact derived effect on the warehouse on-hand balance.
  warehouse_delta numeric(12,3) not null generated always as (
    case movement_kind
      when 'RECEIVE'           then quantity
      when 'RETURN_FROM_EVENT' then quantity
      when 'ISSUE_TO_EVENT'    then -quantity
      when 'WAREHOUSE_WASTE'   then -quantity
      when 'ADJUSTMENT'        then quantity
      else 0
    end
  ) stored,

  -- Exact derived effect on the Event custody (outstanding) balance.
  event_delta numeric(12,3) not null generated always as (
    case movement_kind
      when 'ISSUE_TO_EVENT'    then quantity
      when 'RETURN_FROM_EVENT' then -quantity
      when 'CONSUME_AT_EVENT'  then -quantity
      when 'WASTE_AT_EVENT'    then -quantity
      else 0
    end
  ) stored,

  -- Operational detail. `reason` is MANDATORY for warehouse waste and
  -- adjustments: destroying or correcting stock is never anonymous.
  reason text,
  reference text,

  -- Command identity (server-derived actor; never client supplied).
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),

  -- ADJUSTMENT is signed and non-zero; every other kind is strictly positive.
  constraint consumable_movements_quantity_shape check (
    case when movement_kind = 'ADJUSTMENT'
      then quantity <> 0
      else quantity > 0
    end
  ),
  -- Event-custody kinds carry an Event; warehouse-only kinds never do.
  constraint consumable_movements_event_shape check (
    case when movement_kind in
        ('ISSUE_TO_EVENT', 'RETURN_FROM_EVENT', 'CONSUME_AT_EVENT', 'WASTE_AT_EVENT')
      then event_id is not null
      else event_id is null
    end
  ),
  -- Stock destruction/correction requires an explainable reason.
  constraint consumable_movements_reason_required check (
    movement_kind not in ('WAREHOUSE_WASTE', 'ADJUSTMENT')
    or length(trim(coalesce(reason, ''))) >= 3
  ),

  -- Composite tenant-safe FKs — no cross-organization reference is
  -- structurally possible, independent of RLS.
  constraint consumable_movements_stock_item_fk
    foreign key (organization_id, stock_item_id)
    references public.consumable_stock_items(organization_id, id) on delete restrict,
  constraint consumable_movements_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,

  constraint consumable_movements_org_id_unique unique (organization_id, id),
  -- The FINAL race guard for idempotent retries: whatever the interleaving,
  -- one (organization, idempotency key) can produce at most one movement.
  constraint consumable_movements_org_idempotency_unique unique (organization_id, idempotency_key)
);

create index consumable_movements_stock_item_idx
  on public.consumable_movements (organization_id, stock_item_id, created_at);
create index consumable_movements_event_idx
  on public.consumable_movements (organization_id, event_id, stock_item_id)
  where event_id is not null;

-- ---------------------------------------------------------------------------
-- event_consumable_reconciliations — final consumable closeout of an Event.
-- At most one per Event; append-only. Totals are frozen EVIDENCE; invariants
-- always re-derive from the ledger.
-- ---------------------------------------------------------------------------
create table public.event_consumable_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,

  total_issued_quantity numeric(14,3) not null check (total_issued_quantity >= 0),
  total_returned_quantity numeric(14,3) not null check (total_returned_quantity >= 0),
  total_consumed_quantity numeric(14,3) not null check (total_consumed_quantity >= 0),
  total_wasted_quantity numeric(14,3) not null check (total_wasted_quantity >= 0),

  notes text,
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  reconciled_at timestamptz not null default now(),

  -- Every issued unit must be explained: issued = returned + consumed + waste.
  constraint consumable_reconciliation_fully_accounted check (
    total_issued_quantity
      = total_returned_quantity + total_consumed_quantity + total_wasted_quantity
  ),

  constraint consumable_reconciliations_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint consumable_reconciliations_org_id_unique unique (organization_id, id),
  constraint consumable_reconciliations_event_unique unique (organization_id, event_id),
  constraint consumable_reconciliations_org_idempotency_unique unique (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Balance helpers — the single derivation of both balances. SECURITY DEFINER
-- with self-scoping (is_org_member) so the operational read models can call
-- them; every command re-derives through these under row locks.
-- ---------------------------------------------------------------------------
create or replace function public.consumable_stock_on_hand(
  p_org_id uuid,
  p_stock_item_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.warehouse_delta), 0)::numeric(14,3)
    from public.consumable_movements m
   where m.organization_id = p_org_id
     and m.stock_item_id = p_stock_item_id
     and public.is_org_member(p_org_id);
$$;

revoke all on function public.consumable_stock_on_hand(uuid, uuid) from public, anon;
grant execute on function public.consumable_stock_on_hand(uuid, uuid) to authenticated;

create or replace function public.event_consumable_state(
  p_org_id uuid,
  p_event_id uuid,
  p_stock_item_id uuid
)
returns table (
  issued_quantity numeric,
  returned_quantity numeric,
  consumed_quantity numeric,
  wasted_quantity numeric,
  outstanding_quantity numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0)::numeric(14,3),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0)::numeric(14,3),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'CONSUME_AT_EVENT'), 0)::numeric(14,3),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'WASTE_AT_EVENT'), 0)::numeric(14,3),
    coalesce(sum(m.event_delta), 0)::numeric(14,3)
  from public.consumable_movements m
  where m.organization_id = p_org_id
    and m.event_id = p_event_id
    and m.stock_item_id = p_stock_item_id
    and public.is_org_member(p_org_id);
$$;

revoke all on function public.event_consumable_state(uuid, uuid, uuid) from public, anon;
grant execute on function public.event_consumable_state(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only + structural concurrency guard.
--
-- UPDATE/DELETE on the ledger or the reconciliation is rejected outright:
-- physical history is immutable, corrections are NEW audited movements.
--
-- INSERT re-validates every business invariant at the data-write edge, under
-- the SAME stable lock order the commands use:
--
--     1. Event row        (movements that carry an Event)
--     2. Stock-item row   (movements that change the warehouse balance)
--
-- This is defense in depth: even a future privileged code path that bypasses
-- the RPC commands cannot create negative stock, negative custody, or a
-- movement after final reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.consumable_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event_status public.event_status;
  v_tracking boolean;
  v_on_hand numeric;
  v_outstanding numeric;
  -- GENERATED STORED columns are not yet computed inside a BEFORE trigger,
  -- so the physical deltas are re-derived here from the same expressions.
  v_warehouse_delta numeric;
  v_event_delta numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'CONSUMABLE_LEDGER_APPEND_ONLY' using errcode = '42501';
  end if;

  v_warehouse_delta := case new.movement_kind
    when 'RECEIVE'           then new.quantity
    when 'RETURN_FROM_EVENT' then new.quantity
    when 'ISSUE_TO_EVENT'    then -new.quantity
    when 'WAREHOUSE_WASTE'   then -new.quantity
    when 'ADJUSTMENT'        then new.quantity
    else 0
  end;
  v_event_delta := case new.movement_kind
    when 'ISSUE_TO_EVENT'    then new.quantity
    when 'RETURN_FROM_EVENT' then -new.quantity
    when 'CONSUME_AT_EVENT'  then -new.quantity
    when 'WASTE_AT_EVENT'    then -new.quantity
    else 0
  end;

  -- FIRST lock: the Event row — every custody movement, the final
  -- reconciliation and cancellation serialize here.
  if new.event_id is not null then
    select e.status
      into v_event_status
      from public.events e
     where e.organization_id = new.organization_id
       and e.id = new.event_id
     for update;

    if not found then
      raise exception 'EVENT_NOT_FOUND' using errcode = '23503';
    end if;

    -- A final consumable reconciliation freezes the Event's consumable
    -- history. Because we hold the Event lock, a reconciliation that
    -- committed first is always visible here.
    if exists (
      select 1 from public.event_consumable_reconciliations r
       where r.organization_id = new.organization_id
         and r.event_id = new.event_id
    ) then
      raise exception 'CONSUMABLES_ALREADY_RECONCILED';
    end if;

    if new.movement_kind = 'ISSUE_TO_EVENT'
       and v_event_status not in ('CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS') then
      -- Returns/consumption/waste stay possible in ANY status (including
      -- CANCELLED): already-issued stock is a physical obligation that
      -- cancellation never erases.
      raise exception 'EVENT_NOT_ISSUABLE';
    end if;
  end if;

  -- SECOND lock: the stock-item row — serializes every warehouse-balance
  -- change of the same item across Events and warehouse-only commands.
  select s.is_tracking_active
    into v_tracking
    from public.consumable_stock_items s
   where s.organization_id = new.organization_id
     and s.id = new.stock_item_id
   for update;

  if not found then
    raise exception 'CONSUMABLE_STOCK_ITEM_NOT_FOUND' using errcode = '23503';
  end if;

  -- Inactive tracking blocks NEW stock intake and NEW issues; it never blocks
  -- resolving custody already in the field or correcting/wasting stock.
  if not v_tracking and new.movement_kind in ('RECEIVE', 'ISSUE_TO_EVENT') then
    raise exception 'CONSUMABLE_TRACKING_INACTIVE';
  end if;

  -- Warehouse on-hand may never go negative — recomputed AFTER the lock.
  -- Summed inline (not via the self-scoped read helpers) so the invariant
  -- holds regardless of the caller's JWT context.
  if v_warehouse_delta < 0 then
    select coalesce(sum(m.warehouse_delta), 0)
      into v_on_hand
      from public.consumable_movements m
     where m.organization_id = new.organization_id
       and m.stock_item_id = new.stock_item_id;
    if v_on_hand + v_warehouse_delta < 0 then
      raise exception 'CONSUMABLE_STOCK_SHORTAGE'
        using detail = jsonb_build_object(
          'on_hand', v_on_hand::text,
          'requested', (-v_warehouse_delta)::text
        )::text;
    end if;
  end if;

  -- Event custody may never go negative — recomputed under the Event lock.
  if v_event_delta < 0 then
    select coalesce(sum(m.event_delta), 0)
      into v_outstanding
      from public.consumable_movements m
     where m.organization_id = new.organization_id
       and m.event_id = new.event_id
       and m.stock_item_id = new.stock_item_id;
    if v_outstanding + v_event_delta < 0 then
      raise exception 'CONSUMABLE_EXCEEDS_OUTSTANDING'
        using detail = jsonb_build_object(
          'outstanding', v_outstanding::text,
          'requested', (-v_event_delta)::text
        )::text;
    end if;
  end if;

  return new;
end;
$$;

create trigger consumable_movements_guard
  before insert or update or delete on public.consumable_movements
  for each row execute function public.consumable_ledger_guard();

create or replace function public.consumable_reconciliation_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CONSUMABLE_LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger event_consumable_reconciliations_append_only
  before update or delete on public.event_consumable_reconciliations
  for each row execute function public.consumable_reconciliation_append_only();
