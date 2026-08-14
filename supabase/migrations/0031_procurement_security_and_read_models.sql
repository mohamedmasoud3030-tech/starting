-- ============================================================================
-- 0031 — S5A RLS, least privilege and stable frontend read models
--
-- Cost-bearing base tables/views are OWNER/MANAGER/ACCOUNTANT only. WAREHOUSE
-- receives through explicit cost-free projections and can never read agreed
-- unit/total cost or internal supplier/order notes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RLS: all S5A business tables are organization-scoped.
-- ENABLE (rather than FORCE) follows the repository convention: SECURITY
-- DEFINER commands run as owner; client writes are independently denied by
-- no write policy, explicit grant revocation and structural history triggers.
-- ---------------------------------------------------------------------------
alter table public.procurement_command_idempotency enable row level security;
alter table public.suppliers enable row level security;
alter table public.procurement_orders enable row level security;
alter table public.procurement_order_lines enable row level security;
alter table public.procurement_receipts enable row level security;
alter table public.procurement_receipt_lines enable row level security;

create policy suppliers_cost_reader_select on public.suppliers
  for select using (public.can_read_cost(organization_id));
create policy procurement_orders_cost_reader_select on public.procurement_orders
  for select using (public.can_read_cost(organization_id));
create policy procurement_order_lines_cost_reader_select on public.procurement_order_lines
  for select using (public.can_read_cost(organization_id));
create policy procurement_receipts_member_select on public.procurement_receipts
  for select using (public.is_org_member(organization_id));
create policy procurement_receipt_lines_member_select on public.procurement_receipt_lines
  for select using (public.is_org_member(organization_id));
-- No policy on procurement_command_idempotency: responses/fingerprints are
-- internal command machinery, not a client read model.
-- No INSERT/UPDATE/DELETE policy exists on any S5A table.

-- ---------------------------------------------------------------------------
-- SupplierSummary — operational contact identity; safe for every member.
-- Deliberately excludes commercial registration, email and internal notes.
-- ---------------------------------------------------------------------------
create view public.supplier_summaries as
select
  s.id as supplier_id,
  s.organization_id,
  s.name,
  s.category,
  s.contact_name,
  s.phone,
  s.whatsapp,
  s.status,
  s.created_at,
  s.updated_at
from public.suppliers s
where public.is_org_member(s.organization_id);

-- ---------------------------------------------------------------------------
-- ProcurementOrderSummary — cost-bearing list for cost readers.
-- ---------------------------------------------------------------------------
create view public.procurement_order_summaries as
select
  o.id as order_id,
  o.organization_id,
  o.order_number,
  o.supplier_id,
  coalesce(o.supplier_name_snapshot, s.name) as supplier_name,
  o.event_id,
  e.event_number,
  e.title as event_title,
  o.order_date,
  o.expected_delivery_at,
  o.status,
  o.agreed_total_cost,
  count(l.id)::integer as line_count,
  o.approved_at,
  o.sent_at,
  o.confirmed_at,
  o.cancelled_at,
  o.created_at,
  o.updated_at
from public.procurement_orders o
join public.suppliers s
  on s.organization_id = o.organization_id and s.id = o.supplier_id
left join public.events e
  on e.organization_id = o.organization_id and e.id = o.event_id
left join public.procurement_order_lines l
  on l.organization_id = o.organization_id and l.order_id = o.id
where public.can_read_cost(o.organization_id)
group by o.id, s.name, e.event_number, e.title;

