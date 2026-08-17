-- Batched event readiness (defect D19): the operational dashboard previously
-- issued one `event_readiness` RPC per today's event (N+1). This set-returning
-- read model computes staff shortage and equipment shortage for every
-- requested event in a single pass, with identical semantics to the per-event
-- function (0015) plus an explicit organization-membership guard.
--
-- Read-only, additive, no data touched. The per-event RPC remains for the
-- event workspace.

create or replace function public.event_readiness_batch(
  p_org_id uuid,
  p_event_ids uuid[]
)
returns table (
  event_id uuid,
  status text,
  staff_missing int,
  equipment_shortage int
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select public.is_org_member(p_org_id) as ok
  ),
  staff_needed as (
    select l.event_id,
           coalesce(sum(ceil(l.quantity)) filter (where l.item_type = 'STAFF'), 0)::int as needed
    from public.event_commercial_lines l
    where l.organization_id = p_org_id
      and l.event_id = any (p_event_ids)
    group by l.event_id
  ),
  staff_assigned as (
    select a.event_id, count(*)::int as assigned
    from public.event_staff_assignments a
    where a.event_id = any (p_event_ids)
      and a.status = 'ACTIVE'
    group by a.event_id
  ),
  equipment_short as (
    select l.event_id,
           coalesce(sum(greatest(ceil(l.quantity)::int - coalesce(r.qty, 0), 0)), 0)::int as short
    from public.event_commercial_lines l
    left join (
      select er.event_id, ec.catalog_item_id, sum(er.quantity)::int as qty
      from public.event_equipment_reservations er
      join public.equipment_capacity ec on ec.id = er.equipment_capacity_id
      where er.event_id = any (p_event_ids)
        and er.status = 'ACTIVE'
      group by er.event_id, ec.catalog_item_id
    ) r on r.event_id = l.event_id and r.catalog_item_id = l.source_catalog_item_id
    where l.organization_id = p_org_id
      and l.event_id = any (p_event_ids)
      and l.item_type = 'REUSABLE_EQUIPMENT'
    group by l.event_id
  )
  select
    ids.id as event_id,
    case
      when greatest(coalesce(sn.needed, 0) - coalesce(sa.assigned, 0), 0) > 0
       and coalesce(eq.short, 0) > 0 then 'MULTIPLE_ISSUES'
      when greatest(coalesce(sn.needed, 0) - coalesce(sa.assigned, 0), 0) > 0 then 'STAFF_MISSING'
      when coalesce(eq.short, 0) > 0 then 'EQUIPMENT_SHORTAGE'
      else 'READY'
    end as status,
    greatest(coalesce(sn.needed, 0) - coalesce(sa.assigned, 0), 0)::int as staff_missing,
    coalesce(eq.short, 0)::int as equipment_shortage
  from unnest(p_event_ids) as ids(id)
  left join staff_needed sn on sn.event_id = ids.id
  left join staff_assigned sa on sa.event_id = ids.id
  left join equipment_short eq on eq.event_id = ids.id
  where exists (select 1 from members where ok)
    and exists (
      select 1 from public.events e
      where e.organization_id = p_org_id and e.id = ids.id
    );
$$;

revoke all on function public.event_readiness_batch(uuid, uuid[]) from public, anon;
grant execute on function public.event_readiness_batch(uuid, uuid[]) to authenticated;
