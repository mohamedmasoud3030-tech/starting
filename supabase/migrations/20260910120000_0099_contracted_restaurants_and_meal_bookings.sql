-- ============================================================================
-- 0099 — Contracted restaurants & event meal bookings
--
-- «المطعم المتعاقد» (CATERING_RESTAURANT): a standing contract with a food
-- supplier (per-guest prices for lunch/dinner, validity window, notice and
-- payment terms) plus pre-booked event meal reservations (غداء/عشاء) that
-- carry an exact monetary snapshot and a lifecycle:
--
--     PENDING (قيد التأكيد) → CONFIRMED (مؤكد) → SERVED (منجز)
--            ↘ CANCELLED (ملغي)
--
-- Financial posture matches the repository rule set: the amounts are exact
-- and appear in cost-gated read models (event commitment, supplier view);
-- no ledger entry is fabricated here — real AP/invoice posting continues to
-- happen through the existing expense/procurement settlement flow once the
-- meal is invoiced by the restaurant.
--
-- Conventions mirrored from S5A (0029–0034):
--   * organization-scoped tables, RLS enabled, no client write policies;
--   * all writes are SECURITY DEFINER command functions with the shared
--     idempotency register and audit trail;
--   * raw tables are revoked from clients; stable read models are granted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'meal_service_type') then
    create type public.meal_service_type as enum ('LUNCH', 'DINNER');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'meal_booking_status') then
    create type public.meal_booking_status as enum ('PENDING', 'CONFIRMED', 'CANCELLED', 'SERVED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'supplier_contract_status') then
    create type public.supplier_contract_status as enum ('ACTIVE', 'ENDED');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Supplier contract (restaurant). Only CATERING_RESTAURANT suppliers.
-- ---------------------------------------------------------------------------
create table public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  contract_number text not null check (length(trim(contract_number)) > 0),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  lunch_unit_price numeric(12,3) not null default 0 check (lunch_unit_price >= 0),
  dinner_unit_price numeric(12,3) not null default 0 check (dinner_unit_price >= 0),
  minimum_guests integer not null default 0 check (minimum_guests >= 0),
  cut_off_hours numeric(6,1) not null default 24 check (cut_off_hours >= 0),
  payment_terms text,
  notes text,
  status public.supplier_contract_status not null default 'ACTIVE',
  ended_by uuid references auth.users(id),
  ended_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_contracts_supplier_fk
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint supplier_contracts_org_id_unique unique (organization_id, id),
  constraint supplier_contracts_number_unique unique (organization_id, contract_number)
);

create index supplier_contracts_org_status_idx
  on public.supplier_contracts (organization_id, status, starts_on);

-- At most one ACTIVE contract per restaurant supplier.
create unique index supplier_contracts_one_active_idx
  on public.supplier_contracts (organization_id, supplier_id)
  where status = 'ACTIVE';

create trigger supplier_contracts_set_updated_at
  before update on public.supplier_contracts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event meal booking (حجز وجبة فعالية عند مطعم متعاقد).
-- Monetary snapshot (unit_price/total_amount) is fixed at creation time so
-- later contract edits never rewrite committed bookings.
-- ---------------------------------------------------------------------------
create table public.event_meal_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  supplier_id uuid not null,
  contract_id uuid not null,
  meal_type public.meal_service_type not null,
  service_date date not null,
  guest_count integer not null check (guest_count > 0),
  unit_price numeric(12,3) not null check (unit_price >= 0),
  total_amount numeric(12,3) not null,
  menu_summary text,
  notes text,
  status public.meal_booking_status not null default 'PENDING',
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  served_by uuid references auth.users(id),
  served_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_meal_bookings_org_id_unique unique (organization_id, id),
  constraint event_meal_bookings_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint event_meal_bookings_supplier_fk
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint event_meal_bookings_contract_fk
    foreign key (organization_id, contract_id)
    references public.supplier_contracts(organization_id, id) on delete restrict,
  constraint event_meal_bookings_total_check
    check (total_amount = guest_count * unit_price),
  constraint event_meal_bookings_status_cancel_reason_check
    check (
      (status <> 'CANCELLED' and cancellation_reason is null)
      or (status = 'CANCELLED' and length(trim(coalesce(cancellation_reason, ''))) > 0)
    )
);

