-- ============================================================================
-- 0032 — S5A procurement concurrency + S4B linkage hardening
--
-- Independent review found two invariants that were correct on the normal RPC
-- path but not fully serialized/structurally enforced:
--
-- 1. create/update order checked ACTIVE supplier with a plain snapshot read.
--    A concurrent supplier deactivation could therefore commit beside the
--    order command and leave a draft pointing at a supplier that was already
--    inactive at the serialization boundary.
--
-- 2. receipt-line -> S4B RECEIVE coherence existed in receive_procurement_order
--    but was not independently enforced at the receipt-line INSERT edge.
--
-- This forward-only layer keeps all public signatures unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supplier serialization for draft create/update.
-- Lock discipline:
--   create: idempotency advisory -> supplier -> new order (not externally visible)
--   update: idempotency advisory -> order -> supplier
-- Approval already uses: idempotency advisory -> order -> supplier.
-- No supplier-only command ever waits on an order row, so no reversed cycle is
-- introduced.
-- ---------------------------------------------------------------------------
create or replace function public.create_procurement_order(
  p_org_id uuid,
  p_supplier_id uuid,
  p_event_id uuid,
  p_order_date date,
  p_expected_delivery_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
  v_number text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_order_date is null then
    raise exception 'PROCUREMENT_ORDER_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_PROCUREMENT_ORDER', 'supplier_id', p_supplier_id,
    'event_id', p_event_id, 'order_date', p_order_date,
    'expected_delivery_at', p_expected_delivery_at,
    'notes', nullif(trim(coalesce(p_notes, '')), ''), 'lines', p_lines
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.procurement_orders, v_replay);
  end if;

  -- Shared serialization point with supplier status changes.
  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id
     and s.id = p_supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e
     where e.organization_id = p_org_id and e.id = p_event_id
       and e.status not in ('CLOSED', 'CANCELLED')
  ) then
    raise exception 'EVENT_NOT_PROCUREABLE' using errcode = '23503';
  end if;

  v_number := public.next_document_number(p_org_id, 'PROCUREMENT_ORDER', 'PO');
  insert into public.procurement_orders (
    organization_id, supplier_id, event_id, order_number, order_date,
    expected_delivery_at, notes, created_by, updated_by
  ) values (
    p_org_id, p_supplier_id, p_event_id, v_number, p_order_date,
    p_expected_delivery_at, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid()
  ) returning * into v_order;

  perform public.replace_procurement_lines_internal(
    p_org_id, v_order.id, coalesce(p_lines, '[]'::jsonb)
  );
  select * into v_order from public.procurement_orders where id = v_order.id;

  perform public.record_audit(
    p_org_id, 'PROCUREMENT_ORDER_CREATED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'order_number', v_order.order_number)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_PROCUREMENT_ORDER', v_fingerprint,
    'procurement_order', v_order.id, to_jsonb(v_order)
  );
  return v_order;
end;
$$;

