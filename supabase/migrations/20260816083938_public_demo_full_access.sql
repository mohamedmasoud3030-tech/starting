-- Temporary public full-access mode for the production demo organization.
-- Anonymous callers receive OWNER-equivalent application permissions ONLY for
-- the demo organization. Existing authenticated authorization remains unchanged.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.is_anon_request()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'anon'
$$;

create or replace function app_private.is_public_demo_request(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select app_private.is_anon_request()
     and exists (
       select 1
       from public.organizations o
       where o.id = p_org_id
         and o.name = 'شركة الريان للضيافة - Demo'
         and o.is_active = true
     )
$$;

create or replace function app_private.effective_actor_id()
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    auth.uid(),
    case when app_private.is_anon_request() then (
      select m.user_id
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where o.name = 'شركة الريان للضيافة - Demo'
        and o.is_active = true
        and m.status = 'ACTIVE'
        and m.role = 'OWNER'
      order by m.created_at
      limit 1
    ) end
  )
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select app_private.is_public_demo_request(p_org_id)
      or exists (
        select 1
        from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id
        where m.organization_id = p_org_id
          and m.user_id = auth.uid()
          and m.status = 'ACTIVE'
          and o.is_active = true
      )
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select app_private.is_public_demo_request(p_org_id)
      or exists (
        select 1
        from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id
        where m.organization_id = p_org_id
          and m.user_id = auth.uid()
          and m.status = 'ACTIVE'
          and o.is_active = true
          and m.role = any(p_roles)
      )
$$;

-- Commands write actor/audit FKs. Preserve real authenticated actors, while
-- anonymous demo requests use the existing demo OWNER solely as a system actor.
do $patch_actor$
declare
  r record;
  v_definition text;
begin
  for r in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in ('is_org_member', 'has_org_role', 'create_organization')
      and pg_catalog.pg_get_functiondef(p.oid) ilike '%auth.uid()%'
  loop
    v_definition := replace(
      pg_catalog.pg_get_functiondef(r.oid),
      'auth.uid()',
      'app_private.effective_actor_id()'
    );
    execute v_definition;
  end loop;
end
$patch_actor$;

-- Anonymous clients need the same read surface as signed-in clients. RLS still
-- scopes every row, and the helper override returns true only for the demo org.
do $grant_reads$
declare
  r record;
begin
  for r in
    select distinct g.table_name
    from information_schema.role_table_grants g
    where g.grantee = 'authenticated'
      and g.table_schema = 'public'
      and g.privilege_type = 'SELECT'
  loop
    execute format('grant select on table public.%I to anon', r.table_name);
  end loop;
end
$grant_reads$;

-- Direct CRUD used by current browser screens. Database RLS and immutable
-- ledger guards remain authoritative; no TRUNCATE, REFERENCES or TRIGGER grants.
grant select, insert, update, delete on table public.catalog_categories to anon;
grant select, insert, update, delete on table public.catalog_items to anon;
grant select, insert, update, delete on table public.customers to anon;
grant select, insert, update, delete on table public.equipment_capacity to anon;
grant select, insert, update, delete on table public.event_commercial_lines to anon;
grant select, insert, update, delete on table public.event_equipment_reservations to anon;
grant select, insert, update, delete on table public.event_staff_assignments to anon;
grant select, insert, update, delete on table public.event_status_history to anon;
grant select, insert, update, delete on table public.events to anon;
grant select, insert, update, delete on table public.package_items to anon;
grant select, insert, update, delete on table public.packages to anon;
grant select, insert, update, delete on table public.quotation_lines to anon;
grant select, insert, update, delete on table public.quotations to anon;
grant select, insert, update, delete on table public.staff_members to anon;

-- Application command/read RPC allowlist. Internal primitives and
-- create_organization intentionally remain private.
do $grant_rpc$
declare
  r record;
  v_allowed constant text[] := array[
    '_view_catalog_items_operational','_view_consumable_stock_summary',
    '_view_customer_payment_summaries','_view_event_commercial_lines_operational',
    '_view_event_consumable_lines','_view_event_finance_summaries',
    '_view_event_procurement_cost_summaries','_view_event_staff_assignments_operational',
    '_view_event_warehouse_lines','_view_event_warehouse_lines_valued',
    '_view_host_event_payroll_summaries','_view_host_payout_summaries',
    '_view_invoice_installment_summaries','_view_invoice_summaries',
    '_view_procurement_order_details','_view_procurement_order_line_summaries',
    '_view_procurement_order_summaries','_view_procurement_receipt_line_summaries',
    '_view_procurement_receipt_summaries','_view_procurement_receiving_line_summaries',
    '_view_procurement_receiving_order_summaries','_view_quotation_lines_customer',
    '_view_quotations_customer','_view_staff_advances_summaries',
    '_view_staff_attendance_summaries','_view_staff_members_operational',
    '_view_supplier_details','_view_supplier_summaries',
    'accept_event_quotation','accept_quotation','adjust_consumable_stock',
    'apply_package_to_event','apply_package_to_quotation','approve_procurement_order',
    'assign_event_staff','can_manage_commercial','can_read_cost','cancel_event',
    'cancel_procurement_order','cancel_quotation_draft','confirm_procurement_order',
    'consumable_stock_on_hand','consume_consumable_at_event','convert_quotation_to_event',
    'create_event','create_event_invoice','create_procurement_order',
    'create_quotation_draft','create_supplier','delete_quotation_line',
    'dispatch_event_equipment','equipment_availability','event_consumable_state',
    'event_consumable_summary','event_readiness','event_warehouse_summary',
    'get_host_payroll_summary','has_org_role','is_org_member',
    'issue_consumable_to_event','issue_event_quotation','issue_quotation',
    'persist_quotation_draft','receive_consumable_stock','receive_procurement_order',
    'reconcile_event_consumables','reconcile_event_warehouse','record_customer_payment',
    'record_host_payout','record_staff_advance','record_staff_attendance',
    'release_equipment_reservation','release_staff_assignment','reserve_event_equipment',
    'reset_quotation_lines','return_consumable_from_event','return_event_equipment',
    'save_consumable_stock_item','save_event_commercial_line','save_package',
    'save_quotation_line','send_procurement_order','set_supplier_status',
    'today_attendance_gaps','transition_event_status','update_procurement_order',
    'update_quotation_draft','update_supplier','void_customer_payment',
    'void_host_payout','void_invoice','void_staff_advance','void_staff_attendance',
    'warehouse_reservation_state','waste_consumable_at_event','waste_consumable_stock'
  ];
begin
  for r in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any(v_allowed)
  loop
    execute format('grant execute on function %s to anon', r.oid::regprocedure);
  end loop;
end
$grant_rpc$;

-- Keep the authorization helpers callable from RLS for anon requests; private
-- helper schema itself is never exposed through PostgREST.
grant execute on function public.is_org_member(uuid) to anon;
grant execute on function public.has_org_role(uuid, public.app_role[]) to anon;

comment on schema app_private is 'Internal helpers for temporary public demo access; not exposed to anon/authenticated.';