create index event_meal_bookings_org_event_idx
  on public.event_meal_bookings (organization_id, event_id, service_date);
create index event_meal_bookings_org_supplier_idx
  on public.event_meal_bookings (organization_id, supplier_id, service_date);
create index event_meal_bookings_org_status_idx
  on public.event_meal_bookings (organization_id, status, service_date);

-- No duplicate open booking for the same meal of the same event/restaurant/day.
create unique index event_meal_bookings_open_unique_idx
  on public.event_meal_bookings (organization_id, event_id, supplier_id, meal_type, service_date)
  where status in ('PENDING', 'CONFIRMED');

create trigger event_meal_bookings_set_updated_at
  before update on public.event_meal_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Cost-bearing tables are visible to cost readers only; writes flow
-- exclusively through SECURITY DEFINER commands below.
-- ---------------------------------------------------------------------------
alter table public.supplier_contracts enable row level security;
alter table public.event_meal_bookings enable row level security;

create policy supplier_contracts_cost_reader_select on public.supplier_contracts
  for select using (public.can_read_cost(organization_id));
create policy event_meal_bookings_cost_reader_select on public.event_meal_bookings
  for select using (public.can_read_cost(organization_id));
-- No INSERT/UPDATE/DELETE policy on either table.

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------

-- ContractRestaurantSummaries — restaurant contracts with exact pricing for
-- cost readers (procurement/«المطاعم المتعاقدة» surface).
create view public.supplier_contract_summaries as
select
  c.id as contract_id,
  c.organization_id,
  c.supplier_id,
  s.name as supplier_name,
  s.category,
  s.phone,
  s.whatsapp,
  c.contract_number,
  c.starts_on,
  c.ends_on,
  c.lunch_unit_price,
  c.dinner_unit_price,
  c.minimum_guests,
  c.cut_off_hours,
  c.payment_terms,
  c.notes,
  c.status,
  c.ended_at,
  c.created_at,
  c.updated_at,
  case
    when c.status = 'ACTIVE' and current_date between c.starts_on and c.ends_on then true
    else false
  end as currently_valid
from public.supplier_contracts c
join public.suppliers s
  on s.organization_id = c.organization_id and s.id = c.supplier_id
where public.can_read_cost(c.organization_id);

-- MealBookingSummaries — cost-bearing booking list (event, restaurant,
-- contract, exact amounts, lifecycle actors).
create view public.meal_booking_summaries as
select
  b.id as booking_id,
  b.organization_id,
  b.event_id,
  e.event_number,
  e.title as event_title,
  b.supplier_id,
  s.name as supplier_name,
  b.contract_id,
  c.contract_number,
  b.meal_type,
  b.service_date,
  b.guest_count,
  b.unit_price,
  b.total_amount,
  b.menu_summary,
  b.notes,
  b.status,
  b.confirmed_by,
  b.confirmed_at,
  b.cancelled_by,
  b.cancelled_at,
  b.cancellation_reason,
  b.served_by,
  b.served_at,
  b.created_at,
  b.updated_at
from public.event_meal_bookings b
join public.events e
  on e.organization_id = b.organization_id and e.id = b.event_id
join public.suppliers s
  on s.organization_id = b.organization_id and s.id = b.supplier_id
join public.supplier_contracts c
  on c.organization_id = b.organization_id and c.id = b.contract_id
where public.can_read_cost(b.organization_id);

-- MealBookingOperational — member-safe projection WITHOUT amounts for teams
-- that run the event day but are not cost readers (status coordination only).
create view public.meal_booking_operational as
select
  b.id as booking_id,
  b.organization_id,
  b.event_id,
  e.event_number,
  e.title as event_title,
  b.supplier_id,
  s.name as supplier_name,
  b.contract_id,
  c.contract_number,
  b.meal_type,
  b.service_date,
  b.guest_count,
  b.menu_summary,
  b.status,
  b.created_at,
  b.updated_at
