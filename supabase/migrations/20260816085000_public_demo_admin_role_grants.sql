-- Move temporary public-demo privileges behind a dedicated inherited role.
-- `anon` remains the browser role, but receives the demo-only capabilities
-- through `public_demo_admin`. RLS still limits the effective scope to the
-- named Demo organization via app_private.is_public_demo_request().

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'public_demo_admin') then
    create role public_demo_admin nologin;
  end if;
end
$role$;

grant public_demo_admin to anon;

-- Move every SELECT grant that the prior migration copied from authenticated.
do $reads$
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
    execute format('revoke select on table public.%I from anon', r.table_name);
    execute format('grant select on table public.%I to public_demo_admin', r.table_name);
  end loop;
end
$reads$;

-- Direct CRUD surfaces used by the browser.
do $crud$
declare
  v_table text;
  v_tables constant text[] := array[
    'catalog_categories','catalog_items','customers','equipment_capacity',
    'event_commercial_lines','event_equipment_reservations',
    'event_staff_assignments','event_status_history','events','package_items',
    'packages','quotation_lines','quotations','staff_members'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('revoke insert, update, delete on table public.%I from anon', v_table);
    execute format('grant select, insert, update, delete on table public.%I to public_demo_admin', v_table);
  end loop;
end
$crud$;

-- Application RPC allowlist. Keep PUBLIC revoked; browser anon inherits through
-- the dedicated role instead of receiving direct routine grants.
do $rpc$
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
    execute format('revoke execute on function %s from anon', r.oid::regprocedure);
    execute format('grant execute on function %s to public_demo_admin', r.oid::regprocedure);
  end loop;
end
$rpc$;

comment on role public_demo_admin is
  'Temporary inherited browser capability role; effective data scope remains Demo-org-only through RLS.';
