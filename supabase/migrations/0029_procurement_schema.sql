-- ============================================================================
-- 0029 — S5A suppliers, procurement orders and receiving — schema
--
-- S5A records negotiated procurement cost and delivery facts. It does NOT
-- model supplier invoices, AP, settlement, customer payments, a GL or Event
-- profitability (those remain S6+). Consumable receipts link to the existing
-- S4B RECEIVE ledger; no second stock balance is introduced.
-- ============================================================================

create type public.supplier_category as enum (
  'CATERING_RESTAURANT',
  'CONSUMABLES',
  'EQUIPMENT_RENTAL',
  'GENERAL'
);

create type public.supplier_status as enum ('ACTIVE', 'INACTIVE');

create type public.procurement_order_status as enum (
  'DRAFT',
  'APPROVED',
  'SENT',
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

create type public.procurement_line_kind as enum (
  'CONSUMABLE',
  'CATERING_SERVICE',
  'OTHER'
);

-- Reuse the repository's transaction-safe document sequence for PO numbers.
alter table public.document_sequences
  drop constraint document_sequences_kind_check;
alter table public.document_sequences
  add constraint document_sequences_kind_check
  check (kind in ('EVENT', 'QUOTATION', 'PROCUREMENT_ORDER'));

-- ---------------------------------------------------------------------------
-- Global S5A command idempotency register.
--
-- Every command takes an advisory transaction lock on (organization,key),
-- checks this register, and stores the exact response snapshot. This extends
-- the established fingerprint contract to mutable aggregates: a late replay
-- returns the original transition response, not whatever state the order has
-- subsequently reached.
-- ---------------------------------------------------------------------------
create table public.procurement_command_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  command_name text not null check (length(trim(command_name)) > 0),
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  result_entity text not null check (length(trim(result_entity)) > 0),
  result_id uuid not null,
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Supplier master. Notes and commercial registration identity stay on the
-- cost-gated base table. The operational SupplierSummary view in 0031 exposes
-- only contact data needed to place/receive an order.
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category public.supplier_category not null default 'GENERAL',
  commercial_registration_number text,
  contact_name text,
  phone text,
  whatsapp text,
  email text,
  notes text,
  status public.supplier_status not null default 'ACTIVE',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_org_id_unique unique (organization_id, id)
);

create index suppliers_org_status_name_idx
  on public.suppliers (organization_id, status, name);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Procurement order aggregate header.
--
-- agreed_total_cost is an exact OMR 3-decimal snapshot maintained by draft
-- commands and re-derived immediately before approval. Supplier identity is
-- snapshotted at approval so later supplier-master edits do not rewrite order
-- history.
-- ---------------------------------------------------------------------------
create table public.procurement_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  event_id uuid,
  order_number text not null check (length(trim(order_number)) > 0),
  order_date date not null,
  expected_delivery_at timestamptz,
  notes text,
  status public.procurement_order_status not null default 'DRAFT',
  agreed_total_cost numeric(12,3) not null default 0
    check (agreed_total_cost >= 0),

  supplier_name_snapshot text,
  supplier_contact_name_snapshot text,
  supplier_phone_snapshot text,

  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,

  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint procurement_orders_supplier_fk
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint procurement_orders_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint procurement_orders_org_id_unique unique (organization_id, id),
  constraint procurement_orders_org_number_unique unique (organization_id, order_number),
  constraint procurement_orders_approval_shape check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null)
  ),
  constraint procurement_orders_sent_shape check (
    (sent_at is null and sent_by is null)
    or (sent_at is not null and sent_by is not null)
  ),
  constraint procurement_orders_confirmation_shape check (
    (confirmed_at is null and confirmed_by is null)
    or (confirmed_at is not null and confirmed_by is not null)
  ),
  constraint procurement_orders_cancellation_shape check (
    (status = 'CANCELLED'
      and cancelled_at is not null
      and cancelled_by is not null
      and length(trim(coalesce(cancellation_reason, ''))) >= 3)
    or (status <> 'CANCELLED'
      and cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null)
  )
);

create index procurement_orders_org_status_date_idx
  on public.procurement_orders (organization_id, status, order_date desc);
create index procurement_orders_event_idx
  on public.procurement_orders (organization_id, event_id)
  where event_id is not null;

create trigger procurement_orders_set_updated_at
  before update on public.procurement_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable-on-approval negotiated line snapshots.
