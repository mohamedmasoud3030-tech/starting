-- S3 resource commands: overlap is exclusion-constrained; equipment uses row locks.
create function public.assign_event_staff(p_org_id uuid,p_event_id uuid,p_staff_member_id uuid,p_assignment_role public.staff_type,p_compensation_method public.compensation_method,p_rate numeric,p_expected_compensation numeric,p_notes text,p_idempotency_key uuid)
returns public.event_staff_assignments language plpgsql security definer set search_path='' as $$
declare v public.event_staff_assignments; v_event public.events;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.event_staff_assignments where organization_id=p_org_id and idempotency_key=p_idempotency_key; if found then return v; end if;
 select * into v_event from public.events where organization_id=p_org_id and id=p_event_id; if not found or v_event.status='CANCELLED' then raise exception 'EVENT_NOT_ASSIGNABLE'; end if;
 if not exists(select 1 from public.staff_members where organization_id=p_org_id and id=p_staff_member_id and is_active) then raise exception 'STAFF_NOT_ACTIVE_OR_CROSS_ORG' using errcode='23503'; end if;
 begin
  insert into public.event_staff_assignments(organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,notes,idempotency_key,created_by)
  values(p_org_id,p_event_id,p_staff_member_id,p_assignment_role,v_event.start_at,v_event.end_at,p_compensation_method,p_rate,p_expected_compensation,p_notes,p_idempotency_key,auth.uid()) returning * into v;
 exception when exclusion_violation then raise exception 'STAFF_CONFLICT' using errcode='23P01',hint='الموظف مرتبط بمناسبة أخرى في هذا الوقت'; end;
 perform public.record_audit(p_org_id,'STAFF_ASSIGNED','event_staff_assignment',v.id::text,jsonb_build_object('event_id',p_event_id,'staff_member_id',p_staff_member_id)); return v;
end$$;

