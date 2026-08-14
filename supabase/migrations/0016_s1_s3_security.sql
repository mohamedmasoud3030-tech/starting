-- RLS, least-privilege grants, and non-sensitive operational projections.
alter table public.document_sequences enable row level security;
alter table public.events enable row level security;
alter table public.event_status_history enable row level security;
alter table public.event_commercial_lines enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_lines enable row level security;
alter table public.staff_members enable row level security;
alter table public.event_staff_assignments enable row level security;
alter table public.equipment_capacity enable row level security;
alter table public.event_equipment_reservations enable row level security;

create policy events_read on public.events for select using(public.is_org_member(organization_id));
create policy event_history_read on public.event_status_history for select using(public.is_org_member(organization_id));
create policy event_lines_cost_read on public.event_commercial_lines for select using(public.can_read_cost(organization_id));
create policy quotations_cost_read on public.quotations for select using(public.can_read_cost(organization_id));
create policy quotation_lines_cost_read on public.quotation_lines for select using(public.can_read_cost(organization_id));
create policy staff_members_cost_read on public.staff_members for select using(public.can_read_cost(organization_id));
create policy assignments_cost_read on public.event_staff_assignments for select using(public.can_read_cost(organization_id));
create policy equipment_capacity_read on public.equipment_capacity for select using(public.is_org_member(organization_id));
create policy equipment_reservations_read on public.event_equipment_reservations for select using(public.is_org_member(organization_id));
create policy staff_members_manage on public.staff_members for all using(public.has_org_role(organization_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role])) with check(public.has_org_role(organization_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role]));
create policy equipment_capacity_manage on public.equipment_capacity for all using(public.has_org_role(organization_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'WAREHOUSE'::public.app_role])) with check(public.has_org_role(organization_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'WAREHOUSE'::public.app_role]));

create view public.event_commercial_lines_operational as select id,organization_id,event_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,total_selling,is_custom,notes,sort_order,created_at,updated_at from public.event_commercial_lines where public.is_org_member(organization_id);
create view public.quotations_customer as select id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,customer_phone_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,location_snapshot,terms,notes,total_selling,issued_at,accepted_at from public.quotations where public.is_org_member(organization_id);
create view public.quotation_lines_customer as select ql.id,ql.organization_id,ql.quotation_id,ql.description,ql.item_type,ql.unit,ql.pricing_method,ql.quantity,ql.unit_selling_price,ql.total_selling,ql.is_custom,ql.sort_order from public.quotation_lines ql where public.is_org_member(ql.organization_id);
create view public.staff_members_operational as select id,organization_id,name,phone,whatsapp,staff_type,is_active,notes,created_at,updated_at from public.staff_members where public.is_org_member(organization_id);
create view public.event_staff_assignments_operational as select id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,status,notes,created_at from public.event_staff_assignments where public.is_org_member(organization_id);

revoke all on table public.document_sequences,public.events,public.event_status_history,public.event_commercial_lines,public.quotations,public.quotation_lines,public.staff_members,public.event_staff_assignments,public.equipment_capacity,public.event_equipment_reservations from anon;
revoke all on table public.event_commercial_lines_operational,public.quotations_customer,public.quotation_lines_customer,public.staff_members_operational,public.event_staff_assignments_operational from anon;
grant select on public.events,public.event_status_history,public.event_commercial_lines,public.quotations,public.quotation_lines,public.event_staff_assignments,public.event_equipment_reservations to authenticated;
grant select,insert,update on public.staff_members,public.equipment_capacity to authenticated;
grant select on public.event_commercial_lines_operational,public.quotations_customer,public.quotation_lines_customer,public.staff_members_operational,public.event_staff_assignments_operational to authenticated;
