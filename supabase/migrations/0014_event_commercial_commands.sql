-- S1/S2 server-authoritative commands.
create function public.next_document_number(p_org uuid,p_kind text,p_prefix text)
returns text language plpgsql security definer set search_path='' as $$
declare v_year int := extract(year from timezone('Asia/Muscat',now())); v_num bigint;
begin
 insert into public.document_sequences(organization_id,kind,year,last_value) values(p_org,p_kind,v_year,1)
 on conflict(organization_id,kind,year) do update set last_value=public.document_sequences.last_value+1 returning last_value into v_num;
 return p_prefix||'-'||v_year::text||'-'||lpad(v_num::text,5,'0');
end$$;
revoke all on function public.next_document_number(uuid,text,text) from public,anon,authenticated;

create function public.commercial_total(p_method public.pricing_method,p_unit numeric,p_quantity numeric,p_guests int)
returns numeric language sql immutable set search_path='' as $$
 select round(case when p_method='FIXED' then p_unit when p_method='PER_GUEST' then p_unit*p_quantity*p_guests else p_unit*p_quantity end,3)
$$;
revoke all on function public.commercial_total(public.pricing_method,numeric,numeric,int) from public,anon,authenticated;

create function public.create_event(p_org_id uuid,p_customer_id uuid,p_title text,p_event_type text,p_start_at timestamptz,p_end_at timestamptz,p_guest_count int,p_venue_name text,p_location_details text default null,p_contact_name text default null,p_contact_phone text default null,p_notes text default null,p_idempotency_key uuid default gen_random_uuid())
returns public.events language plpgsql security definer set search_path='' as $$
declare v public.events; v_number text;
begin
 if auth.uid() is null or not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.events where organization_id=p_org_id and idempotency_key=p_idempotency_key; if found then return v; end if;
 if p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
 if p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
 if not exists(select 1 from public.customers where organization_id=p_org_id and id=p_customer_id and is_active) then raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503'; end if;
 v_number:=public.next_document_number(p_org_id,'EVENT','EV');
 insert into public.events(organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,location_details,contact_name,contact_phone,notes,idempotency_key,created_by,updated_by)
 values(p_org_id,p_customer_id,v_number,trim(p_title),coalesce(nullif(trim(p_event_type),''),'OTHER'),p_start_at,p_end_at,p_guest_count,trim(p_venue_name),p_location_details,p_contact_name,p_contact_phone,p_notes,p_idempotency_key,auth.uid(),auth.uid()) returning * into v;
 insert into public.event_status_history(organization_id,event_id,to_status,actor_id,reason) values(p_org_id,v.id,'DRAFT',auth.uid(),'EVENT_CREATED');
 perform public.record_audit(p_org_id,'EVENT_CREATED','event',v.id::text,jsonb_build_object('event_number',v.event_number)); return v;
end$$;

create function public.transition_event_status(p_org_id uuid,p_event_id uuid,p_to public.event_status,p_reason text default null)
returns public.events language plpgsql security definer set search_path='' as $$
declare v public.events; v_allowed boolean; v_from public.event_status;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.events where organization_id=p_org_id and id=p_event_id for update; if not found then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
 if p_to='CANCELLED' then raise exception 'USE_CANCEL_EVENT'; end if;
 v_from:=v.status;
 v_allowed := (v.status,p_to) in (('CONFIRMED','PREPARING'),('PREPARING','DISPATCHED'),('DISPATCHED','IN_PROGRESS'),('IN_PROGRESS','RETURNING'),('RETURNING','CLOSED'));
 if not v_allowed then raise exception 'INVALID_EVENT_TRANSITION: % -> %',v.status,p_to; end if;
 update public.events set status=p_to,updated_by=auth.uid() where id=v.id returning * into v;
 insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.id,v_from,p_to,auth.uid(),p_reason);
 perform public.record_audit(p_org_id,'EVENT_STATUS_CHANGED','event',v.id::text,jsonb_build_object('to',p_to,'reason',p_reason)); return v;
end$$;

