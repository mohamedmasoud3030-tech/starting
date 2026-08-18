-- ============================================================================
-- 0063 — Commercial engine: pricing, lifecycle commands, versioning
--
-- Uses the enum values REJECTED/EXPIRED added in 0062 (a separate transaction),
-- plus the price-component columns. Adds:
--   1. quotation_pricing() — single source of truth for discount + grand total.
--   2. A stricter quotation state machine (reject / expire / supersede / cancel).
--   3. set_quotation_pricing / reject_quotation / expire_quotation / revise_quotation.
--   4. issue_quotation now freezes subtotal/discount/grand total and derives its
--      number prefix from organization settings; revisions share the number.
--   5. save_quotation_draft / save_quotation_line / update_quotation_draft all
--      route through quotation_pricing() (no duplicated pricing logic).
--   6. The customer read model exposes the price components + derived is_expired.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Single pricing authority (exact numeric, round half-away-from-zero).
-- ---------------------------------------------------------------------------
create or replace function public.quotation_pricing(
  p_subtotal numeric,
  p_transport numeric,
  p_surcharge numeric,
  p_discount_type public.quotation_discount_type,
  p_discount_value numeric,
  out p_discount_amount numeric,
  out p_grand_total numeric
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_discount_value < 0 then
    raise exception 'INVALID_DISCOUNT' using errcode = '22023';
  end if;
  if p_discount_type = 'PERCENT' and p_discount_value > 100 then
    raise exception 'INVALID_DISCOUNT' using errcode = '22023';
  end if;

  p_discount_amount := case p_discount_type
    when 'NONE' then 0
    when 'FIXED' then p_discount_value
    when 'PERCENT' then round(p_subtotal * p_discount_value / 100, 3)
  end;

  p_grand_total := p_subtotal + p_transport + p_surcharge - p_discount_amount;
  if p_grand_total < 0 then
    raise exception 'NEGATIVE_TOTAL' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.quotation_pricing(numeric, numeric, numeric, public.quotation_discount_type, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quotation state machine (explicit, audited transitions only).
-- ---------------------------------------------------------------------------
create or replace function public.protect_quotation_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='DRAFT' then
    if new.status in ('DRAFT','ISSUED','CANCELLED') then return new; end if;
    raise exception 'QUOTATION_TRANSITION_NOT_ALLOWED';
  end if;

  if old.status='ISSUED' and new.status='ACCEPTED' then
    if (to_jsonb(new)-array['status','accepted_by','accepted_at']) is distinct from
       (to_jsonb(old)-array['status','accepted_by','accepted_at'])
       or new.accepted_by is null or new.accepted_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ISSUED' and new.status='REJECTED' then
    if (to_jsonb(new)-array['status','rejected_by','rejected_at']) is distinct from
       (to_jsonb(old)-array['status','rejected_by','rejected_at'])
       or new.rejected_by is null or new.rejected_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ISSUED' and new.status='EXPIRED' then
    if (to_jsonb(new)-array['status','expired_by','expired_at']) is distinct from
       (to_jsonb(old)-array['status','expired_by','expired_at'])
       or new.expired_by is null or new.expired_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  -- Revisions supersede a sent quote (or a rejected/expired one) without
  -- touching any other commercial fact; only the supersede reason may change.
  if old.status in ('ISSUED','REJECTED','EXPIRED') and new.status='SUPERSEDED' then
    if (to_jsonb(new)-array['status','superseded_reason']) is distinct from
       (to_jsonb(old)-array['status','superseded_reason']) then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ISSUED' and new.status='CANCELLED' then
    if (to_jsonb(new)-array['status','cancellation_reason']) is distinct from
       (to_jsonb(old)-array['status','cancellation_reason']) then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ACCEPTED' and new.status='CONVERTED' then
    if (to_jsonb(new)-array['status','customer_id','converted_event_id','converted_at']) is distinct from
       (to_jsonb(old)-array['status','customer_id','converted_event_id','converted_at'])
       or old.event_id is not null or new.customer_id is null
       or new.converted_event_id is null or new.converted_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  raise exception 'QUOTATION_IMMUTABLE';
end$$;

-- ---------------------------------------------------------------------------
-- 3. set_quotation_pricing — transport / surcharges / discount / validity on a DRAFT.
-- ---------------------------------------------------------------------------
create or replace function public.set_quotation_pricing(
  p_org_id uuid,
  p_quotation_id uuid,
  p_transport_required boolean default null,
  p_transport_zone text default null,
  p_transport_amount numeric default null,
  p_transport_note text default null,
  p_surcharge_amount numeric default null,
  p_surcharge_note text default null,
  p_discount_type public.quotation_discount_type default null,
  p_discount_value numeric default null,
  p_valid_until timestamptz default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.quotations;
  v_payload jsonb;
  v_fp text;
  v_replay jsonb;
  v_discount numeric;
  v_grand numeric;
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'quotation_id', p_quotation_id,
    'transport_required', p_transport_required,
    'transport_zone', nullif(trim(coalesce(p_transport_zone, '')), ''),
    'transport_amount', p_transport_amount,
    'transport_note', nullif(trim(coalesce(p_transport_note, '')), ''),
    'surcharge_amount', p_surcharge_amount,
    'surcharge_note', nullif(trim(coalesce(p_surcharge_note, '')), ''),
    'discount_type', p_discount_type,
    'discount_value', p_discount_value,
    'valid_until', p_valid_until
  );
  v_fp := public.quotation_fingerprint(v_payload);
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v from public.quotations
     where organization_id = p_org_id and id = (v_replay->>'quotation_id')::uuid;
    return v;
  end if;

  select * into v from public.quotations
   where organization_id = p_org_id and id = p_quotation_id
   for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status <> 'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;

  -- Transport without a required flag (or with a negative amount) is rejected;
  -- a cleared flag zeroes the amount so the document never shows a phantom fee.
  if coalesce(p_transport_amount, v.transport_amount) < 0 then
    raise exception 'INVALID_TRANSPORT_AMOUNT' using errcode = '22023';
  end if;
  if coalesce(p_surcharge_amount, v.surcharge_amount) < 0 then
    raise exception 'INVALID_SURCHARGE_AMOUNT' using errcode = '22023';
  end if;
  if p_transport_required is not null and p_transport_required = false then
    p_transport_amount := 0;
  end if;

  update public.quotations set
    transport_required = coalesce(p_transport_required, transport_required),
    transport_zone = case
      when p_transport_zone is null then transport_zone
      else nullif(trim(p_transport_zone), '')
    end,
    transport_amount = coalesce(p_transport_amount, transport_amount),
    transport_note = case
      when p_transport_note is null then transport_note
      else nullif(trim(p_transport_note), '')
    end,
    surcharge_amount = coalesce(p_surcharge_amount, surcharge_amount),
    surcharge_note = case
      when p_surcharge_note is null then surcharge_note
      else nullif(trim(p_surcharge_note), '')
    end,
    discount_type = coalesce(p_discount_type, discount_type),
    discount_value = coalesce(p_discount_value, discount_value),
    valid_until = case when p_valid_until is null then valid_until else p_valid_until end
  where id = p_quotation_id
  returning * into v;

  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(
      v.subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value
    ) q;

  update public.quotations set
    discount_amount = v_discount,
    total_selling = v_grand,
    total_expected_profit = v_grand - total_expected_cost
  where id = p_quotation_id
  returning * into v;

  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'SET_QUOTATION_PRICING', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
  perform public.record_audit(p_org_id, 'QUOTATION_PRICING_SET', 'quotation', v.id::text,
    jsonb_build_object('transport', v.transport_amount::text, 'surcharge', v.surcharge_amount::text,
      'discount_type', v.discount_type::text, 'discount_amount', v.discount_amount::text));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. reject / expire a sent quotation (explicit, audited, terminal).
-- ---------------------------------------------------------------------------
create or replace function public.reject_quotation(
  p_org_id uuid,
  p_quotation_id uuid,
  p_reason text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_fp := public.quotation_fingerprint(jsonb_build_object('quotation_id', p_quotation_id, 'reason', p_reason));
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id;
    return v;
  end if;
  select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status = 'REJECTED' then
    perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'REJECT_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
    return v;
  end if;
  if v.status <> 'ISSUED' then raise exception 'QUOTATION_REJECT_NOT_ALLOWED'; end if;
  update public.quotations set status = 'REJECTED', rejected_by = auth.uid(), rejected_at = now()
    where id = p_quotation_id returning * into v;
  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'REJECT_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
  perform public.record_audit(p_org_id, 'QUOTATION_REJECTED', 'quotation', v.id::text, jsonb_build_object('reason', p_reason));
  return v;
end;
$$;

create or replace function public.expire_quotation(
  p_org_id uuid,
  p_quotation_id uuid,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_fp := public.quotation_fingerprint(jsonb_build_object('quotation_id', p_quotation_id));
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id;
    return v;
  end if;
  select * into v from public.quotations where organization_id = p_org_id and id = p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status = 'EXPIRED' then
    perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'EXPIRE_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
    return v;
  end if;
  if v.status <> 'ISSUED' then raise exception 'QUOTATION_EXPIRE_NOT_ALLOWED'; end if;
  update public.quotations set status = 'EXPIRED', expired_by = auth.uid(), expired_at = now()
    where id = p_quotation_id returning * into v;
  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'EXPIRE_QUOTATION', v_fp, 'quotation', v.id, jsonb_build_object('quotation_id', v.id));
  perform public.record_audit(p_org_id, 'QUOTATION_EXPIRED', 'quotation', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. revise_quotation — create a new DRAFT revision; the sent version becomes
--    SUPERSEDED (its snapshot is never mutated). Revisions share quotation_number.
-- ---------------------------------------------------------------------------
create or replace function public.revise_quotation(
  p_org_id uuid,
  p_quotation_id uuid,
  p_reason text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.quotations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.quotations;
  v_new public.quotations;
  v_fp text;
  v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;

  v_fp := public.quotation_fingerprint(jsonb_build_object('quotation_id', p_quotation_id, 'reason', p_reason));
  v_replay := public.begin_command(p_org_id, 'QUOTATIONS', p_idempotency_key, v_fp);
  if v_replay is not null then
    select * into v_new from public.quotations
     where organization_id = p_org_id and id = (v_replay->>'quotation_id')::uuid;
    return v_new;
  end if;

  select * into v_old from public.quotations
   where organization_id = p_org_id and id = p_quotation_id
   for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_old.status not in ('ISSUED','REJECTED','EXPIRED') then
    raise exception 'QUOTATION_NOT_REVISABLE';
  end if;

  -- A new DRAFT revision inherits the commercial snapshot as its starting
  -- point; the parent's immutable snapshot stays untouched (status only).
  insert into public.quotations (
    organization_id, quotation_number, revision, status, customer_id,
    customer_name_snapshot, customer_phone_snapshot, prospect_whatsapp, prospect_company,
    event_title_snapshot, event_type_snapshot, guest_count_snapshot,
    start_at_snapshot, end_at_snapshot, venue_snapshot, notes,
    subtotal, transport_required, transport_zone, transport_amount, transport_note,
    surcharge_amount, surcharge_note, discount_type, discount_value, discount_amount,
    valid_until, series_id, total_selling, total_expected_cost, total_expected_profit,
    idempotency_key, created_by
  ) values (
    p_org_id, v_old.quotation_number, v_old.revision + 1, 'DRAFT', v_old.customer_id,
    v_old.customer_name_snapshot, v_old.customer_phone_snapshot, v_old.prospect_whatsapp, v_old.prospect_company,
    v_old.event_title_snapshot, v_old.event_type_snapshot, v_old.guest_count_snapshot,
    v_old.start_at_snapshot, v_old.end_at_snapshot, v_old.venue_snapshot, v_old.notes,
    v_old.subtotal, v_old.transport_required, v_old.transport_zone, v_old.transport_amount, v_old.transport_note,
    v_old.surcharge_amount, v_old.surcharge_note, v_old.discount_type, v_old.discount_value, v_old.discount_amount,
    v_old.valid_until, coalesce(v_old.series_id, v_old.id),
    v_old.total_selling, v_old.total_expected_cost, v_old.total_expected_profit,
    p_idempotency_key, auth.uid()
  ) returning * into v_new;

  insert into public.quotation_lines (
    organization_id, quotation_id, source_catalog_item_id, source_package_id,
    description, item_type, unit, pricing_method, quantity, unit_selling_price,
    expected_unit_cost, total_selling, total_expected_cost, is_custom, notes, sort_order
  )
  select p_org_id, v_new.id, source_catalog_item_id, source_package_id,
    description, item_type, unit, pricing_method, quantity, unit_selling_price,
    expected_unit_cost, total_selling, total_expected_cost, is_custom, notes, sort_order
  from public.quotation_lines
  where quotation_id = v_old.id;

  update public.quotations set status = 'SUPERSEDED', superseded_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = v_old.id;

  perform public.finish_command(p_org_id, 'QUOTATIONS', p_idempotency_key, 'REVISE_QUOTATION', v_fp, 'quotation', v_new.id, jsonb_build_object('quotation_id', v_new.id));
  perform public.record_audit(p_org_id, 'QUOTATION_REVISED', 'quotation', v_new.id::text,
    jsonb_build_object('superseded_id', v_old.id::text, 'revision', v_new.revision, 'reason', p_reason));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. issue_quotation — settings-driven prefix, series identity, frozen pricing.
-- ---------------------------------------------------------------------------
create or replace function public.issue_quotation(
  p_org_id uuid, p_quotation_id uuid, p_terms text default null, p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_subtotal numeric; v_cost numeric; v_discount numeric; v_grand numeric; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id,'terms',p_terms,'notes',p_notes));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status='ISSUED' then
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id)); return v;
  end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_ISSUE_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id) then raise exception 'EMPTY_QUOTATION'; end if;
  if exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id and pricing_method='PER_GUEST') and v.guest_count_snapshot is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  update public.quotation_lines l set total_selling=public.commercial_total(l.pricing_method,l.unit_selling_price,l.quantity,v.guest_count_snapshot),total_expected_cost=public.commercial_total(l.pricing_method,l.expected_unit_cost,l.quantity,v.guest_count_snapshot) where l.quotation_id=p_quotation_id;
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value) q;
  update public.quotations set
    quotation_number=coalesce(v.quotation_number, public.next_document_number(p_org_id,'QUOTATION',null)),
    series_id=coalesce(v.series_id, v.id),
    status='ISSUED', terms=p_terms, notes=coalesce(p_notes,notes),
    subtotal=v_subtotal, discount_amount=v_discount,
    total_selling=v_grand, total_expected_cost=v_cost, total_expected_profit=v_grand-v_cost,
    issued_by=auth.uid(), issued_at=now()
   where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ISSUED','quotation',v.id::text,jsonb_build_object('total',v_grand,'quotation_number',v.quotation_number,'revision',v.revision));
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- 7. save_quotation_draft — route the line sum through quotation_pricing().
-- ---------------------------------------------------------------------------
create or replace function public.save_quotation_draft(
  p_org_id uuid,
  p_quotation_id uuid,
  p_prospect_name text,
  p_customer_id uuid default null,
  p_prospect_phone text default null,
  p_prospect_whatsapp text default null,
  p_prospect_company text default null,
  p_event_title text default null,
  p_event_type text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_guest_count int default null,
  p_venue_name text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb
) returns public.quotations
language plpgsql
security definer
set search_path=''
as $$
declare
  v_quote public.quotations;
  v_line record;
  v_line_id uuid;
  v_description text;
  v_unit text;
  v_method public.pricing_method;
  v_quantity numeric;
  v_selling numeric;
  v_cost numeric;
  v_sell_total numeric;
  v_cost_total numeric;
  v_discount numeric;
  v_grand numeric;
  v_line_count int := 0;
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_quote
    from public.quotations q
   where q.organization_id=p_org_id and q.id=p_quotation_id
   for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_quote.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;

  if length(trim(coalesce(p_prospect_name,'')))=0 then
    raise exception 'PROSPECT_NAME_REQUIRED';
  end if;
  if p_customer_id is not null and not exists(
    select 1 from public.customers c
     where c.organization_id=p_org_id and c.id=p_customer_id and c.is_active
  ) then
    raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503';
  end if;
  if p_guest_count is not null and p_guest_count<1 then
    raise exception 'INVALID_GUEST_COUNT';
  end if;
  if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then
    raise exception 'INVALID_EVENT_WINDOW' using errcode='22007';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then
    raise exception 'INVALID_QUOTATION_LINES' using errcode='22023';
  end if;
  if jsonb_array_length(p_lines)>500 then
    raise exception 'TOO_MANY_QUOTATION_LINES' using errcode='22023';
  end if;

  update public.quotations set
    customer_id=p_customer_id,
    customer_name_snapshot=trim(p_prospect_name),
    customer_phone_snapshot=nullif(trim(coalesce(p_prospect_phone,'')),''),
    prospect_whatsapp=nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
    prospect_company=nullif(trim(coalesce(p_prospect_company,'')),''),
    event_title_snapshot=coalesce(
      nullif(trim(coalesce(p_event_title,'')),''),trim(p_prospect_name)
    ),
    event_type_snapshot=coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),
    start_at_snapshot=p_start_at,
    end_at_snapshot=p_end_at,
    guest_count_snapshot=p_guest_count,
    venue_snapshot=nullif(trim(coalesce(p_venue_name,'')),''),
    notes=p_notes
  where id=p_quotation_id;

  delete from public.quotation_lines l
   where l.organization_id=p_org_id and l.quotation_id=p_quotation_id;

  for v_line in
    select value, ordinality
      from jsonb_array_elements(p_lines) with ordinality
  loop
    v_line_id := coalesce(nullif(v_line.value->>'id','')::uuid,gen_random_uuid());
    v_description := trim(coalesce(v_line.value->>'description',''));
    v_unit := trim(coalesce(v_line.value->>'unit',''));
    v_method := (v_line.value->>'pricing_method')::public.pricing_method;
    v_quantity := (v_line.value->>'quantity')::numeric;
    v_selling := (v_line.value->>'unit_selling_price')::numeric;
    v_cost := coalesce((v_line.value->>'expected_unit_cost')::numeric,0);

    if length(v_description)=0 or length(v_unit)=0
       or v_quantity is null or v_quantity<=0
       or v_selling is null or v_selling<0 or v_cost<0 then
      raise exception 'INVALID_LINE';
    end if;
    if v_method='PER_GUEST' and p_guest_count is null then
      raise exception 'GUEST_COUNT_REQUIRED';
    end if;

    insert into public.quotation_lines(
      id,organization_id,quotation_id,source_catalog_item_id,source_package_id,
      description,item_type,unit,pricing_method,quantity,unit_selling_price,
      expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order
    ) values (
      v_line_id,p_org_id,p_quotation_id,
      nullif(v_line.value->>'source_catalog_item_id','')::uuid,
      nullif(v_line.value->>'source_package_id','')::uuid,
      v_description,(v_line.value->>'item_type')::public.catalog_item_type,
      v_unit,v_method,v_quantity,v_selling,v_cost,
      public.commercial_total(v_method,v_selling,v_quantity,p_guest_count),
      public.commercial_total(v_method,v_cost,v_quantity,p_guest_count),
      coalesce((v_line.value->>'is_custom')::boolean,true),
      nullif(v_line.value->>'notes',''),(v_line.ordinality-1)::int
    );
    v_line_count := v_line_count+1;
  end loop;

  select coalesce(sum(l.total_selling),0),coalesce(sum(l.total_expected_cost),0)
    into v_sell_total,v_cost_total
    from public.quotation_lines l
   where l.organization_id=p_org_id and l.quotation_id=p_quotation_id;

  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_sell_total, v_quote.transport_amount, v_quote.surcharge_amount, v_quote.discount_type, v_quote.discount_value) q;

  update public.quotations set
    subtotal=v_sell_total,
    discount_amount=v_discount,
    total_selling=v_grand,
    total_expected_cost=v_cost_total,
    total_expected_profit=v_grand-v_cost_total
  where id=p_quotation_id
  returning * into v_quote;

  perform public.record_audit(
    p_org_id,'QUOTATION_DRAFT_SAVED','quotation',p_quotation_id::text,
    jsonb_build_object('line_count',v_line_count)
  );
  return v_quote;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Read model — expose price components + derived is_expired.
