-- ============================================================================
-- 0065 — apply_package_to_quotation must populate subtotal and route the grand
-- total through quotation_pricing(), matching save_quotation_draft. Before this
-- fix, applying a package left subtotal at 0 so a subsequent set_quotation_pricing
-- computed the grand total from a zero base (transport/discount misapplied).
-- ============================================================================

create or replace function public.apply_package_to_quotation(p_org_id uuid, p_quotation_id uuid, p_package_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_count int; v_subtotal numeric; v_cost numeric; v_discount numeric; v_grand numeric;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if not exists(select 1 from public.packages p where p.organization_id=p_org_id and p.id=p_package_id and p.status='ACTIVE') then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
  if exists(select 1 from public.quotation_lines where organization_id=p_org_id and quotation_id=p_quotation_id and source_package_id=p_package_id) then raise exception 'PACKAGE_ALREADY_APPLIED'; end if;
  if v.guest_count_snapshot is null and exists(select 1 from public.package_items pi join public.catalog_items c on c.organization_id=pi.organization_id and c.id=pi.catalog_item_id where pi.organization_id=p_org_id and pi.package_id=p_package_id and c.pricing_method='PER_GUEST') then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  insert into public.quotation_lines(organization_id,quotation_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
  select p_org_id,p_quotation_id,c.id,p_package_id,c.name,c.item_type,c.unit,c.pricing_method,pi.quantity,c.selling_price,c.cost_price,
    public.commercial_total(c.pricing_method,c.selling_price,pi.quantity,v.guest_count_snapshot),public.commercial_total(c.pricing_method,c.cost_price,pi.quantity,v.guest_count_snapshot),false,coalesce((select max(sort_order)+1 from public.quotation_lines where quotation_id=p_quotation_id),0)+row_number() over(order by pi.sort_order)-1
  from public.package_items pi join public.catalog_items c on c.organization_id=pi.organization_id and c.id=pi.catalog_item_id
  where pi.organization_id=p_org_id and pi.package_id=p_package_id order by pi.sort_order;
  get diagnostics v_count=row_count;
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value) q;
  update public.quotations set subtotal=v_subtotal, discount_amount=v_discount, total_selling=v_grand, total_expected_cost=v_cost, total_expected_profit=v_grand-v_cost where id=p_quotation_id;
  perform public.record_audit(p_org_id,'PACKAGE_APPLIED_QUOTATION','quotation',p_quotation_id::text,jsonb_build_object('package_id',p_package_id,'lines',v_count));
  return v_count;
end$$;
