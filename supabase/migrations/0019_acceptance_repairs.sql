-- ============================================================================
-- 0019 — Acceptance repairs discovered by authoritative Supabase CI.
--
-- Keep historical migrations immutable. This forward-only repair fixes the
-- event_readiness aggregate so FILTER applies to the aggregate expression,
-- not to ceil(). The previous expression was accepted at function-definition
-- time but failed when executed by PostgreSQL.
-- ============================================================================

create or replace function public.event_readiness(p_org_id uuid,p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_staff_needed int;
  v_staff_assigned int;
  v_eq_short int;
  v_status text;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select coalesce(ceil(sum(quantity) filter (where item_type='STAFF')),0)::int
    into v_staff_needed
    from public.event_commercial_lines
   where organization_id=p_org_id and event_id=p_event_id;

  select count(*)
    into v_staff_assigned
    from public.event_staff_assignments
   where event_id=p_event_id and status='ACTIVE';

  select coalesce(sum(greatest(ceil(l.quantity)::int-coalesce(r.qty,0),0)),0)::int
    into v_eq_short
    from public.event_commercial_lines l
    left join (
      select ec.catalog_item_id,sum(er.quantity)::int qty
        from public.event_equipment_reservations er
        join public.equipment_capacity ec on ec.id=er.equipment_capacity_id
       where er.event_id=p_event_id and er.status='ACTIVE'
       group by ec.catalog_item_id
    ) r on r.catalog_item_id=l.source_catalog_item_id
   where l.event_id=p_event_id and l.item_type='REUSABLE_EQUIPMENT';

  v_status:=case
    when greatest(v_staff_needed-v_staff_assigned,0)>0 and v_eq_short>0 then 'MULTIPLE_ISSUES'
    when greatest(v_staff_needed-v_staff_assigned,0)>0 then 'STAFF_MISSING'
    when v_eq_short>0 then 'EQUIPMENT_SHORTAGE'
    else 'READY'
  end;

  return jsonb_build_object(
    'status',v_status,
    'staff_missing',greatest(v_staff_needed-v_staff_assigned,0),
    'equipment_shortage',v_eq_short
  );
end$$;

revoke all on function public.event_readiness(uuid,uuid) from public,anon;
grant execute on function public.event_readiness(uuid,uuid) to authenticated;