-- ---------------------------------------------------------------------------
-- ProcurementOrderDetail — one cost-bearing header row per order.
-- ---------------------------------------------------------------------------
create view public.procurement_order_details as
select
  o.id as order_id,
  o.organization_id,
  o.order_number,
  o.supplier_id,
  coalesce(o.supplier_name_snapshot, s.name) as supplier_name,
  o.supplier_name_snapshot,
  o.supplier_contact_name_snapshot,
  o.supplier_phone_snapshot,
  o.event_id,
  e.event_number,
  e.title as event_title,
  o.order_date,
  o.expected_delivery_at,
  o.notes,
  o.status,
  o.agreed_total_cost,
  o.approved_by,
  o.approved_at,
  o.sent_by,
  o.sent_at,
  o.confirmed_by,
  o.confirmed_at,
  o.cancelled_by,
  o.cancelled_at,
  o.cancellation_reason,
  o.created_by,
  o.created_at,
  o.updated_at
from public.procurement_orders o
join public.suppliers s
  on s.organization_id = o.organization_id and s.id = o.supplier_id
left join public.events e
  on e.organization_id = o.organization_id and e.id = o.event_id
where public.can_read_cost(o.organization_id);

-- ---------------------------------------------------------------------------
-- ProcurementOrderLine — negotiated immutable line snapshots + receipt state.
-- ---------------------------------------------------------------------------
create view public.procurement_order_line_summaries as
select
  l.id as order_line_id,
  l.organization_id,
  l.order_id,
  l.line_kind,
  l.catalog_item_id,
  l.stock_item_id,
  l.description,
  l.unit,
  l.quantity as ordered_quantity,
  coalesce(sum(rl.quantity), 0)::numeric(12,3) as received_quantity,
  (l.quantity - coalesce(sum(rl.quantity), 0))::numeric(12,3) as remaining_quantity,
  l.agreed_unit_cost,
  l.agreed_total_cost,
  l.sort_order,
  l.created_at
from public.procurement_order_lines l
left join public.procurement_receipt_lines rl
  on rl.organization_id = l.organization_id and rl.order_line_id = l.id
where public.can_read_cost(l.organization_id)
group by l.id;

-- ---------------------------------------------------------------------------
-- ProcurementReceiptSummary — operational and cost-free.
-- ---------------------------------------------------------------------------
create view public.procurement_receipt_summaries as
select
  r.id as receipt_id,
  r.organization_id,
  r.order_id,
  o.order_number,
  o.status as order_status,
  o.event_id,
  coalesce(o.supplier_name_snapshot, s.name) as supplier_name,
  r.received_at,
  r.reference,
  r.notes,
  r.received_by,
  count(rl.id)::integer as line_count,
  bool_or(rl.consumable_movement_id is not null) as has_stock_movements,
  r.created_at
from public.procurement_receipts r
join public.procurement_orders o
  on o.organization_id = r.organization_id and o.id = r.order_id
join public.suppliers s
  on s.organization_id = o.organization_id and s.id = o.supplier_id
left join public.procurement_receipt_lines rl
  on rl.organization_id = r.organization_id and rl.receipt_id = r.id
where public.is_org_member(r.organization_id)
group by r.id, o.order_number, o.status, o.event_id,
         o.supplier_name_snapshot, s.name;

-- ---------------------------------------------------------------------------
-- Cost-free receiving projections for SUPERVISOR/WAREHOUSE.
-- ---------------------------------------------------------------------------
create view public.procurement_receiving_order_summaries as
select
  o.id as order_id,
  o.organization_id,
  o.order_number,
  o.supplier_id,
  coalesce(o.supplier_name_snapshot, s.name) as supplier_name,
  coalesce(o.supplier_contact_name_snapshot, s.contact_name) as supplier_contact_name,
  coalesce(o.supplier_phone_snapshot, s.phone) as supplier_phone,
  o.event_id,
  e.event_number,
  e.title as event_title,
  o.order_date,
  o.expected_delivery_at,
  o.status,
  o.confirmed_at,
  o.updated_at
from public.procurement_orders o
join public.suppliers s
  on s.organization_id = o.organization_id and s.id = o.supplier_id
left join public.events e
  on e.organization_id = o.organization_id and e.id = o.event_id
where public.is_org_member(o.organization_id);