--
-- A CONSUMABLE line must point to both the existing catalog item and its S4B
-- stock profile. Service/other lines need no fake catalog link and must not
-- carry a stock profile. Description, unit, quantity, unit cost and extended
-- total are snapshots; catalog/supplier changes cannot restate them.
-- ---------------------------------------------------------------------------
create table public.procurement_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  line_kind public.procurement_line_kind not null,
  catalog_item_id uuid,
  stock_item_id uuid,
  description text not null check (length(trim(description)) > 0),
  unit text not null check (length(trim(unit)) > 0),
  quantity numeric(12,3) not null check (quantity > 0),
  agreed_unit_cost numeric(12,3) not null check (agreed_unit_cost >= 0),
  agreed_total_cost numeric(12,3) not null check (agreed_total_cost >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),

  constraint procurement_order_lines_order_fk
    foreign key (organization_id, order_id)
    references public.procurement_orders(organization_id, id) on delete restrict,
  constraint procurement_order_lines_catalog_fk
    foreign key (organization_id, catalog_item_id)
    references public.catalog_items(organization_id, id) on delete restrict,
  constraint procurement_order_lines_stock_item_fk
    foreign key (organization_id, stock_item_id)
    references public.consumable_stock_items(organization_id, id) on delete restrict,
  constraint procurement_order_lines_org_id_unique unique (organization_id, id),
  constraint procurement_order_lines_order_id_unique unique (organization_id, order_id, id),
  constraint procurement_order_lines_stock_shape check (
    (line_kind = 'CONSUMABLE' and catalog_item_id is not null and stock_item_id is not null)
    or (line_kind <> 'CONSUMABLE' and stock_item_id is null)
  ),
  constraint procurement_order_lines_exact_total check (
    agreed_total_cost = round(quantity * agreed_unit_cost, 3)
  )
);

create index procurement_order_lines_order_idx
  on public.procurement_order_lines (organization_id, order_id, sort_order, id);

-- ---------------------------------------------------------------------------
-- Receiving is append-only. One receipt may confirm several order lines.
-- Each consumable receipt line links one-to-one to the authoritative S4B
-- RECEIVE movement; service lines deliberately carry no stock movement.
-- ---------------------------------------------------------------------------
create table public.procurement_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  received_at timestamptz not null,
  reference text,
  notes text,
  received_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint procurement_receipts_order_fk
    foreign key (organization_id, order_id)
    references public.procurement_orders(organization_id, id) on delete restrict,
  constraint procurement_receipts_org_id_unique unique (organization_id, id),
  constraint procurement_receipts_order_id_unique unique (organization_id, id, order_id),
  constraint procurement_receipts_org_idempotency_unique
    unique (organization_id, idempotency_key)
);

create index procurement_receipts_order_idx
  on public.procurement_receipts (organization_id, order_id, received_at, id);

create table public.procurement_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  order_id uuid not null,
  order_line_id uuid not null,
  quantity numeric(12,3) not null check (quantity > 0),
  consumable_movement_id uuid,
  created_at timestamptz not null default now(),

  constraint procurement_receipt_lines_receipt_fk
    foreign key (organization_id, receipt_id, order_id)
    references public.procurement_receipts(organization_id, id, order_id) on delete restrict,
  constraint procurement_receipt_lines_order_line_fk
    foreign key (organization_id, order_id, order_line_id)
    references public.procurement_order_lines(organization_id, order_id, id) on delete restrict,
  constraint procurement_receipt_lines_movement_fk
    foreign key (organization_id, consumable_movement_id)
    references public.consumable_movements(organization_id, id) on delete restrict,
  constraint procurement_receipt_lines_org_id_unique unique (organization_id, id),
  constraint procurement_receipt_lines_receipt_line_unique
    unique (organization_id, receipt_id, order_line_id),
  constraint procurement_receipt_lines_movement_unique
    unique (organization_id, consumable_movement_id)
);

create index procurement_receipt_lines_order_line_idx
  on public.procurement_receipt_lines (organization_id, order_line_id);