create function public.release_staff_assignment(p_org_id uuid,p_assignment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 update public.event_staff_assignments set status='RELEASED' where organization_id=p_org_id and id=p_assignment_id and status='ACTIVE' returning event_id into v_event;
 if v_event is not null then perform public.record_audit(p_org_id,'STAFF_RELEASED','event_staff_assignment',p_assignment_id::text,jsonb_build_object('event_id',v_event)); end if;
end$$;

create function public.equipment_availability(p_org_id uuid,p_capacity_id uuid,p_from timestamptz,p_until timestamptz,p_requested int default 0)
returns table(total int,reserved bigint,available bigint,shortage bigint) language sql stable security definer set search_path='' as $$
 select c.total_quantity,coalesce(sum(r.quantity) filter(where r.status='ACTIVE' and tstzrange(r.reserved_from,r.reserved_until,'[)') && tstzrange(p_from,p_until,'[)')),0)::bigint,
 greatest(c.total_quantity-coalesce(sum(r.quantity) filter(where r.status='ACTIVE' and tstzrange(r.reserved_from,r.reserved_until,'[)') && tstzrange(p_from,p_until,'[)')),0),0)::bigint,
 greatest(p_requested-(c.total_quantity-coalesce(sum(r.quantity) filter(where r.status='ACTIVE' and tstzrange(r.reserved_from,r.reserved_until,'[)') && tstzrange(p_from,p_until,'[)')),0)),0)::bigint
 from public.equipment_capacity c left join public.event_equipment_reservations r on r.equipment_capacity_id=c.id
 where c.organization_id=p_org_id and c.id=p_capacity_id and c.is_active and public.is_org_member(c.organization_id) group by c.id
$$;

create function public.reserve_event_equipment(p_org_id uuid,p_event_id uuid,p_capacity_id uuid,p_quantity int,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_capacity public.equipment_capacity; v_reserved bigint; v_id uuid;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role,'WAREHOUSE'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select id into v_id from public.event_equipment_reservations where organization_id=p_org_id and idempotency_key=p_idempotency_key and event_id=p_event_id and equipment_capacity_id=p_capacity_id;
 if found then select * into v_event from public.events where id=p_event_id and organization_id=p_org_id; select * into v_capacity from public.equipment_capacity where id=p_capacity_id and organization_id=p_org_id; else
  select * into v_event from public.events where organization_id=p_org_id and id=p_event_id; if not found or v_event.status='CANCELLED' then raise exception 'EVENT_NOT_RESERVABLE'; end if;
  select * into v_capacity from public.equipment_capacity where organization_id=p_org_id and id=p_capacity_id and is_active for update; if not found then raise exception 'EQUIPMENT_NOT_ACTIVE_OR_CROSS_ORG' using errcode='23503'; end if;
  select coalesce(sum(quantity),0) into v_reserved from public.event_equipment_reservations where equipment_capacity_id=p_capacity_id and status='ACTIVE' and tstzrange(reserved_from,reserved_until,'[)') && tstzrange(v_event.start_at,v_event.end_at,'[)');
  if p_quantity<1 then raise exception 'INVALID_QUANTITY'; end if;
  if v_reserved+p_quantity>v_capacity.total_quantity then raise exception 'EQUIPMENT_SHORTAGE' using detail=jsonb_build_object('total',v_capacity.total_quantity,'reserved',v_reserved,'available',greatest(v_capacity.total_quantity-v_reserved,0),'shortage',v_reserved+p_quantity-v_capacity.total_quantity)::text; end if;
  insert into public.event_equipment_reservations(organization_id,event_id,equipment_capacity_id,quantity,reserved_from,reserved_until,idempotency_key,created_by) values(p_org_id,p_event_id,p_capacity_id,p_quantity,v_event.start_at,v_event.end_at,p_idempotency_key,auth.uid()) returning id into v_id;
  perform public.record_audit(p_org_id,'EQUIPMENT_RESERVED','event_equipment_reservation',v_id::text,jsonb_build_object('event_id',p_event_id,'quantity',p_quantity));
 end if;
 select coalesce(sum(quantity),0) into v_reserved from public.event_equipment_reservations where equipment_capacity_id=p_capacity_id and status='ACTIVE' and tstzrange(reserved_from,reserved_until,'[)') && tstzrange(v_event.start_at,v_event.end_at,'[)');
 return jsonb_build_object('reservation_id',v_id,'total',v_capacity.total_quantity,'reserved',v_reserved,'available',greatest(v_capacity.total_quantity-v_reserved,0),'shortage',0);
end$$;

create function public.release_equipment_reservation(p_org_id uuid,p_reservation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role,'WAREHOUSE'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 update public.event_equipment_reservations set status='RELEASED' where organization_id=p_org_id and id=p_reservation_id and status='ACTIVE' returning event_id into v_event;
 if v_event is not null then perform public.record_audit(p_org_id,'EQUIPMENT_RELEASED','event_equipment_reservation',p_reservation_id::text,jsonb_build_object('event_id',v_event)); end if;
end$$;

create function public.cancel_event(p_org_id uuid,p_event_id uuid,p_reason text,p_idempotency_key uuid)
returns public.events language plpgsql security definer set search_path='' as $$
declare v public.events; v_staff int; v_equipment int;
begin
 if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;
 select * into v from public.events where organization_id=p_org_id and id=p_event_id for update; if not found then raise exception 'EVENT_NOT_FOUND'; end if; if v.status='CANCELLED' then return v; end if;
 if v.status not in ('DRAFT','QUOTED','CONFIRMED','PREPARING') then raise exception 'EVENT_CANNOT_BE_CANCELLED'; end if;
 update public.event_staff_assignments set status='CANCELLED' where event_id=p_event_id and status='ACTIVE'; get diagnostics v_staff=row_count;
 update public.event_equipment_reservations set status='CANCELLED' where event_id=p_event_id and status='ACTIVE'; get diagnostics v_equipment=row_count;
 insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,p_event_id,v.status,'CANCELLED',auth.uid(),trim(p_reason));
 update public.events set status='CANCELLED',cancellation_reason=trim(p_reason),updated_by=auth.uid() where id=p_event_id returning * into v;
 perform public.record_audit(p_org_id,'EVENT_CANCELLED','event',p_event_id::text,jsonb_build_object('reason',trim(p_reason),'staff_released',v_staff,'equipment_released',v_equipment,'idempotency_key',p_idempotency_key)); return v;
end$$;

create function public.event_readiness(p_org_id uuid,p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_staff_needed int; v_staff_assigned int; v_eq_short int; v_status text;
begin
 if not public.is_org_member(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select coalesce(ceil(sum(quantity)) filter(where item_type='STAFF'),0)::int into v_staff_needed from public.event_commercial_lines where organization_id=p_org_id and event_id=p_event_id;
 select count(*) into v_staff_assigned from public.event_staff_assignments where event_id=p_event_id and status='ACTIVE';
 select coalesce(sum(greatest(ceil(l.quantity)::int-coalesce(r.qty,0),0)),0)::int into v_eq_short from public.event_commercial_lines l left join (select ec.catalog_item_id,sum(er.quantity)::int qty from public.event_equipment_reservations er join public.equipment_capacity ec on ec.id=er.equipment_capacity_id where er.event_id=p_event_id and er.status='ACTIVE' group by ec.catalog_item_id) r on r.catalog_item_id=l.source_catalog_item_id where l.event_id=p_event_id and l.item_type='REUSABLE_EQUIPMENT';
 v_status:=case when greatest(v_staff_needed-v_staff_assigned,0)>0 and v_eq_short>0 then 'MULTIPLE_ISSUES' when greatest(v_staff_needed-v_staff_assigned,0)>0 then 'STAFF_MISSING' when v_eq_short>0 then 'EQUIPMENT_SHORTAGE' else 'READY' end;
 return jsonb_build_object('status',v_status,'staff_missing',greatest(v_staff_needed-v_staff_assigned,0),'equipment_shortage',v_eq_short);
end$$;

revoke all on function public.assign_event_staff(uuid,uuid,uuid,public.staff_type,public.compensation_method,numeric,numeric,text,uuid),public.release_staff_assignment(uuid,uuid),public.equipment_availability(uuid,uuid,timestamptz,timestamptz,int),public.reserve_event_equipment(uuid,uuid,uuid,int,uuid),public.release_equipment_reservation(uuid,uuid),public.cancel_event(uuid,uuid,text,uuid),public.event_readiness(uuid,uuid) from public,anon;
grant execute on function public.assign_event_staff(uuid,uuid,uuid,public.staff_type,public.compensation_method,numeric,numeric,text,uuid),public.release_staff_assignment(uuid,uuid),public.equipment_availability(uuid,uuid,timestamptz,timestamptz,int),public.reserve_event_equipment(uuid,uuid,uuid,int,uuid),public.release_equipment_reservation(uuid,uuid),public.cancel_event(uuid,uuid,text,uuid),public.event_readiness(uuid,uuid) to authenticated;
