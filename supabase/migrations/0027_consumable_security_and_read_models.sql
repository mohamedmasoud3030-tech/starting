-- ============================================================================
-- 0027 — S4B consumable RLS, read models, and grants
--
-- COMMERCIAL SEPARATION: unlike S4A damage/loss, the consumable ledger stores
-- NO valuation columns at all (see the financial boundary in 0025), so the
-- movement ledger itself is safe for every org member including WAREHOUSE.
-- Cost remains exclusively on catalog_items behind can_read_cost(); none of
-- the views below join it in.
--
-- NULLABILITY: view columns are all generated as nullable (PostgreSQL cannot
-- prove view nullability). The views never coerce genuinely-missing critical
-- quantities to zero: the balance columns are real derived numerics from
-- COALESCE'd SUMs over an existing stock row — "no movements yet" is truly 0.
-- The frontend model layer still rejects rows whose critical values are
-- missing rather than defaulting them (same policy as S4A).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RLS — every new business table.
--
-- ENABLE (not FORCE) deliberately matches the S0–S4A convention: the
-- SECURITY DEFINER commands run as the table owner and are the only legal
-- write path; FORCE would break them without adding client-facing safety,
-- because client roles are already fully constrained by (1) RLS policies,
-- (2) explicit revocation of the default DML grants, and (3) the
-- append-only/structural triggers — three independent layers that must all
-- agree the RPCs are the only write path.
-- ---------------------------------------------------------------------------
alter table public.consumable_stock_items enable row level security;
alter table public.consumable_movements enable row level security;
alter table public.event_consumable_reconciliations enable row level security;

-- Read: any active member of the owning organization. No cost columns exist
-- on any of these tables, so WAREHOUSE-safe.
create policy consumable_stock_items_member_read
  on public.consumable_stock_items
  for select using (public.is_org_member(organization_id));

create policy consumable_movements_member_read
  on public.consumable_movements
  for select using (public.is_org_member(organization_id));

create policy event_consumable_reconciliations_member_read
  on public.event_consumable_reconciliations
  for select using (public.is_org_member(organization_id));

-- No INSERT/UPDATE/DELETE policy on any of the three tables: writes are only
-- legal through the SECURITY DEFINER commands in 0026. A direct client write
-- is rejected by RLS, and any privileged write is additionally re-validated
-- (movements) or rejected (reconciliations UPDATE/DELETE) by the triggers.

-- ---------------------------------------------------------------------------
-- consumable_stock_summary — the central stock screen: one row per tracked
-- item with catalog identity, exact on-hand, threshold and low-stock state.
-- SECURITY DEFINER view semantics with explicit is_org_member() row scoping,
-- matching the repository convention.
-- ---------------------------------------------------------------------------
create view public.consumable_stock_summary as
select
  s.id                                   as stock_item_id,
  s.organization_id,
  s.catalog_item_id,
  ci.name                                as item_name,
  ci.unit                                as item_unit,
  ci.status                              as catalog_status,
  s.is_tracking_active,
  s.minimum_stock_quantity,
  b.on_hand_quantity,
  -- Low stock derives ONLY from the authoritative balance and the configured
  -- threshold: on_hand <= minimum. (S5 procurement will consume this signal.)
  (b.on_hand_quantity <= s.minimum_stock_quantity) as is_low_stock,
  s.created_at,
  s.updated_at
from public.consumable_stock_items s
join public.catalog_items ci
  on ci.organization_id = s.organization_id
 and ci.id = s.catalog_item_id
cross join lateral (
  select coalesce(sum(m.warehouse_delta), 0)::numeric(14,3) as on_hand_quantity
    from public.consumable_movements m
   where m.organization_id = s.organization_id
     and m.stock_item_id = s.id
) b
where public.is_org_member(s.organization_id);

