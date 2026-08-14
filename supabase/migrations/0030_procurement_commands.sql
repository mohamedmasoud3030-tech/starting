-- ============================================================================
-- 0030 — S5A server-authoritative supplier/procurement commands
--
-- LOCK ORDER
--   1. advisory transaction lock for (organization, idempotency key)
--   2. procurement order row (all aggregate transitions/receipts/cancellation)
--   3. S4B stock-item rows in UUID order for consumable receipt lines
--
-- Supplier commands use (1) then the supplier row. Order creation has no order
-- row yet and therefore uses (1), followed by the document-sequence row inside
-- next_document_number(). No path holds a stock row while waiting for an order
-- row, and multi-stock receipts lock stock rows in deterministic UUID order.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Exact quantity / exact OMR validation (reject; never silently round).
-- ---------------------------------------------------------------------------
create or replace function public.assert_procurement_quantity(p_quantity numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if round(p_quantity, 3) <> p_quantity then
    raise exception 'QUANTITY_PRECISION_EXCEEDED';
  end if;
  if p_quantity > 999999999.999 then
    raise exception 'QUANTITY_OUT_OF_RANGE';
  end if;
end;
$$;

create or replace function public.assert_procurement_omr(p_amount numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'INVALID_OMR_AMOUNT';
  end if;
  if round(p_amount, 3) <> p_amount then
    raise exception 'OMR_PRECISION_EXCEEDED';
  end if;
  if p_amount > 999999999.999 then
    raise exception 'OMR_AMOUNT_OUT_OF_RANGE';
  end if;
end;
$$;

-- Exact PostgreSQL numeric multiplication, rounded half away from zero to the
-- authoritative OMR 3-decimal boundary.
create or replace function public.procurement_line_total(
  p_quantity numeric,
  p_unit_cost numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total numeric;
begin
  perform public.assert_procurement_quantity(p_quantity);
  perform public.assert_procurement_omr(p_unit_cost);
  v_total := round(p_quantity * p_unit_cost, 3);
  perform public.assert_procurement_omr(v_total);
  return v_total::numeric(12,3);
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotency helpers. begin takes the serialization lock and either returns
-- the exact original JSON response or NULL for a first execution.
-- ---------------------------------------------------------------------------
create or replace function public.begin_procurement_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.procurement_command_idempotency;
begin
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
    from public.procurement_command_idempotency i
   where i.organization_id = p_org_id
     and i.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_existing.response_payload;
  end if;
  return null;
end;
$$;

create or replace function public.finish_procurement_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.procurement_command_idempotency (
    organization_id, idempotency_key, command_name, request_fingerprint,
    result_entity, result_id, response_payload, actor_id
  ) values (
    p_org_id, p_idempotency_key, p_command_name, p_fingerprint,
    p_result_entity, p_result_id, p_response, auth.uid()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal draft-line replacement worker. Input line shape:
-- {
--   "line_kind": "CONSUMABLE" | "CATERING_SERVICE" | "OTHER",
--   "catalog_item_id": uuid | null,
--   "description": text,
--   "unit": text,
--   "quantity": exact decimal,
--   "agreed_unit_cost": exact OMR decimal
-- }
--
-- CONSUMABLE identity/unit are server-snapshotted from the catalog and require
-- an active S4B stock profile. Non-catalog service lines remain first-class.
-- ---------------------------------------------------------------------------
create or replace function public.replace_procurement_lines_internal(
  p_org_id uuid,
  p_order_id uuid,
  p_lines jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_kind_text text;
  v_kind public.procurement_line_kind;
  v_catalog_id uuid;
  v_catalog public.catalog_items;
  v_stock public.consumable_stock_items;
  v_description text;
  v_unit text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_order_total numeric := 0;
  v_sort integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'PROCUREMENT_LINES_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  delete from public.procurement_order_lines
   where organization_id = p_org_id and order_id = p_order_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'INVALID_PROCUREMENT_LINE' using errcode = '22023';
    end if;

    v_kind_text := v_entry ->> 'line_kind';
    if v_kind_text not in ('CONSUMABLE', 'CATERING_SERVICE', 'OTHER') then
      raise exception 'INVALID_PROCUREMENT_LINE_KIND' using errcode = '22023';
    end if;
    v_kind := v_kind_text::public.procurement_line_kind;

    begin
      v_catalog_id := nullif(v_entry ->> 'catalog_item_id', '')::uuid;
      v_quantity := (v_entry ->> 'quantity')::numeric;
      v_unit_cost := (v_entry ->> 'agreed_unit_cost')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_PROCUREMENT_LINE' using errcode = '22023';
    end;

    perform public.assert_procurement_quantity(v_quantity);
    perform public.assert_procurement_omr(v_unit_cost);
    v_line_total := public.procurement_line_total(v_quantity, v_unit_cost);

    v_catalog := null;
    v_stock := null;
    if v_catalog_id is not null then
      select * into v_catalog
        from public.catalog_items ci
       where ci.organization_id = p_org_id
         and ci.id = v_catalog_id
         and ci.status = 'ACTIVE';
      if not found then
        raise exception 'CATALOG_ITEM_NOT_FOUND' using errcode = '23503';
      end if;
    end if;

    if v_kind = 'CONSUMABLE' then
      if v_catalog_id is null or v_catalog.item_type <> 'CONSUMABLE' then
        raise exception 'PROCUREMENT_CONSUMABLE_CATALOG_REQUIRED' using errcode = '23514';
      end if;
      select * into v_stock
        from public.consumable_stock_items s
       where s.organization_id = p_org_id
         and s.catalog_item_id = v_catalog_id
         and s.is_tracking_active;
      if not found then
        raise exception 'CONSUMABLE_STOCK_ITEM_NOT_TRACKED' using errcode = '23503';
      end if;
      v_description := v_catalog.name;
      v_unit := v_catalog.unit;
    else
      if v_catalog_id is not null and v_catalog.item_type = 'CONSUMABLE' then
        raise exception 'PROCUREMENT_LINE_KIND_MISMATCH' using errcode = '23514';
      end if;
      v_description := trim(coalesce(nullif(v_entry ->> 'description', ''), v_catalog.name));
      v_unit := trim(coalesce(nullif(v_entry ->> 'unit', ''), v_catalog.unit));
      if length(coalesce(v_description, '')) = 0 then
        raise exception 'PROCUREMENT_LINE_DESCRIPTION_REQUIRED' using errcode = '22023';
      end if;
      if length(coalesce(v_unit, '')) = 0 then
        raise exception 'PROCUREMENT_LINE_UNIT_REQUIRED' using errcode = '22023';
      end if;
    end if;

    v_order_total := v_order_total + v_line_total;
    perform public.assert_procurement_omr(v_order_total);

    insert into public.procurement_order_lines (
      organization_id, order_id, line_kind, catalog_item_id, stock_item_id,
      description, unit, quantity, agreed_unit_cost, agreed_total_cost, sort_order
    ) values (
      p_org_id, p_order_id, v_kind, v_catalog_id,
      case when v_kind = 'CONSUMABLE' then v_stock.id else null end,
      v_description, v_unit, v_quantity, v_unit_cost, v_line_total, v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  update public.procurement_orders
     set agreed_total_cost = v_order_total,
         updated_by = auth.uid()
   where organization_id = p_org_id and id = p_order_id;

  return v_order_total::numeric(12,3);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supplier commands — OWNER/MANAGER.
-- ---------------------------------------------------------------------------
create or replace function public.create_supplier(
  p_org_id uuid,
  p_name text,
  p_category public.supplier_category,
  p_commercial_registration_number text,
  p_contact_name text,
  p_phone text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'SUPPLIER_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_SUPPLIER',
    'name', trim(p_name),
    'category', coalesce(p_category, 'GENERAL'::public.supplier_category),
    'commercial_registration_number', nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
    'phone', nullif(trim(coalesce(p_phone, '')), ''),
    'whatsapp', nullif(trim(coalesce(p_whatsapp, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  insert into public.suppliers (
    organization_id, name, category, commercial_registration_number,
    contact_name, phone, whatsapp, email, notes, created_by, updated_by
  ) values (
    p_org_id, trim(p_name), coalesce(p_category, 'GENERAL'),
    nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_whatsapp, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid()
  ) returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_CREATED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'category', v_supplier.category)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'CREATE_SUPPLIER', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

create or replace function public.update_supplier(
  p_org_id uuid,
  p_supplier_id uuid,
  p_name text,
  p_category public.supplier_category,
  p_commercial_registration_number text,
  p_contact_name text,
  p_phone text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'SUPPLIER_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'UPDATE_SUPPLIER', 'supplier_id', p_supplier_id,
    'name', trim(p_name), 'category', coalesce(p_category, 'GENERAL'::public.supplier_category),
    'commercial_registration_number', nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    'contact_name', nullif(trim(coalesce(p_contact_name, '')), ''),
    'phone', nullif(trim(coalesce(p_phone, '')), ''),
    'whatsapp', nullif(trim(coalesce(p_whatsapp, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id
   for update;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.suppliers set
    name = trim(p_name),
    category = coalesce(p_category, 'GENERAL'),
    commercial_registration_number = nullif(trim(coalesce(p_commercial_registration_number, '')), ''),
    contact_name = nullif(trim(coalesce(p_contact_name, '')), ''),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    whatsapp = nullif(trim(coalesce(p_whatsapp, '')), ''),
    email = nullif(trim(coalesce(p_email, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = p_supplier_id
  returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_UPDATED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'UPDATE_SUPPLIER', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

create or replace function public.set_supplier_status(
  p_org_id uuid,
  p_supplier_id uuid,
  p_status public.supplier_status,
  p_idempotency_key uuid
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
  v_from public.supplier_status;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'SUPPLIER_STATUS_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'SET_SUPPLIER_STATUS', 'supplier_id', p_supplier_id, 'status', p_status
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.suppliers, v_replay);
  end if;

  select * into v_supplier
    from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id
   for update;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_supplier.status = p_status then
    raise exception 'SUPPLIER_ALREADY_IN_STATUS';
  end if;
  v_from := v_supplier.status;

  update public.suppliers
     set status = p_status, updated_by = auth.uid()
   where id = p_supplier_id
  returning * into v_supplier;

  perform public.record_audit(
    p_org_id, 'SUPPLIER_STATUS_CHANGED', 'supplier', v_supplier.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'from', v_from, 'to', p_status)
  );
  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'SET_SUPPLIER_STATUS', v_fingerprint,
    'supplier', v_supplier.id, to_jsonb(v_supplier)
  );
  return v_supplier;
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft order create/update — OWNER/MANAGER.
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

  if not exists (
    select 1 from public.suppliers s
     where s.organization_id = p_org_id and s.id = p_supplier_id and s.status = 'ACTIVE'
  ) then
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

  perform public.replace_procurement_lines_internal(p_org_id, v_order.id, coalesce(p_lines, '[]'::jsonb));
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
  if not exists (
    select 1 from public.suppliers s
     where s.organization_id = p_org_id and s.id = p_supplier_id and s.status = 'ACTIVE'
  ) then
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
  perform public.replace_procurement_lines_internal(p_org_id, p_order_id, coalesce(p_lines, '[]'::jsonb));
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
-- Approval and deliberate lifecycle transitions.
-- DRAFT -> APPROVED -> SENT -> CONFIRMED -> PARTIALLY_RECEIVED -> RECEIVED
-- Cancellation is terminal from every state except RECEIVED.
-- ---------------------------------------------------------------------------
create or replace function public.approve_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
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
  v_total numeric;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'APPROVE_PROCUREMENT_ORDER', 'order_id', p_order_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders, v_replay); end if;

  select * into v_order from public.procurement_orders o
   where o.organization_id = p_org_id and o.id = p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.status <> 'DRAFT' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;

  -- Shared serialization point with supplier lifecycle changes. If
  -- deactivation commits first, approval observes INACTIVE and rejects; if
  -- approval locks first, it snapshots an active supplier before the later
  -- deactivation. Both outcomes are linearizable.
  select * into v_supplier from public.suppliers s
   where s.organization_id = p_org_id and s.id = v_order.supplier_id
   for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE';
  end if;
  if v_order.event_id is not null and not exists (
    select 1 from public.events e where e.organization_id = p_org_id and e.id = v_order.event_id
      and e.status not in ('CLOSED', 'CANCELLED')
  ) then raise exception 'EVENT_NOT_PROCUREABLE'; end if;
  if not exists (
    select 1 from public.procurement_order_lines l
     where l.organization_id = p_org_id and l.order_id = p_order_id
  ) then raise exception 'PROCUREMENT_ORDER_LINES_REQUIRED'; end if;

  select sum(l.agreed_total_cost) into v_total
    from public.procurement_order_lines l
   where l.organization_id = p_org_id and l.order_id = p_order_id;
  perform public.assert_procurement_omr(v_total);

  update public.procurement_orders set
    status = 'APPROVED', agreed_total_cost = v_total,
    supplier_name_snapshot = v_supplier.name,
    supplier_contact_name_snapshot = v_supplier.contact_name,
    supplier_phone_snapshot = v_supplier.phone,
    approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
  where id = p_order_id returning * into v_order;

  perform public.record_audit(p_org_id, 'PROCUREMENT_ORDER_APPROVED', 'procurement_order', v_order.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'total_cost', v_total::text));
  perform public.finish_procurement_command(p_org_id, p_idempotency_key, 'APPROVE_PROCUREMENT_ORDER',
    v_fingerprint, 'procurement_order', v_order.id, to_jsonb(v_order));
  return v_order;
end;
$$;

create or replace function public.send_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','SEND_PROCUREMENT_ORDER','order_id',p_order_id));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status<>'APPROVED' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;
  update public.procurement_orders set status='SENT',sent_by=auth.uid(),sent_at=now(),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_SENT','procurement_order',v_order.id::text,jsonb_build_object('idempotency_key',p_idempotency_key));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'SEND_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

create or replace function public.confirm_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','CONFIRM_PROCUREMENT_ORDER','order_id',p_order_id));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status<>'SENT' then raise exception 'INVALID_PROCUREMENT_ORDER_TRANSITION'; end if;
  update public.procurement_orders set status='CONFIRMED',confirmed_by=auth.uid(),confirmed_at=now(),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_CONFIRMED','procurement_order',v_order.id::text,jsonb_build_object('idempotency_key',p_idempotency_key));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'CONFIRM_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

create or replace function public.cancel_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.procurement_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.procurement_orders; v_from public.procurement_order_status; v_fingerprint text; v_replay jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'PROCUREMENT_CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object('command','CANCEL_PROCUREMENT_ORDER','order_id',p_order_id,'reason',trim(p_reason)));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_orders,v_replay); end if;
  select * into v_order from public.procurement_orders where organization_id=p_org_id and id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status in ('RECEIVED','CANCELLED') then raise exception 'PROCUREMENT_ORDER_NOT_CANCELLABLE'; end if;
  v_from:=v_order.status;
  update public.procurement_orders set status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid() where id=p_order_id returning * into v_order;
  perform public.record_audit(p_org_id,'PROCUREMENT_ORDER_CANCELLED','procurement_order',v_order.id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key,'from',v_from,'received_facts_preserved',true));
  perform public.finish_procurement_command(p_org_id,p_idempotency_key,'CANCEL_PROCUREMENT_ORDER',v_fingerprint,'procurement_order',v_order.id,to_jsonb(v_order));
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactional receiving.
-- OWNER/MANAGER/SUPERVISOR may confirm all lines. WAREHOUSE may receive only
-- physical CONSUMABLE lines and sees no negotiated costs in its read models.
-- ---------------------------------------------------------------------------
create or replace function public.receive_procurement_order(
  p_org_id uuid,
  p_order_id uuid,
  p_received_at timestamptz,
  p_reference text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns public.procurement_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.procurement_receipts;
  v_order public.procurement_orders;
  v_line public.procurement_order_lines;
  v_movement public.consumable_movements;
  v_entry record;
  v_quantity numeric;
  v_already numeric;
  v_fingerprint text;
  v_replay jsonb;
  v_child_key uuid;
  v_is_warehouse boolean;
  v_count integer := 0;
  v_all_received boolean;
  v_reference text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
  if not public.has_org_role(p_org_id,array[
    'OWNER'::public.app_role,'MANAGER'::public.app_role,
    'SUPERVISOR'::public.app_role,'WAREHOUSE'::public.app_role
  ]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'PROCUREMENT_RECEIPT_LINES_REQUIRED' using errcode='22023';
  end if;

  v_fingerprint:=public.warehouse_fingerprint(jsonb_build_object(
    'command','RECEIVE_PROCUREMENT_ORDER','order_id',p_order_id,
    'received_at',p_received_at,'reference',nullif(trim(coalesce(p_reference,'')),''),
    'notes',nullif(trim(coalesce(p_notes,'')),''),'lines',p_lines
  ));
  v_replay:=public.begin_procurement_command(p_org_id,p_idempotency_key,v_fingerprint);
  if v_replay is not null then return jsonb_populate_record(null::public.procurement_receipts,v_replay); end if;

  select * into v_order from public.procurement_orders o
   where o.organization_id=p_org_id and o.id=p_order_id for update;
  if not found then raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.status not in ('CONFIRMED','PARTIALLY_RECEIVED') then
    raise exception 'PROCUREMENT_ORDER_NOT_RECEIVABLE';
  end if;

  -- Reject duplicate line ids before any movement is written.
  begin
    if (select count(*) from jsonb_array_elements(p_lines)) <>
       (select count(distinct (x.value->>'order_line_id')::uuid) from jsonb_array_elements(p_lines) x) then
      raise exception 'DUPLICATE_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
    end if;
  exception when invalid_text_representation then
    raise exception 'INVALID_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
  end;

  v_is_warehouse:=public.has_org_role(p_org_id,array['WAREHOUSE'::public.app_role]);

  insert into public.procurement_receipts(
    organization_id,order_id,received_at,reference,notes,received_by,
    idempotency_key,request_fingerprint
  ) values(
    p_org_id,p_order_id,coalesce(p_received_at,now()),
    nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),
    auth.uid(),p_idempotency_key,v_fingerprint
  ) returning * into v_receipt;

  -- Deterministic stock lock order. Service rows sort after stock rows by line
  -- id; they acquire no stock lock.
  for v_entry in
    select l.id as line_id, x.value as payload
      from jsonb_array_elements(p_lines) x
      join public.procurement_order_lines l
        on l.organization_id=p_org_id
       and l.order_id=p_order_id
       and l.id=(x.value->>'order_line_id')::uuid
     order by coalesce(l.stock_item_id,l.id),l.id
  loop
    v_count:=v_count+1;
    select * into v_line from public.procurement_order_lines
     where organization_id=p_org_id and order_id=p_order_id and id=v_entry.line_id;
    begin
      v_quantity:=(v_entry.payload->>'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_PROCUREMENT_RECEIPT_LINE' using errcode='22023';
    end;
    perform public.assert_procurement_quantity(v_quantity);

    select coalesce(sum(rl.quantity),0) into v_already
      from public.procurement_receipt_lines rl
     where rl.organization_id=p_org_id and rl.order_line_id=v_line.id;
    if v_already+v_quantity>v_line.quantity then
      raise exception 'PROCUREMENT_OVER_RECEIPT' using errcode='23514',
        detail=jsonb_build_object('ordered',v_line.quantity::text,'already_received',v_already::text,'requested',v_quantity::text)::text;
    end if;
    if v_is_warehouse and v_line.line_kind<>'CONSUMABLE' then
      raise exception 'WAREHOUSE_PHYSICAL_RECEIPT_ONLY' using errcode='42501';
    end if;

    v_movement:=null;
    if v_line.line_kind='CONSUMABLE' then
      -- One deterministic child key per parent receipt intent + order line.
      v_child_key:=substr(public.warehouse_fingerprint(jsonb_build_object(
        'namespace','PROCUREMENT_RECEIPT_MOVEMENT','receipt_key',p_idempotency_key,'line_id',v_line.id
      )),1,32)::uuid;
      v_reference:=concat_ws(' / ',v_order.order_number,nullif(trim(coalesce(p_reference,'')),''));
      v_movement:=public.record_consumable_movement(
        p_org_id,v_line.stock_item_id,null,'RECEIVE',v_quantity,null,v_reference,
        v_child_key,
        public.warehouse_fingerprint(jsonb_build_object(
          'command','PROCUREMENT_CONSUMABLE_RECEIVE','order_id',p_order_id,
          'order_line_id',v_line.id,'quantity',v_quantity::text,
          'receipt_idempotency_key',p_idempotency_key
        )),
        'CONSUMABLE_RECEIVED'
      );
    end if;

    insert into public.procurement_receipt_lines(
      organization_id,receipt_id,order_id,order_line_id,quantity,consumable_movement_id
    ) values(
      p_org_id,v_receipt.id,p_order_id,v_line.id,v_quantity,
      case when v_line.line_kind='CONSUMABLE' then v_movement.id else null end
    );
  end loop;

  if v_count<>jsonb_array_length(p_lines) then
    raise exception 'PROCUREMENT_ORDER_LINE_NOT_FOUND' using errcode='23503';
  end if;

  select not exists(
    select 1 from public.procurement_order_lines l
     where l.organization_id=p_org_id and l.order_id=p_order_id
       and coalesce((select sum(rl.quantity) from public.procurement_receipt_lines rl
                      where rl.organization_id=p_org_id and rl.order_line_id=l.id),0) < l.quantity
  ) into v_all_received;

  update public.procurement_orders
     set status=case when v_all_received then 'RECEIVED'::public.procurement_order_status
                     else 'PARTIALLY_RECEIVED'::public.procurement_order_status end,
         updated_by=auth.uid()
   where id=p_order_id;

  perform public.record_audit(
    p_org_id,
    case when v_all_received then 'PROCUREMENT_ORDER_RECEIVED' else 'PROCUREMENT_ORDER_PARTIALLY_RECEIVED' end,
    'procurement_receipt',v_receipt.id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key,'order_id',p_order_id,
                       'line_count',v_count,'final_receipt',v_all_received)
  );
  perform public.finish_procurement_command(
    p_org_id,p_idempotency_key,'RECEIVE_PROCUREMENT_ORDER',v_fingerprint,
    'procurement_receipt',v_receipt.id,to_jsonb(v_receipt)
  );
  return v_receipt;
end;
$$;

-- Internal helper functions are never client-callable.
revoke all on function public.assert_procurement_quantity(numeric) from public,anon,authenticated;
revoke all on function public.assert_procurement_omr(numeric) from public,anon,authenticated;
revoke all on function public.procurement_line_total(numeric,numeric) from public,anon,authenticated;
revoke all on function public.begin_procurement_command(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_procurement_command(uuid,uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.replace_procurement_lines_internal(uuid,uuid,jsonb) from public,anon,authenticated;

-- Public command grants. Role checks are repeated inside every SECURITY
-- DEFINER function; authenticated EXECUTE alone is never authorization.
revoke all on function
  public.create_supplier(uuid,text,public.supplier_category,text,text,text,text,text,text,uuid),
  public.update_supplier(uuid,uuid,text,public.supplier_category,text,text,text,text,text,text,uuid),
  public.set_supplier_status(uuid,uuid,public.supplier_status,uuid),
  public.create_procurement_order(uuid,uuid,uuid,date,timestamptz,text,jsonb,uuid),
  public.update_procurement_order(uuid,uuid,uuid,uuid,date,timestamptz,text,jsonb,uuid),
  public.approve_procurement_order(uuid,uuid,uuid),
  public.send_procurement_order(uuid,uuid,uuid),
  public.confirm_procurement_order(uuid,uuid,uuid),
  public.cancel_procurement_order(uuid,uuid,text,uuid),
  public.receive_procurement_order(uuid,uuid,timestamptz,text,text,jsonb,uuid)
  from public,anon;

grant execute on function
  public.create_supplier(uuid,text,public.supplier_category,text,text,text,text,text,text,uuid),
  public.update_supplier(uuid,uuid,text,public.supplier_category,text,text,text,text,text,text,uuid),
  public.set_supplier_status(uuid,uuid,public.supplier_status,uuid),
  public.create_procurement_order(uuid,uuid,uuid,date,timestamptz,text,jsonb,uuid),
  public.update_procurement_order(uuid,uuid,uuid,uuid,date,timestamptz,text,jsonb,uuid),
  public.approve_procurement_order(uuid,uuid,uuid),
  public.send_procurement_order(uuid,uuid,uuid),
  public.confirm_procurement_order(uuid,uuid,uuid),
  public.cancel_procurement_order(uuid,uuid,text,uuid),
  public.receive_procurement_order(uuid,uuid,timestamptz,text,text,jsonb,uuid)
  to authenticated;
