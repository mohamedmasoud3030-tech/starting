-- ============================================================================
-- 0064 — Keep the two legacy line-edit commands consistent with the new
-- pricing model. They remain client-callable (granted in 0051) so their total
-- computation must route through quotation_pricing() exactly like the canonical
-- save_quotation_draft path — one pricing source of truth, no drift.
-- ============================================================================

create or replace function public.save_quotation_line(
  p_org_id uuid,p_quotation_id uuid,p_line_id uuid,p_description text,
  p_item_type public.catalog_item_type,p_unit text,p_pricing_method public.pricing_method,
  p_quantity numeric,p_unit_selling_price numeric,p_expected_unit_cost numeric default 0,
  p_is_custom boolean default true,p_source_catalog_item_id uuid default null,p_source_package_id uuid default null,p_notes text default null
) returns public.quotation_lines language plpgsql security definer set search_path='' as $$
declare v_quote public.quotations; v public.quotation_lines; v_sell numeric; v_cost numeric; v_subtotal numeric; v_discount numeric; v_grand numeric;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v_quote from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_quote.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if length(trim(coalesce(p_description,'')))=0 or length(trim(coalesce(p_unit,'')))=0 then raise exception 'INVALID_LINE'; end if;
  if p_quantity<=0 or p_unit_selling_price<0 or p_expected_unit_cost<0 then raise exception 'INVALID_LINE'; end if;
  if p_pricing_method='PER_GUEST' and v_quote.guest_count_snapshot is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  if p_source_catalog_item_id is not null and not exists(select 1 from public.catalog_items c where c.organization_id=p_org_id and c.id=p_source_catalog_item_id) then raise exception 'CATALOG_ITEM_NOT_IN_ORG' using errcode='23503'; end if;
  if p_source_package_id is not null and not exists(select 1 from public.packages p where p.organization_id=p_org_id and p.id=p_source_package_id) then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
  v_sell=public.commercial_total(p_pricing_method,p_unit_selling_price,p_quantity,v_quote.guest_count_snapshot);
  v_cost=public.commercial_total(p_pricing_method,p_expected_unit_cost,p_quantity,v_quote.guest_count_snapshot);
  if p_line_id is null then
    insert into public.quotation_lines(organization_id,quotation_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order)
    values(p_org_id,p_quotation_id,p_source_catalog_item_id,p_source_package_id,trim(p_description),p_item_type,trim(p_unit),p_pricing_method,p_quantity,p_unit_selling_price,p_expected_unit_cost,v_sell,v_cost,p_is_custom,p_notes,coalesce((select max(sort_order)+1 from public.quotation_lines where quotation_id=p_quotation_id),0)) returning * into v;
  else
    update public.quotation_lines set source_catalog_item_id=p_source_catalog_item_id,source_package_id=p_source_package_id,description=trim(p_description),item_type=p_item_type,unit=trim(p_unit),pricing_method=p_pricing_method,quantity=p_quantity,unit_selling_price=p_unit_selling_price,expected_unit_cost=p_expected_unit_cost,total_selling=v_sell,total_expected_cost=v_cost,is_custom=p_is_custom,notes=p_notes
     where id=p_line_id and quotation_id=p_quotation_id and organization_id=p_org_id returning * into v;
    if not found then raise exception 'LINE_NOT_FOUND'; end if;
  end if;
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v_quote.transport_amount, v_quote.surcharge_amount, v_quote.discount_type, v_quote.discount_value) q;
  update public.quotations set subtotal=v_subtotal, discount_amount=v_discount, total_selling=v_grand, total_expected_cost=v_cost, total_expected_profit=v_grand-v_cost where id=p_quotation_id;
  return v;
end$$;

create or replace function public.update_quotation_draft(
  p_org_id uuid,p_quotation_id uuid,p_prospect_name text,p_customer_id uuid default null,
  p_prospect_phone text default null,p_prospect_whatsapp text default null,
  p_prospect_company text default null,p_event_title text default null,
  p_event_type text default null,p_start_at timestamptz default null,
  p_end_at timestamptz default null,p_guest_count int default null,
  p_venue_name text default null,p_notes text default null
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_subtotal numeric; v_cost numeric; v_discount numeric; v_grand numeric;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if length(trim(coalesce(p_prospect_name,'')))=0 then raise exception 'PROSPECT_NAME_REQUIRED'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers c where c.organization_id=p_org_id and c.id=p_customer_id and c.is_active) then raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503'; end if;
  if p_guest_count is not null and p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
  if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
  update public.quotations set customer_id=p_customer_id,customer_name_snapshot=trim(p_prospect_name),
    customer_phone_snapshot=nullif(trim(coalesce(p_prospect_phone,'')),''),prospect_whatsapp=nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
    prospect_company=nullif(trim(coalesce(p_prospect_company,'')),''),event_title_snapshot=coalesce(nullif(trim(coalesce(p_event_title,'')),''),trim(p_prospect_name)),
    event_type_snapshot=coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),start_at_snapshot=p_start_at,end_at_snapshot=p_end_at,
    guest_count_snapshot=p_guest_count,venue_snapshot=nullif(trim(coalesce(p_venue_name,'')),''),notes=p_notes
  where id=p_quotation_id returning * into v;
  update public.quotation_lines l set total_selling=public.commercial_total(l.pricing_method,l.unit_selling_price,l.quantity,p_guest_count),
    total_expected_cost=public.commercial_total(l.pricing_method,l.expected_unit_cost,l.quantity,p_guest_count)
   where l.quotation_id=p_quotation_id and (l.pricing_method<>'PER_GUEST' or p_guest_count is not null);
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value) q;
  update public.quotations set subtotal=v_subtotal, discount_amount=v_discount, total_selling=v_grand, total_expected_cost=v_cost, total_expected_profit=v_grand-v_cost where id=p_quotation_id returning * into v;
  return v;
end$$;