from public.event_meal_bookings b
join public.events e
  on e.organization_id = b.organization_id and e.id = b.event_id
join public.suppliers s
  on s.organization_id = b.organization_id and s.id = b.supplier_id
join public.supplier_contracts c
  on c.organization_id = b.organization_id and c.id = b.contract_id
where public.is_org_member(b.organization_id);

-- ---------------------------------------------------------------------------
-- Command: create supplier contract (OWNER/MANAGER).
-- ---------------------------------------------------------------------------
create or replace function public.create_supplier_contract(
  p_org_id uuid,
  p_supplier_id uuid,
  p_contract_number text,
  p_starts_on date,
  p_ends_on date,
  p_lunch_unit_price numeric,
  p_dinner_unit_price numeric,
  p_minimum_guests integer,
  p_cut_off_hours numeric,
  p_payment_terms text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.supplier_contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.supplier_contracts;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_contract_number, ''))) = 0 then
    raise exception 'CONTRACT_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.suppliers s
    where s.organization_id = p_org_id and s.id = p_supplier_id
      and s.category = 'CATERING_RESTAURANT'::public.supplier_category
      and s.status = 'ACTIVE'::public.supplier_status
  ) then
    raise exception 'SUPPLIER_NOT_CONTRACTABLE' using errcode = '23503';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'INVALID_CONTRACT_RANGE' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_SUPPLIER_CONTRACT',
    'supplier_id', p_supplier_id,
    'contract_number', trim(p_contract_number),
    'starts_on', p_starts_on,
    'ends_on', p_ends_on,
    'lunch_unit_price', p_lunch_unit_price,
    'dinner_unit_price', p_dinner_unit_price,
    'minimum_guests', p_minimum_guests,
    'cut_off_hours', p_cut_off_hours,
    'payment_terms', nullif(trim(coalesce(p_payment_terms, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_contracts, v_replay);
  end if;

  insert into public.supplier_contracts (
    organization_id, supplier_id, contract_number, starts_on, ends_on,
    lunch_unit_price, dinner_unit_price, minimum_guests, cut_off_hours,
    payment_terms, notes, created_by, updated_by
  ) values (
    p_org_id, p_supplier_id, trim(p_contract_number), p_starts_on, p_ends_on,
    coalesce(p_lunch_unit_price, 0), coalesce(p_dinner_unit_price, 0),
    coalesce(p_minimum_guests, 0), coalesce(p_cut_off_hours, 24),
    nullif(trim(coalesce(p_payment_terms, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), auth.uid()
  ) returning * into v_contract;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_CONTRACT_CREATED', 'supplier_contract', v_contract.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'supplier_id', v_contract.supplier_id)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_SUPPLIER_CONTRACT', v_fingerprint,
    'supplier_contract', v_contract.id, to_jsonb(v_contract)
  );
  return v_contract;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: end (archive) a supplier contract (OWNER/MANAGER).
-- ---------------------------------------------------------------------------
create or replace function public.end_supplier_contract(
  p_org_id uuid,
  p_contract_id uuid,
  p_idempotency_key uuid
)
returns public.supplier_contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.supplier_contracts;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where organization_id = p_org_id and id = p_contract_id
  for update;
  if v_contract.id is null then
    raise exception 'SUPPLIER_CONTRACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_contract.status <> 'ACTIVE'::public.supplier_contract_status then
    raise exception 'INVALID_LIFECYCLE' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'END_SUPPLIER_CONTRACT',
    'contract_id', p_contract_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_contracts, v_replay);
  end if;

  update public.supplier_contracts
  set status = 'ENDED'::public.supplier_contract_status,
      ends_on = least(ends_on, current_date),
      ended_by = auth.uid(),
      ended_at = now(),
      updated_by = auth.uid()
  where id = v_contract.id
  returning * into v_contract;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_CONTRACT_ENDED', 'supplier_contract', v_contract.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'END_SUPPLIER_CONTRACT', v_fingerprint,
    'supplier_contract', v_contract.id, to_jsonb(v_contract)
  );
  return v_contract;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: create meal booking (OWNER/MANAGER/SUPERVISOR). Unit price is
-- snapshotted from the ACTIVE restaurant contract for the requested meal.
-- ---------------------------------------------------------------------------
create or replace function public.create_meal_booking(
  p_org_id uuid,
  p_event_id uuid,
  p_supplier_id uuid,
  p_meal_type public.meal_service_type,
  p_service_date date,
  p_guest_count integer,
  p_menu_summary text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.event_meal_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.supplier_contracts;
  v_booking public.event_meal_bookings;
  v_unit_price numeric(12,3);
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.events e
    where e.organization_id = p_org_id and e.id = p_event_id
  ) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(p_guest_count, 0) <= 0 then
    raise exception 'GUEST_COUNT_REQUIRED' using errcode = '22023';
  end if;

  -- Active contract for that restaurant drives the per-guest price.
  select * into v_contract
  from public.supplier_contracts
  where organization_id = p_org_id
    and supplier_id = p_supplier_id
    and status = 'ACTIVE'::public.supplier_contract_status
  order by starts_on desc
  limit 1
  for update;
  if v_contract.id is null then
    raise exception 'NO_ACTIVE_CONTRACT' using errcode = '23503';
  end if;
  if p_service_date < v_contract.starts_on or p_service_date > v_contract.ends_on then
    raise exception 'CONTRACT_DATE_MISMATCH' using errcode = '22023';
  end if;

  v_unit_price := case p_meal_type
    when 'LUNCH'::public.meal_service_type then v_contract.lunch_unit_price
    when 'DINNER'::public.meal_service_type then v_contract.dinner_unit_price
  end;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_MEAL_BOOKING',
    'event_id', p_event_id,
    'supplier_id', p_supplier_id,
    'contract_id', v_contract.id,
    'meal_type', p_meal_type,
    'service_date', p_service_date,
    'guest_count', p_guest_count
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_meal_bookings, v_replay);
  end if;

  insert into public.event_meal_bookings (
    organization_id, event_id, supplier_id, contract_id, meal_type,
    service_date, guest_count, unit_price, total_amount,
    menu_summary, notes, created_by, updated_by
  ) values (
    p_org_id, p_event_id, p_supplier_id, v_contract.id, p_meal_type,
    p_service_date, p_guest_count, v_unit_price, round(p_guest_count * v_unit_price, 3),
    nullif(trim(coalesce(p_menu_summary, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(), auth.uid()
  ) returning * into v_booking;

  perform public.record_audit(
    p_org_id, 'MEAL_BOOKING_CREATED', 'meal_booking', v_booking.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'event_id', p_event_id)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_MEAL_BOOKING', v_fingerprint,
    'meal_booking', v_booking.id, to_jsonb(v_booking)
  );
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: confirm meal booking (OWNER/MANAGER). PENDING → CONFIRMED.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_meal_booking(
  p_org_id uuid,
  p_booking_id uuid,
  p_idempotency_key uuid
)
returns public.event_meal_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.event_meal_bookings;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_booking
  from public.event_meal_bookings
  where organization_id = p_org_id and id = p_booking_id
  for update;
  if v_booking.id is null then
    raise exception 'MEAL_BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'PENDING'::public.meal_booking_status then
    raise exception 'INVALID_LIFECYCLE' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CONFIRM_MEAL_BOOKING',
    'booking_id', p_booking_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_meal_bookings, v_replay);
  end if;

  update public.event_meal_bookings
  set status = 'CONFIRMED'::public.meal_booking_status,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      updated_by = auth.uid()
  where id = v_booking.id
  returning * into v_booking;

  perform public.record_audit(
    p_org_id, 'MEAL_BOOKING_CONFIRMED', 'meal_booking', v_booking.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CONFIRM_MEAL_BOOKING', v_fingerprint,
    'meal_booking', v_booking.id, to_jsonb(v_booking)
  );
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: cancel meal booking (OWNER/MANAGER). PENDING/CONFIRMED → CANCELLED.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_meal_booking(
  p_org_id uuid,
  p_booking_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.event_meal_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.event_meal_bookings;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'CANCELLATION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_booking
  from public.event_meal_bookings
  where organization_id = p_org_id and id = p_booking_id
  for update;
  if v_booking.id is null then
    raise exception 'MEAL_BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_booking.status not in ('PENDING'::public.meal_booking_status, 'CONFIRMED'::public.meal_booking_status) then
    raise exception 'INVALID_LIFECYCLE' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CANCEL_MEAL_BOOKING',
    'booking_id', p_booking_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_meal_bookings, v_replay);
  end if;

  update public.event_meal_bookings
  set status = 'CANCELLED'::public.meal_booking_status,
      cancellation_reason = trim(p_reason),
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      updated_by = auth.uid()
  where id = v_booking.id
  returning * into v_booking;

  perform public.record_audit(
    p_org_id, 'MEAL_BOOKING_CANCELLED', 'meal_booking', v_booking.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CANCEL_MEAL_BOOKING', v_fingerprint,
    'meal_booking', v_booking.id, to_jsonb(v_booking)
  );
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: mark meal booking served (OWNER/MANAGER/SUPERVISOR).
-- CONFIRMED → SERVED — the point where settlement/invoicing takes over.
-- ---------------------------------------------------------------------------
create or replace function public.mark_meal_booking_served(
  p_org_id uuid,
  p_booking_id uuid,
  p_idempotency_key uuid
)
returns public.event_meal_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.event_meal_bookings;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_booking
  from public.event_meal_bookings
  where organization_id = p_org_id and id = p_booking_id
  for update;
  if v_booking.id is null then
    raise exception 'MEAL_BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'CONFIRMED'::public.meal_booking_status then
    raise exception 'INVALID_LIFECYCLE' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'MARK_MEAL_BOOKING_SERVED',
    'booking_id', p_booking_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.event_meal_bookings, v_replay);
  end if;

  update public.event_meal_bookings
  set status = 'SERVED'::public.meal_booking_status,
      served_by = auth.uid(),
      served_at = now(),
      updated_by = auth.uid()
  where id = v_booking.id
  returning * into v_booking;

  perform public.record_audit(
    p_org_id, 'MEAL_BOOKING_SERVED', 'meal_booking', v_booking.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'MARK_MEAL_BOOKING_SERVED', v_fingerprint,
    'meal_booking', v_booking.id, to_jsonb(v_booking)
  );
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on table
  public.supplier_contracts,
  public.event_meal_bookings,
  public.supplier_contract_summaries,
  public.meal_booking_summaries,
  public.meal_booking_operational
  from anon, authenticated;

grant select on table
  public.supplier_contract_summaries,
  public.meal_booking_summaries,
  public.meal_booking_operational
  to authenticated;

revoke all on function
  public.create_supplier_contract(uuid,uuid,text,date,date,numeric,numeric,integer,numeric,text,text,uuid),
  public.end_supplier_contract(uuid,uuid,uuid),
  public.create_meal_booking(uuid,uuid,uuid,public.meal_service_type,date,integer,text,text,uuid),
  public.confirm_meal_booking(uuid,uuid,uuid),
  public.cancel_meal_booking(uuid,uuid,text,uuid),
  public.mark_meal_booking_served(uuid,uuid,uuid)
  from public, anon;

grant execute on function
  public.create_supplier_contract(uuid,uuid,text,date,date,numeric,numeric,integer,numeric,text,text,uuid),
  public.end_supplier_contract(uuid,uuid,uuid),
  public.create_meal_booking(uuid,uuid,uuid,public.meal_service_type,date,integer,text,text,uuid),
  public.confirm_meal_booking(uuid,uuid,uuid),
  public.cancel_meal_booking(uuid,uuid,text,uuid),
  public.mark_meal_booking_served(uuid,uuid,uuid)
  to authenticated;
