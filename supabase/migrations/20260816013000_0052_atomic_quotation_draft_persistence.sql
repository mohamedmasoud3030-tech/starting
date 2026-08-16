-- ============================================================================
-- 0052 / R11 follow-up — atomic quotation draft aggregate persistence
--
-- Header and the complete line collection are one draft aggregate. Replacing
-- lines through several browser RPCs can leave a partial draft after a network
-- interruption, so Save Draft and pre-Issue persistence use this single
-- transaction boundary instead.
-- ============================================================================

create function public.save_quotation_draft(
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

  -- Full replacement is intentional and safe only because the parent is locked
  -- in DRAFT and this delete + validated insert + aggregate update is one DB
  -- transaction. Any cast/FK/check failure rolls back header and all lines.
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

  update public.quotations set
    total_selling=v_sell_total,
    total_expected_cost=v_cost_total,
    total_expected_profit=v_sell_total-v_cost_total
  where id=p_quotation_id
  returning * into v_quote;

  perform public.record_audit(
    p_org_id,'QUOTATION_DRAFT_SAVED','quotation',p_quotation_id::text,
    jsonb_build_object('line_count',v_line_count)
  );
  return v_quote;
end;
$$;

revoke all on function public.save_quotation_draft(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) from public,anon;
grant execute on function public.save_quotation_draft(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) to authenticated;

comment on function public.save_quotation_draft(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) is 'Atomically replaces the complete editable quotation draft aggregate; issued quotations remain immutable.';
