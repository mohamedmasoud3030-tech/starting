-- ============================================================================
-- 0010 — save_package(): transactional command for package templates
-- Create or fully replace a package and its template lines in ONE transaction.
-- Authorization and organization scoping are enforced server-side.
-- ============================================================================

create or replace function public.save_package(
  p_org_id uuid,
  p_package_id uuid,
  p_name text,
  p_name_en text default null,
  p_description text default null,
  p_status package_status default 'ACTIVE',
  p_base_guest_count int default null,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_item jsonb;
  v_catalog_item_id uuid;
  v_quantity numeric(12,3);
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'PACKAGE_NAME_REQUIRED';
  end if;

  if p_package_id is null then
    insert into public.packages (organization_id, name, name_en, description, status, base_guest_count)
    values (p_org_id, trim(p_name), p_name_en, p_description, p_status, p_base_guest_count)
    returning id into v_package_id;
  else
    update public.packages
    set name = trim(p_name),
        name_en = p_name_en,
        description = p_description,
        status = p_status,
        base_guest_count = p_base_guest_count,
        updated_at = now()
    where id = p_package_id and organization_id = p_org_id
    returning id into v_package_id;

    if v_package_id is null then
      raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002';
    end if;

    delete from public.package_items where package_id = v_package_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_catalog_item_id := (v_item ->> 'catalog_item_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::numeric, 0);

    if v_quantity < 0 then
      raise exception 'INVALID_QUANTITY';
    end if;

    if not exists (
      select 1 from public.catalog_items c
      where c.id = v_catalog_item_id and c.organization_id = p_org_id
    ) then
      raise exception 'CATALOG_ITEM_NOT_IN_ORG' using errcode = '23503';
    end if;

    insert into public.package_items (organization_id, package_id, catalog_item_id, quantity)
    values (p_org_id, v_package_id, v_catalog_item_id, v_quantity);
  end loop;

  return v_package_id;
end;
$$;

revoke all on function public.save_package(uuid, uuid, text, text, text, package_status, int, jsonb) from public;
grant execute on function public.save_package(uuid, uuid, text, text, text, package_status, int, jsonb) to authenticated;