create function public.apply_package_to_event(p_org_id uuid,p_event_id uuid,p_package_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_count int;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_event from public.events where organization_id=p_org_id and id=p_event_id for update;
 if not found then raise exception 'EVENT_NOT_FOUND'; end if; if v_event.accepted_quotation_id is not null then raise exception 'EVENT_PRICING_LOCKED'; end if;
 if not exists(select 1 from public.packages where organization_id=p_org_id and id=p_package_id and status='ACTIVE') then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
 insert into public.event_commercial_lines(organization_id,event_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
 select p_org_id,p_event_id,c.id,p_package_id,c.name,c.item_type,c.unit,c.pricing_method,pi.quantity,c.selling_price,c.cost_price,
 public.commercial_total(c.pricing_method,c.selling_price,pi.quantity,v_event.guest_count),public.commercial_total(c.pricing_method,c.cost_price,pi.quantity,v_event.guest_count),false,pi.sort_order
 from public.package_items pi join public.catalog_items c on c.id=pi.catalog_item_id and c.organization_id=pi.organization_id where pi.organization_id=p_org_id and pi.package_id=p_package_id;
 get diagnostics v_count=row_count; perform public.record_audit(p_org_id,'PACKAGE_APPLIED','event',p_event_id::text,jsonb_build_object('package_id',p_package_id,'lines',v_count)); return v_count;
end$$;

create function public.save_event_commercial_line(p_org_id uuid,p_event_id uuid,p_line_id uuid,p_description text,p_item_type public.catalog_item_type,p_unit text,p_pricing_method public.pricing_method,p_quantity numeric,p_unit_selling_price numeric,p_expected_unit_cost numeric,p_notes text default null)
returns public.event_commercial_lines language plpgsql security definer set search_path='' as $$
declare v public.event_commercial_lines; v_event public.events;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_event from public.events where organization_id=p_org_id and id=p_event_id for update; if v_event.accepted_quotation_id is not null then raise exception 'EVENT_PRICING_LOCKED'; end if;
 if p_quantity<=0 or p_unit_selling_price<0 or p_expected_unit_cost<0 then raise exception 'INVALID_COMMERCIAL_VALUE'; end if;
 if p_line_id is null then
  insert into public.event_commercial_lines(organization_id,event_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order)
  values(p_org_id,p_event_id,trim(p_description),p_item_type,p_unit,p_pricing_method,p_quantity,p_unit_selling_price,p_expected_unit_cost,public.commercial_total(p_pricing_method,p_unit_selling_price,p_quantity,v_event.guest_count),public.commercial_total(p_pricing_method,p_expected_unit_cost,p_quantity,v_event.guest_count),true,p_notes,coalesce((select max(sort_order)+1 from public.event_commercial_lines where event_id=p_event_id),0)) returning * into v;
 else
  update public.event_commercial_lines set description=trim(p_description),item_type=p_item_type,unit=p_unit,pricing_method=p_pricing_method,quantity=p_quantity,unit_selling_price=p_unit_selling_price,expected_unit_cost=p_expected_unit_cost,total_selling=public.commercial_total(p_pricing_method,p_unit_selling_price,p_quantity,v_event.guest_count),total_expected_cost=public.commercial_total(p_pricing_method,p_expected_unit_cost,p_quantity,v_event.guest_count),notes=p_notes where id=p_line_id and event_id=p_event_id and organization_id=p_org_id returning * into v;
 end if; if v.id is null then raise exception 'LINE_NOT_FOUND'; end if; return v;
end$$;

create function public.issue_event_quotation(p_org_id uuid,p_event_id uuid,p_terms text,p_notes text,p_idempotency_key uuid)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_customer public.customers; v_quote public.quotations; v_revision int; v_num text; v_sell numeric; v_cost numeric;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quotations where organization_id=p_org_id and idempotency_key=p_idempotency_key; if found then return v_quote; end if;
 select * into v_event from public.events where organization_id=p_org_id and id=p_event_id for update; if not found then raise exception 'EVENT_NOT_FOUND'; end if;
 if v_event.status not in ('DRAFT','QUOTED') or v_event.accepted_quotation_id is not null then raise exception 'QUOTE_NOT_ALLOWED'; end if;
 if not exists(select 1 from public.event_commercial_lines where event_id=p_event_id) then raise exception 'EMPTY_QUOTATION'; end if;
 select * into v_customer from public.customers where id=v_event.customer_id and organization_id=p_org_id;
 select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_sell,v_cost from public.event_commercial_lines where event_id=p_event_id;
 select coalesce(max(revision),0)+1 into v_revision from public.quotations where event_id=p_event_id;
 v_num:=public.next_document_number(p_org_id,'QUOTATION','QT');
 insert into public.quotations(organization_id,event_id,quotation_number,revision,customer_name_snapshot,customer_phone_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,location_snapshot,terms,notes,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by)
 values(p_org_id,p_event_id,v_num,v_revision,v_customer.name,v_customer.phone,v_event.event_number,v_event.title,v_event.guest_count,v_event.start_at,v_event.end_at,v_event.venue_name,v_event.location_details,p_terms,p_notes,v_sell,v_cost,v_sell-v_cost,p_idempotency_key,auth.uid()) returning * into v_quote;
 insert into public.quotation_lines(organization_id,quotation_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
 select organization_id,v_quote.id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order from public.event_commercial_lines where event_id=p_event_id;
 if v_event.status='DRAFT' then update public.events set status='QUOTED',updated_by=auth.uid() where id=p_event_id; insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,p_event_id,'DRAFT','QUOTED',auth.uid(),'QUOTATION_ISSUED'); end if;
 perform public.record_audit(p_org_id,'QUOTATION_ISSUED','quotation',v_quote.id::text,jsonb_build_object('event_id',p_event_id,'revision',v_revision,'total',v_sell)); return v_quote;
end$$;

create function public.accept_event_quotation(p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_event public.events;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update; if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
 select * into v_event from public.events where id=v.event_id and organization_id=p_org_id for update;
 if v.status='ACCEPTED' and v_event.accepted_quotation_id=v.id then return v; end if;
 if v.status<>'ISSUED' or v_event.status<>'QUOTED' or v_event.accepted_quotation_id is not null then raise exception 'QUOTATION_ACCEPT_NOT_ALLOWED'; end if;
 update public.quotations set status='SUPERSEDED' where event_id=v.event_id and id<>v.id and status='ISSUED';
 update public.quotations set status='ACCEPTED',accepted_by=auth.uid(),accepted_at=now() where id=v.id returning * into v;
 update public.events set accepted_quotation_id=v.id,status='CONFIRMED',updated_by=auth.uid() where id=v.event_id;
 insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.event_id,'QUOTED','CONFIRMED',auth.uid(),'QUOTATION_ACCEPTED');
 perform public.record_audit(p_org_id,'QUOTATION_ACCEPTED','quotation',v.id::text,jsonb_build_object('event_id',v.event_id,'idempotency_key',p_idempotency_key)); return v;
end$$;

-- Issued commercial snapshots cannot be altered, even by table owners accidentally.
create function public.prevent_quotation_line_mutation() returns trigger language plpgsql set search_path='' as $$begin raise exception 'QUOTATION_IMMUTABLE'; end$$;
create trigger quotation_lines_immutable before update or delete on public.quotation_lines for each row execute function public.prevent_quotation_line_mutation();
create function public.protect_quotation_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','accepted_by','accepted_at']) is distinct from (to_jsonb(old)-array['status','accepted_by','accepted_at']) then raise exception 'QUOTATION_IMMUTABLE'; end if;
 if old.status<>'ISSUED' then raise exception 'QUOTATION_IMMUTABLE'; end if;
 return new;
end$$;
create trigger quotation_snapshot_immutable before update on public.quotations for each row execute function public.protect_quotation_snapshot();

revoke all on function public.create_event(uuid,uuid,text,text,timestamptz,timestamptz,int,text,text,text,text,text,uuid) from public,anon;
revoke all on function public.transition_event_status(uuid,uuid,public.event_status,text) from public,anon;
revoke all on function public.apply_package_to_event(uuid,uuid,uuid) from public,anon;
revoke all on function public.save_event_commercial_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,numeric,text) from public,anon;
revoke all on function public.issue_event_quotation(uuid,uuid,text,text,uuid) from public,anon;
revoke all on function public.accept_event_quotation(uuid,uuid,uuid) from public,anon;
grant execute on function public.create_event(uuid,uuid,text,text,timestamptz,timestamptz,int,text,text,text,text,text,uuid),public.transition_event_status(uuid,uuid,public.event_status,text),public.apply_package_to_event(uuid,uuid,uuid),public.save_event_commercial_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,numeric,text),public.issue_event_quotation(uuid,uuid,text,text,uuid),public.accept_event_quotation(uuid,uuid,uuid) to authenticated;