-- ---------------------------------------------------------------------------
drop view if exists public.quotations_customer;
drop function if exists public._view_quotations_customer();

create function public._view_quotations_customer()
returns table(
  id uuid,organization_id uuid,event_id uuid,quotation_number text,revision int,status public.quotation_status,
  customer_id uuid,customer_name_snapshot text,customer_phone_snapshot text,prospect_whatsapp text,prospect_company text,
  event_number_snapshot text,event_title_snapshot text,event_type_snapshot text,guest_count_snapshot int,
  start_at_snapshot timestamptz,end_at_snapshot timestamptz,venue_snapshot text,location_snapshot text,
  terms text,notes text,subtotal numeric,total_selling numeric,
  transport_required boolean,transport_zone text,transport_amount numeric,transport_note text,
  surcharge_amount numeric,surcharge_note text,
  discount_type public.quotation_discount_type,discount_value numeric,discount_amount numeric,
  valid_until timestamptz,series_id uuid,superseded_reason text,
  issued_at timestamptz,accepted_at timestamptz,rejected_at timestamptz,expired_at timestamptz,
  converted_event_id uuid,is_expired boolean,created_at timestamptz,updated_at timestamptz
) language sql stable security definer set search_path='' as $$
  select q.id,q.organization_id,q.event_id,q.quotation_number,q.revision,q.status,q.customer_id,
    q.customer_name_snapshot,q.customer_phone_snapshot,q.prospect_whatsapp,q.prospect_company,
    q.event_number_snapshot,q.event_title_snapshot,q.event_type_snapshot,q.guest_count_snapshot,
    q.start_at_snapshot,q.end_at_snapshot,q.venue_snapshot,q.location_snapshot,q.terms,q.notes,
    q.subtotal,q.total_selling,
    q.transport_required,q.transport_zone,q.transport_amount,q.transport_note,
    q.surcharge_amount,q.surcharge_note,
    q.discount_type,q.discount_value,q.discount_amount,
    q.valid_until,q.series_id,q.superseded_reason,
    q.issued_at,q.accepted_at,q.rejected_at,q.expired_at,q.converted_event_id,
    (q.status='ISSUED' and q.valid_until is not null and q.valid_until < now()),
    q.created_at,q.updated_at
  from public.quotations q
  where public.is_org_member(q.organization_id)
    and (q.status not in ('DRAFT','CANCELLED') or public.can_manage_commercial(q.organization_id))
$$;
create view public.quotations_customer with (security_invoker=true) as select * from public._view_quotations_customer();

revoke all on function public._view_quotations_customer() from public,anon,authenticated;
grant execute on function public._view_quotations_customer() to authenticated;
revoke all on table public.quotations_customer from anon,authenticated;
grant select on table public.quotations_customer to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Grants for the new/rewritten commands (browser roles only).
-- ---------------------------------------------------------------------------
revoke all on function public.set_quotation_pricing(uuid,uuid,boolean,text,numeric,text,numeric,text,public.quotation_discount_type,numeric,timestamptz,uuid) from public,anon;
revoke all on function public.reject_quotation(uuid,uuid,text,uuid) from public,anon;
revoke all on function public.expire_quotation(uuid,uuid,uuid) from public,anon;
revoke all on function public.revise_quotation(uuid,uuid,text,uuid) from public,anon;

grant execute on function public.set_quotation_pricing(uuid,uuid,boolean,text,numeric,text,numeric,text,public.quotation_discount_type,numeric,timestamptz,uuid) to authenticated;
grant execute on function public.reject_quotation(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.expire_quotation(uuid,uuid,uuid) to authenticated;
grant execute on function public.revise_quotation(uuid,uuid,text,uuid) to authenticated;