-- ---------------------------------------------------------------------------
-- Structural history guards (defence in depth beyond RPC-only grants).
-- ---------------------------------------------------------------------------
create or replace function public.procurement_order_history_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PROCUREMENT_ORDER_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;

  -- Structural lifecycle enforcement: even a future privileged write path
  -- cannot skip aggregate states or reopen a terminal order.
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status in ('APPROVED', 'CANCELLED'))
    or (old.status = 'APPROVED' and new.status in ('SENT', 'CANCELLED'))
    or (old.status = 'SENT' and new.status in ('CONFIRMED', 'CANCELLED'))
    or (old.status = 'CONFIRMED' and new.status in ('PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'))
    or (old.status = 'PARTIALLY_RECEIVED' and new.status in ('RECEIVED', 'CANCELLED'))
  ) then
    raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION' using errcode = '23514';
  end if;

  -- Once an order leaves DRAFT, commercial/header snapshots are immutable.
  if old.status <> 'DRAFT' and (
       new.organization_id is distinct from old.organization_id
    or new.supplier_id is distinct from old.supplier_id
    or new.event_id is distinct from old.event_id
    or new.order_number is distinct from old.order_number
    or new.order_date is distinct from old.order_date
    or new.expected_delivery_at is distinct from old.expected_delivery_at
    or new.notes is distinct from old.notes
    or new.agreed_total_cost is distinct from old.agreed_total_cost
    or new.supplier_name_snapshot is distinct from old.supplier_name_snapshot
    or new.supplier_contact_name_snapshot is distinct from old.supplier_contact_name_snapshot
    or new.supplier_phone_snapshot is distinct from old.supplier_phone_snapshot
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger procurement_orders_history_guard
  before update or delete on public.procurement_orders
  for each row execute function public.procurement_order_history_guard();

create or replace function public.procurement_order_line_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  v_order_id uuid := case when tg_op = 'INSERT' then new.order_id else old.order_id end;
  v_status public.procurement_order_status;
begin
  if tg_op = 'UPDATE' and (
       new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.order_id is distinct from old.order_id
  ) then
    raise exception 'PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;

  select o.status into v_status
    from public.procurement_orders o
   where o.organization_id = v_org_id and o.id = v_order_id
   for update;

  if not found then
    raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = '23503';
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger procurement_order_lines_guard
  before insert or update or delete on public.procurement_order_lines
  for each row execute function public.procurement_order_line_guard();

create or replace function public.procurement_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'PROCUREMENT_HISTORY_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger procurement_receipts_append_only
  before update or delete on public.procurement_receipts
  for each row execute function public.procurement_append_only_guard();
create trigger procurement_receipt_lines_append_only
  before update or delete on public.procurement_receipt_lines
  for each row execute function public.procurement_append_only_guard();
create trigger procurement_command_idempotency_append_only
  before update or delete on public.procurement_command_idempotency
  for each row execute function public.procurement_append_only_guard();

-- Supplier and order masters use lifecycle, never destructive deletion.
create or replace function public.procurement_master_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'PROCUREMENT_MASTER_DELETE_FORBIDDEN' using errcode = '42501';
end;
$$;

create trigger suppliers_no_delete
  before delete on public.suppliers
  for each row execute function public.procurement_master_no_delete();

-- A receipt line independently proves exact cumulative quantity and its S4B
-- linkage. The command performs the same checks first for domain-grade errors.
create or replace function public.procurement_receipt_line_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_line public.procurement_order_lines;
  v_prior numeric;
  v_movement public.consumable_movements;
begin
  select * into v_order
    from public.procurement_orders o
   where o.organization_id = new.organization_id and o.id = new.order_id
   for update;
  if not found then
    raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = '23503';
  end if;
  if v_order.status not in ('CONFIRMED', 'PARTIALLY_RECEIVED') then
    raise exception 'PROCUREMENT_ORDER_NOT_RECEIVABLE';
  end if;

  select * into v_line
    from public.procurement_order_lines l
   where l.organization_id = new.organization_id
     and l.order_id = new.order_id
     and l.id = new.order_line_id;
  if not found then
    raise exception 'PROCUREMENT_ORDER_LINE_NOT_FOUND' using errcode = '23503';
  end if;

  select coalesce(sum(rl.quantity), 0) into v_prior
    from public.procurement_receipt_lines rl
   where rl.organization_id = new.organization_id
     and rl.order_line_id = new.order_line_id;
  if v_prior + new.quantity > v_line.quantity then
    raise exception 'PROCUREMENT_OVER_RECEIPT' using errcode = '23514';
  end if;

  if v_line.line_kind = 'CONSUMABLE' then
    if new.consumable_movement_id is null then
      raise exception 'PROCUREMENT_RECEIVE_MOVEMENT_REQUIRED' using errcode = '23514';
    end if;
    select * into v_movement
      from public.consumable_movements m
     where m.organization_id = new.organization_id
       and m.id = new.consumable_movement_id;
    if not found
       or v_movement.movement_kind <> 'RECEIVE'
       or v_movement.stock_item_id <> v_line.stock_item_id
       or v_movement.quantity <> new.quantity then
      raise exception 'PROCUREMENT_RECEIVE_MOVEMENT_MISMATCH' using errcode = '23514';
    end if;
  elsif new.consumable_movement_id is not null then
    raise exception 'PROCUREMENT_SERVICE_HAS_STOCK_MOVEMENT' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger procurement_receipt_lines_structural_guard
  before insert on public.procurement_receipt_lines
  for each row execute function public.procurement_receipt_line_guard();