-- ---------------------------------------------------------------------------
-- event_consumable_lines — per Event/item custody state for the Event
-- workspace: issued / returned usable / consumed / wasted / outstanding plus
-- the Event-level reconciliation status.
-- ---------------------------------------------------------------------------
create view public.event_consumable_lines as
select
  m.organization_id,
  m.event_id,
  m.stock_item_id,
  s.catalog_item_id,
  ci.name                                as item_name,
  ci.unit                                as item_unit,
  sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT')::numeric(14,3)
                                         as issued_quantity,
  coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0)::numeric(14,3)
                                         as returned_quantity,
  coalesce(sum(m.quantity) filter (where m.movement_kind = 'CONSUME_AT_EVENT'), 0)::numeric(14,3)
                                         as consumed_quantity,
  coalesce(sum(m.quantity) filter (where m.movement_kind = 'WASTE_AT_EVENT'), 0)::numeric(14,3)
                                         as wasted_quantity,
  sum(m.event_delta)::numeric(14,3)      as outstanding_quantity,
  (rec.id is not null)                   as is_reconciled,
  rec.reconciled_at
from public.consumable_movements m
join public.consumable_stock_items s
  on s.organization_id = m.organization_id
 and s.id = m.stock_item_id
join public.catalog_items ci
  on ci.organization_id = s.organization_id
 and ci.id = s.catalog_item_id
left join public.event_consumable_reconciliations rec
  on rec.organization_id = m.organization_id
 and rec.event_id = m.event_id
where m.event_id is not null
  and public.is_org_member(m.organization_id)
group by m.organization_id, m.event_id, m.stock_item_id,
         s.catalog_item_id, ci.name, ci.unit, rec.id, rec.reconciled_at;

-- ---------------------------------------------------------------------------
-- event_consumable_summary — Event-level rollup for the "حالة التسوية" badge.
-- ---------------------------------------------------------------------------
create or replace function public.event_consumable_summary(
  p_org_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issued numeric;
  v_returned numeric;
  v_consumed numeric;
  v_wasted numeric;
  v_outstanding numeric;
  v_reconciled boolean;
  v_status text;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'ISSUE_TO_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'RETURN_FROM_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'CONSUME_AT_EVENT'), 0),
    coalesce(sum(m.quantity) filter (where m.movement_kind = 'WASTE_AT_EVENT'), 0),
    coalesce(sum(m.event_delta), 0)
  into v_issued, v_returned, v_consumed, v_wasted, v_outstanding
  from public.consumable_movements m
  where m.organization_id = p_org_id and m.event_id = p_event_id;

  v_reconciled := exists (
    select 1 from public.event_consumable_reconciliations
     where organization_id = p_org_id and event_id = p_event_id
  );

  v_status := case
    when v_reconciled then 'RECONCILED'
    when v_outstanding > 0 then 'OUTSTANDING'
    when v_issued > 0 then 'READY_TO_RECONCILE'
    else 'NO_CONSUMABLES'
  end;

  return jsonb_build_object(
    'status', v_status,
    'issued', v_issued::text,
    'returned', v_returned::text,
    'consumed', v_consumed::text,
    'wasted', v_wasted::text,
    'outstanding', v_outstanding::text,
    'is_reconciled', v_reconciled
  );
end;
$$;

revoke all on function public.event_consumable_summary(uuid, uuid) from public, anon;
grant execute on function public.event_consumable_summary(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- A Supabase database ships with default privileges granting ALL on new
-- tables to anon + authenticated. Creating a table and merely "not granting"
-- write is therefore NOT least privilege — the grant is already there. Every
-- new table/view revokes explicitly and re-grants SELECT only.
-- ---------------------------------------------------------------------------
revoke all on table
  public.consumable_stock_items,
  public.consumable_movements,
  public.event_consumable_reconciliations,
  public.consumable_stock_summary,
  public.event_consumable_lines
  from anon, authenticated;

grant select on table
  public.consumable_stock_items,
  public.consumable_movements,
  public.event_consumable_reconciliations,
  public.consumable_stock_summary,
  public.event_consumable_lines
  to authenticated;