create view public.procurement_receiving_line_summaries as
select
  l.id as order_line_id,
  l.organization_id,
  l.order_id,
  l.line_kind,
  l.catalog_item_id,
  l.stock_item_id,
  l.description,
  l.unit,
  l.quantity as ordered_quantity,
  coalesce(sum(rl.quantity), 0)::numeric(12,3) as received_quantity,
  (l.quantity - coalesce(sum(rl.quantity), 0))::numeric(12,3) as remaining_quantity,
  l.sort_order
from public.procurement_order_lines l
left join public.procurement_receipt_lines rl
  on rl.organization_id = l.organization_id and rl.order_line_id = l.id
where public.is_org_member(l.organization_id)
group by l.id;

-- ---------------------------------------------------------------------------
-- EventProcurementCostSummary — stable S6 handoff. It distinguishes original
-- negotiated order value, still-active commitment and actually delivered cost
-- (including preserved receipts on subsequently cancelled partial orders).
-- ---------------------------------------------------------------------------
create view public.event_procurement_cost_summaries as
select
  e.organization_id,
  e.id as event_id,
  e.event_number,
  count(o.id) filter (where o.approved_at is not null and o.status <> 'CANCELLED')::integer
    as active_order_count,
  count(o.id) filter (where o.status = 'CANCELLED')::integer
    as cancelled_order_count,
  coalesce(sum(o.agreed_total_cost) filter (where o.approved_at is not null), 0)::numeric(14,3)
    as all_approved_order_cost,
  coalesce(sum(o.agreed_total_cost) filter (
    where o.approved_at is not null and o.status <> 'CANCELLED'
  ), 0)::numeric(14,3) as active_committed_cost,
  coalesce((
    select sum(round(rl.quantity * l.agreed_unit_cost, 3))
      from public.procurement_receipt_lines rl
      join public.procurement_order_lines l
        on l.organization_id = rl.organization_id and l.id = rl.order_line_id
     where rl.organization_id = e.organization_id
       and l.order_id in (
         select eo.id from public.procurement_orders eo
          where eo.organization_id = e.organization_id and eo.event_id = e.id
       )
  ), 0)::numeric(14,3) as delivered_cost
from public.events e
left join public.procurement_orders o
  on o.organization_id = e.organization_id and o.event_id = e.id
where public.can_read_cost(e.organization_id)
group by e.organization_id, e.id, e.event_number;

-- One procurement-domain audit row per parent command key. Child S4B RECEIVE
-- movements use deterministic child keys and remain separately auditable.
create unique index procurement_audit_idempotency_unique
  on public.audit_events (organization_id, (metadata ->> 'idempotency_key'))
  where entity in ('supplier', 'procurement_order', 'procurement_receipt')
    and metadata ? 'idempotency_key';

-- ---------------------------------------------------------------------------
-- Explicit Supabase default-grant revocation. New Supabase tables otherwise
-- inherit broad anon/authenticated DML. Raw tables are not frontend contracts;
-- only stable read models are granted SELECT.
-- ---------------------------------------------------------------------------
revoke all on table
  public.procurement_command_idempotency,
  public.suppliers,
  public.procurement_orders,
  public.procurement_order_lines,
  public.procurement_receipts,
  public.procurement_receipt_lines,
  public.supplier_summaries,
  public.procurement_order_summaries,
  public.procurement_order_details,
  public.procurement_order_line_summaries,
  public.procurement_receipt_summaries,
  public.procurement_receiving_order_summaries,
  public.procurement_receiving_line_summaries,
  public.event_procurement_cost_summaries
  from anon, authenticated;

grant select on table
  public.supplier_summaries,
  public.procurement_order_summaries,
  public.procurement_order_details,
  public.procurement_order_line_summaries,
  public.procurement_receipt_summaries,
  public.procurement_receiving_order_summaries,
  public.procurement_receiving_line_summaries,
  public.event_procurement_cost_summaries
  to authenticated;