create or replace function public.update_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_supplier_id uuid,
  p_event_id uuid,
  p_order_date date,
  p_expected_delivery_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procurement_orders;
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_order_date is null then
    raise exception 'PROCUREMENT_ORDER_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'UPDATE_PROCUREMENT_ORDER', 'order_id', p_order_id,
    'supplier_id', p_supplier_id, 'event_id', p_event_id, 'order_date', p_order_date,
    'expected_delivery_at', p_expected_delivery_at,
    'notes', nullif(trim(coalesce(p_notes, '')), ''), 'lines', p_lines
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.procurement_orders, v_replay);
  end if;

  -- Stable aggregate lock first.
  select * into v_order
    from public.procurement_orders o
   where o.organization_id = p_org_id and o.id = p_order_id
   for update;
  if not found then
    raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception 'PROCUREMENT_ORDER_NOT_EDITABLE';
  end if;

  -- Then serialize against target supplier lifecycle changes, matching the
  -- approval lock order (order -> supplier).
  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id
     and s.id = p_supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e
     where e.organization_id = p_org_id and e.id = p_event_id
       and e.status not in ('CLOSED', 'CANCELLED')
  ) then
    raise exception 'EVENT_NOT_PROCUREABLE' using errcode = '23503';
  end if;

  update public.procurement_orders set
    supplier_id = p_supplier_id,
    event_id = p_event_id,
    order_date = p_order_date,
    expected_delivery_at = p_expected_delivery_at,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = p_order_id;

  perform public.replace_procurement_lines_internal(
    p_org_id, p_order_id, coalesce(p_lines, '[]'::jsonb)
  );
  select * into v_order from public.procurement_orders where id = p_order_id;

  perform public.record_audit(
    p_org_id, 'PROCUREMENT_ORDER_UPDATED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'UPDATE_PROCUREMENT_ORDER', v_fingerprint,
    'procurement_order', v_order.id, to_jsonb(v_order)
  );
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Structural receipt-line -> S4B RECEIVE linkage.
--
-- For a CONSUMABLE line, the linked movement must be exactly the deterministic
-- child movement created for this receipt intent + order line, for the same
-- stock item and exact quantity. Non-consumable lines may never carry a stock
-- movement. This turns the integration from an RPC convention into a database
-- invariant even for future privileged write paths.
-- ---------------------------------------------------------------------------
create or replace function public.procurement_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_kind public.procurement_line_kind;
  v_line_stock_item_id uuid;
  v_receipt_key uuid;
  v_expected_child_key uuid;
  v_movement public.consumable_movements;
begin
  if tg_op = 'INSERT' and tg_table_name = 'procurement_receipt_lines' then
    select l.line_kind, l.stock_item_id
      into v_line_kind, v_line_stock_item_id
      from public.procurement_order_lines l
     where l.organization_id = new.organization_id
       and l.order_id = new.order_id
       and l.id = new.order_line_id;
    if not found then
      raise exception 'PROCUREMENT_ORDER_LINE_NOT_FOUND' using errcode = '23503';
    end if;

    if v_line_kind = 'CONSUMABLE' then
      if new.consumable_movement_id is null then
        raise exception 'PROCUREMENT_RECEIPT_STOCK_LINK_INVALID' using errcode = '23514';
      end if;

      select * into v_movement
        from public.consumable_movements m
       where m.organization_id = new.organization_id
         and m.id = new.consumable_movement_id;
      if not found
         or v_movement.movement_kind <> 'RECEIVE'
         or v_movement.stock_item_id <> v_line_stock_item_id
         or v_movement.quantity <> new.quantity then
        raise exception 'PROCUREMENT_RECEIPT_STOCK_LINK_INVALID' using errcode = '23514';
      end if;

      select r.idempotency_key into v_receipt_key
        from public.procurement_receipts r
       where r.organization_id = new.organization_id
         and r.order_id = new.order_id
         and r.id = new.receipt_id;
      if not found then
        raise exception 'PROCUREMENT_RECEIPT_NOT_FOUND' using errcode = '23503';
      end if;

      v_expected_child_key := substr(public.warehouse_fingerprint(jsonb_build_object(
        'namespace', 'PROCUREMENT_RECEIPT_MOVEMENT',
        'receipt_key', v_receipt_key,
        'line_id', new.order_line_id
      )), 1, 32)::uuid;

      if v_movement.idempotency_key <> v_expected_child_key then
        raise exception 'PROCUREMENT_RECEIPT_STOCK_LINK_INVALID' using errcode = '23514';
      end if;
    elsif new.consumable_movement_id is not null then
      raise exception 'PROCUREMENT_RECEIPT_STOCK_LINK_INVALID' using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'PROCUREMENT_HISTORY_APPEND_ONLY' using errcode = '42501';
end;
$$;

drop trigger if exists procurement_receipt_lines_append_only
  on public.procurement_receipt_lines;
create trigger procurement_receipt_lines_append_only
  before insert or update or delete on public.procurement_receipt_lines
  for each row execute function public.procurement_append_only_guard();
