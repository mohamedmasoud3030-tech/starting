-- ============================================================================
-- 0020 — S4 warehouse dispatch / return / damage / loss — SCHEMA
--
-- DOMAIN MODELLING DECISION
-- -------------------------
-- Physical warehouse state is NOT modelled as a mutable status column on the
-- reservation. It is DERIVED from an append-only ledger of authoritative
-- physical movements (`event_equipment_movements`). This is deliberate:
--
--   * a mutable "dispatched" flag cannot express partial dispatch, multiple
--     loads, partial returns, or mixed good/damaged/lost dispositions;
--   * a mutable counter is not auditable and can be silently corrected;
--   * a ledger makes every quantity reconstructible from immutable facts, so
--     "outstanding" is a computed invariant rather than a stored guess.
--
-- Every derived quantity for a reservation line is therefore:
--     dispatched      = sum(dispatched_quantity)      over DISPATCH rows
--     returned_good   = sum(returned_good_quantity)   over RETURN rows
--     damaged         = sum(damaged_quantity)         over RETURN rows
--     lost            = sum(lost_quantity)            over RETURN rows
--     outstanding     = dispatched - returned_good - damaged - lost
--
-- VALUATION BOUNDARY
-- ------------------
-- Damage/loss carries an IMMUTABLE valuation basis snapshot taken from the
-- catalog cost price at the moment the damage/loss was recorded. A later
-- change to `catalog_items.cost_price` can never restate a historical
-- damage/loss valuation (same snapshot invariant already used by S2 pricing).
--
-- This slice records the OPERATIONAL and VALUATION facts only. It creates NO
-- accounting postings: the current architecture defines no accounting posting
-- contract (no journal/ledger/GL tables exist). Financial recognition of
-- damage/loss is therefore explicitly OUT OF SCOPE and deferred to the slice
-- that introduces that contract; the columns persisted here (valuation basis,
-- unit valuation, extended valuation, source) are exactly what such a slice
-- needs to post from.
--
-- IMMUTABILITY
-- ------------
-- Both the movement ledger and the final reconciliation are append-only and
-- enforced by triggers (not merely by withheld grants), so even a future
-- privileged code path cannot silently rewrite physical history.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tenant-safe FK target. S3 gave event_equipment_reservations a unique key on
-- (organization_id, idempotency_key) but NOT on (organization_id, id), so a
-- composite organization-scoped FK could not reference it. Adding it here is
-- purely additive (id is already the primary key, so the constraint can never
-- fail on existing rows) and it is what structurally prevents a movement row
-- from pointing at another organization's reservation.
-- ---------------------------------------------------------------------------
alter table public.event_equipment_reservations
  add constraint event_equipment_reservations_org_id_unique
  unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- Movement kind — a physical movement is either equipment going OUT
-- (DISPATCH) or equipment being accounted for on the way back (RETURN, which
-- resolves outstanding quantity into good / damaged / lost dispositions).
-- ---------------------------------------------------------------------------
create type public.warehouse_movement_kind as enum ('DISPATCH', 'RETURN');

-- ---------------------------------------------------------------------------
-- Valuation basis — how a damage/loss monetary impact was established.
-- Recorded explicitly so a later accounting slice never has to guess.
-- ---------------------------------------------------------------------------
create type public.warehouse_valuation_basis as enum ('CATALOG_COST_SNAPSHOT');

-- ---------------------------------------------------------------------------
-- event_equipment_movements — append-only physical movement ledger.
-- ---------------------------------------------------------------------------
create table public.event_equipment_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  reservation_id uuid not null,
  equipment_capacity_id uuid not null,
  movement_kind public.warehouse_movement_kind not null,

  -- DISPATCH quantities
  dispatched_quantity int not null default 0
    check (dispatched_quantity >= 0),

  -- RETURN dispositions
  returned_good_quantity int not null default 0
    check (returned_good_quantity >= 0),
  damaged_quantity int not null default 0
    check (damaged_quantity >= 0),
  lost_quantity int not null default 0
    check (lost_quantity >= 0),

  -- Immutable valuation snapshot; present only when damage/loss was recorded.
  valuation_basis public.warehouse_valuation_basis,
  unit_valuation_omr numeric(12,3)
    check (unit_valuation_omr is null or unit_valuation_omr >= 0),
  damage_loss_valuation_omr numeric(14,3)
    check (damage_loss_valuation_omr is null or damage_loss_valuation_omr >= 0),

  -- Operational detail
  reference text,
  condition_notes text,

  -- Command identity (server-derived actor; never client supplied)
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),

  -- A DISPATCH row moves stock out and resolves nothing.
  constraint movements_dispatch_shape check (
    movement_kind <> 'DISPATCH' or (
      dispatched_quantity > 0
      and returned_good_quantity = 0
      and damaged_quantity = 0
      and lost_quantity = 0
    )
  ),
  -- A RETURN row resolves outstanding stock and moves nothing out.
  constraint movements_return_shape check (
    movement_kind <> 'RETURN' or (
      dispatched_quantity = 0
      and (returned_good_quantity + damaged_quantity + lost_quantity) > 0
    )
  ),
  -- Valuation is present exactly when damage/loss quantity exists.
  constraint movements_valuation_shape check (
    case when (damaged_quantity + lost_quantity) > 0
      then valuation_basis is not null
        and unit_valuation_omr is not null
        and damage_loss_valuation_omr is not null
      else valuation_basis is null
        and unit_valuation_omr is null
        and damage_loss_valuation_omr is null
    end
  ),

  -- Composite tenant-safe FKs: no cross-organization escape is structurally
  -- possible, independent of RLS.
  constraint movements_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint movements_reservation_fk
    foreign key (organization_id, reservation_id)
    references public.event_equipment_reservations(organization_id, id) on delete restrict,
  constraint movements_capacity_fk
    foreign key (organization_id, equipment_capacity_id)
    references public.equipment_capacity(organization_id, id) on delete restrict,

  constraint movements_org_id_unique unique (organization_id, id),
  constraint movements_org_idempotency_unique unique (organization_id, idempotency_key)
);

create index event_equipment_movements_reservation_idx
  on public.event_equipment_movements (reservation_id, created_at);
create index event_equipment_movements_event_idx
  on public.event_equipment_movements (organization_id, event_id, created_at);
create index event_equipment_movements_capacity_idx
  on public.event_equipment_movements (equipment_capacity_id);

-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- event_warehouse_reconciliations — the final, audited warehouse closure of
-- an Event. Exactly one per Event; append-only.
-- ---------------------------------------------------------------------------
create table public.event_warehouse_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,

  -- Frozen totals at the moment of reconciliation (evidence, not a cache the
  -- system reads back for invariants — invariants always re-derive from the
  -- ledger).
  total_reserved_quantity int not null check (total_reserved_quantity >= 0),
  total_dispatched_quantity int not null check (total_dispatched_quantity >= 0),
  total_returned_good_quantity int not null check (total_returned_good_quantity >= 0),
  total_damaged_quantity int not null check (total_damaged_quantity >= 0),
  total_lost_quantity int not null check (total_lost_quantity >= 0),
  total_damage_loss_valuation_omr numeric(14,3) not null
    check (total_damage_loss_valuation_omr >= 0),

  notes text,
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  reconciled_at timestamptz not null default now(),

  -- Everything dispatched must be accounted for.
  constraint reconciliation_fully_accounted check (
    total_dispatched_quantity
      = total_returned_good_quantity + total_damaged_quantity + total_lost_quantity
  ),
  constraint reconciliations_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint reconciliations_org_id_unique unique (organization_id, id),
  constraint reconciliations_event_unique unique (organization_id, event_id),
  constraint reconciliations_org_idempotency_unique unique (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement. Physical history and a final reconciliation are
-- facts: they are never updated or deleted in place. A correction must be a
-- new, separately audited command (none exists in this slice — see 0021).
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ledger_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'WAREHOUSE_LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger event_equipment_movements_append_only
  before update or delete on public.event_equipment_movements
  for each row execute function public.warehouse_ledger_is_append_only();

create trigger event_warehouse_reconciliations_append_only
  before update or delete on public.event_warehouse_reconciliations
  for each row execute function public.warehouse_ledger_is_append_only();
