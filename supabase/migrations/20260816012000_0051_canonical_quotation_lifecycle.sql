-- ============================================================================
-- 0051 / R11 — One canonical quotation lifecycle
--
-- Retires the physical Quick Quote aggregate after transactionally migrating
-- every row into quotations/quotation_lines. Drafts and issued commercial
-- snapshots now share one identity; PostgreSQL remains the money authority.
-- ============================================================================

-- The R10 view hardening wrapped these projections in fixed-return helpers.
-- Remove them before rebuilding the enum/canonical shape.
drop view if exists public.quotation_lines_customer;
drop function if exists public._view_quotation_lines_customer();
drop view if exists public.quotations_customer;
drop function if exists public._view_quotations_customer();

-- R10's one replay register remains canonical; quotations become a namespace.
alter table public.command_idempotency
  drop constraint command_idempotency_command_scope_check;
alter table public.command_idempotency
  add constraint command_idempotency_command_scope_check
  check (command_scope in ('PROCUREMENT','PAYMENTS','STAFF','QUOTATIONS'));

create or replace function public.begin_command(
  p_org_id uuid, p_command_scope text, p_idempotency_key uuid, p_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.command_idempotency;
begin
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  if p_command_scope not in ('PROCUREMENT','PAYMENTS','STAFF','QUOTATIONS') then
    raise exception 'INVALID_COMMAND_SCOPE' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text,0)
  );
  select * into v_existing from public.command_idempotency i
   where i.organization_id=p_org_id and i.command_scope=p_command_scope
     and i.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode='22023';
    end if;
    return v_existing.response_payload;
  end if;
  return null;
end$$;

create or replace function public.finish_command(
  p_org_id uuid, p_command_scope text, p_idempotency_key uuid,
  p_command_name text, p_fingerprint text, p_result_entity text,
  p_result_id uuid, p_response jsonb
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_command_scope not in ('PROCUREMENT','PAYMENTS','STAFF','QUOTATIONS') then
    raise exception 'INVALID_COMMAND_SCOPE' using errcode='22023';
  end if;
  insert into public.command_idempotency(
    organization_id,command_scope,idempotency_key,command_name,
    request_fingerprint,result_entity,result_id,response_payload,actor_id
  ) values (
    p_org_id,p_command_scope,p_idempotency_key,p_command_name,
    p_fingerprint,p_result_entity,p_result_id,p_response,auth.uid()
  );
end$$;

create or replace function public.quotation_fingerprint(p_payload jsonb)
returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8')),'hex')
$$;
revoke all on function public.quotation_fingerprint(jsonb) from public,anon,authenticated;

-- Draft-capable canonical aggregate.
alter table public.quotations alter column quotation_number drop not null;
alter table public.quotations alter column issued_by drop not null;
alter table public.quotations alter column issued_at drop not null;
alter table public.quotations alter column issued_at drop default;
alter table public.quotations alter column total_selling set default 0;
alter table public.quotations alter column total_expected_cost set default 0;
alter table public.quotations alter column total_expected_profit set default 0;

alter table public.quotations
  add column prospect_whatsapp text,
  add column prospect_company text,
  add column event_type_snapshot text not null default 'OTHER',
  add column cancellation_reason text,
  add column created_by uuid references auth.users(id),
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

update public.quotations set created_by=issued_by where created_by is null;
create trigger quotations_set_updated_at before update on public.quotations
for each row execute function public.set_updated_at();

alter table public.quotation_lines
  add column source_catalog_item_id uuid,
  add column source_package_id uuid,
  add column notes text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint quotation_lines_catalog_org_fk foreign key (organization_id,source_catalog_item_id)
    references public.catalog_items(organization_id,id) on delete restrict,
  add constraint quotation_lines_package_org_fk foreign key (organization_id,source_package_id)
    references public.packages(organization_id,id) on delete restrict;
create trigger quotation_lines_set_updated_at before update on public.quotation_lines
for each row execute function public.set_updated_at();

-- Temporarily disable immutable guards only for the data consolidation below.
alter table public.quotations disable trigger quotation_snapshot_immutable;
alter table public.quotation_lines disable trigger quotation_lines_immutable;

create temporary table _r11_quote_map(
  quick_quote_id uuid primary key,
  quotation_id uuid not null unique,
  was_linked boolean not null
) on commit drop;

insert into _r11_quote_map(quick_quote_id,quotation_id,was_linked)
select id,quotation_id,true from public.quick_quotes where quotation_id is not null;

-- Unissued workspaces retain their UUID, audit trace, create key and timestamps.
insert into public.quotations(
  id,organization_id,event_id,quotation_number,revision,status,customer_id,
  customer_name_snapshot,customer_phone_snapshot,prospect_whatsapp,prospect_company,
  event_number_snapshot,event_title_snapshot,event_type_snapshot,guest_count_snapshot,
  start_at_snapshot,end_at_snapshot,venue_snapshot,location_snapshot,terms,notes,
  total_selling,total_expected_cost,total_expected_profit,idempotency_key,
  issued_by,issued_at,created_by,created_at,updated_at,cancellation_reason
)
select
  q.id,q.organization_id,null,null,1,
  case q.status when 'DISCARDED' then 'CANCELLED'::public.quotation_status
                else 'DRAFT'::public.quotation_status end,
  null,q.prospect_name,q.prospect_phone,q.prospect_whatsapp,q.prospect_company,
  null,coalesce(q.event_title,q.prospect_name),coalesce(q.event_type,'OTHER'),q.guest_count,
  q.start_at,q.end_at,q.venue_name,null,null,q.notes,
  coalesce((select sum(l.total_selling) from public.quick_quote_lines l where l.quick_quote_id=q.id),0),
  0,0,q.idempotency_key,null,null,q.created_by,q.created_at,q.updated_at,
  case when q.status='DISCARDED' then q.notes else null end
from public.quick_quotes q
where q.quotation_id is null;

insert into _r11_quote_map(quick_quote_id,quotation_id,was_linked)
select id,id,false from public.quick_quotes where quotation_id is null;

-- Enrich already-issued canonical rows and collapse the mirrored lifecycle.
update public.quotations target set
  customer_name_snapshot=q.prospect_name,
  customer_phone_snapshot=q.prospect_phone,
  prospect_whatsapp=q.prospect_whatsapp,
  prospect_company=q.prospect_company,
  event_title_snapshot=coalesce(q.event_title,target.event_title_snapshot),
  event_type_snapshot=coalesce(q.event_type,'OTHER'),
  guest_count_snapshot=q.guest_count,
  start_at_snapshot=q.start_at,
  end_at_snapshot=q.end_at,
  venue_snapshot=q.venue_name,
  created_by=q.created_by,
  created_at=q.created_at,
  updated_at=greatest(target.updated_at,q.updated_at),
  status=case q.status
    when 'CONVERTED' then 'CONVERTED'::public.quotation_status
    when 'ACCEPTED' then 'ACCEPTED'::public.quotation_status
    else target.status end
from public.quick_quotes q
where q.quotation_id=target.id;

-- Only unissued workspaces need line copying; issued lines were copied by 0017.
insert into public.quotation_lines(
  id,organization_id,quotation_id,description,item_type,unit,pricing_method,
  quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,
  is_custom,sort_order,created_at,updated_at
)
select l.id,l.organization_id,m.quotation_id,l.description,l.item_type,l.unit,
       l.pricing_method,l.quantity,l.unit_selling_price,0,l.total_selling,0,
       l.is_custom,l.sort_order,l.created_at,l.updated_at
from public.quick_quote_lines l
join _r11_quote_map m on m.quick_quote_id=l.quick_quote_id
where not m.was_linked;

-- Abort before any DROP if a legacy aggregate/line failed to map.
do $$
declare v_quick bigint; v_mapped bigint; v_legacy_lines bigint; v_copied_lines bigint;
begin
  select count(*) into v_quick from public.quick_quotes;
  select count(*) into v_mapped from _r11_quote_map;
  if v_quick<>v_mapped then raise exception 'R11_QUOTATION_MIGRATION_COUNT_MISMATCH'; end if;
  select count(*) into v_legacy_lines from public.quick_quote_lines l
    join _r11_quote_map m on m.quick_quote_id=l.quick_quote_id where not m.was_linked;
  select count(*) into v_copied_lines from public.quotation_lines l
    join _r11_quote_map m on m.quotation_id=l.quotation_id where not m.was_linked;
  if v_legacy_lines<>v_copied_lines then raise exception 'R11_QUOTATION_LINE_MIGRATION_COUNT_MISMATCH'; end if;
end$$;

-- Replace guards: draft writes are allowed only through RPC grants; every
-- commercial fact becomes immutable at issue time.
create or replace function public.protect_quotation_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='DRAFT' then
    if new.status in ('DRAFT','ISSUED','CANCELLED') then return new; end if;
    raise exception 'QUOTATION_TRANSITION_NOT_ALLOWED';
  end if;
  if old.status='ISSUED' and new.status='ACCEPTED' then
    if (to_jsonb(new)-array['status','accepted_by','accepted_at']) is distinct from
       (to_jsonb(old)-array['status','accepted_by','accepted_at'])
       or new.accepted_by is null or new.accepted_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;
  if old.status='ISSUED' and new.status='SUPERSEDED' then
    if (to_jsonb(new)-array['status']) is distinct from (to_jsonb(old)-array['status']) then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;
  if old.status='ACCEPTED' and new.status='CONVERTED' then
    if (to_jsonb(new)-array['status','customer_id','converted_event_id','converted_at']) is distinct from
       (to_jsonb(old)-array['status','customer_id','converted_event_id','converted_at'])
       or old.event_id is not null or new.customer_id is null
       or new.converted_event_id is null or new.converted_at is null then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;
  raise exception 'QUOTATION_IMMUTABLE';
end$$;

create or replace function public.prevent_quotation_line_mutation()
returns trigger language plpgsql set search_path='' as $$
declare v_status public.quotation_status;
begin
  select q.status into v_status from public.quotations q
   where q.id=old.quotation_id and q.organization_id=old.organization_id;
  if v_status='DRAFT' then
    if TG_OP='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'QUOTATION_IMMUTABLE';
end$$;

alter table public.quotations enable trigger quotation_snapshot_immutable;
alter table public.quotation_lines enable trigger quotation_lines_immutable;

-- Canonical draft commands ----------------------------------------------------
create function public.create_quotation_draft(
  p_org_id uuid,p_prospect_name text,p_customer_id uuid default null,
  p_prospect_phone text default null,p_prospect_whatsapp text default null,
  p_prospect_company text default null,p_event_title text default null,
  p_event_type text default null,p_start_at timestamptz default null,
  p_end_at timestamptz default null,p_guest_count int default null,
  p_venue_name text default null,p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_customer public.customers; v_payload jsonb; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if length(trim(coalesce(p_prospect_name,'')))=0 then raise exception 'PROSPECT_NAME_REQUIRED'; end if;
  if p_guest_count is not null and p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
  if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
  if p_customer_id is not null then
    select * into v_customer from public.customers c where c.organization_id=p_org_id and c.id=p_customer_id and c.is_active;
    if not found then raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503'; end if;
  end if;
  v_payload=jsonb_build_object('customer_id',p_customer_id,'name',trim(p_prospect_name),'phone',nullif(trim(coalesce(p_prospect_phone,'')),''),'whatsapp',nullif(trim(coalesce(p_prospect_whatsapp,'')),''),'company',nullif(trim(coalesce(p_prospect_company,'')),''),'event_title',nullif(trim(coalesce(p_event_title,'')),''),'event_type',coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),'start_at',p_start_at,'end_at',p_end_at,'guest_count',p_guest_count,'venue',nullif(trim(coalesce(p_venue_name,'')),''),'notes',p_notes);
  v_fp=public.quotation_fingerprint(v_payload);
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  insert into public.quotations(
    organization_id,event_id,quotation_number,revision,status,customer_id,
    customer_name_snapshot,customer_phone_snapshot,prospect_whatsapp,prospect_company,
    event_number_snapshot,event_title_snapshot,event_type_snapshot,guest_count_snapshot,
    start_at_snapshot,end_at_snapshot,venue_snapshot,notes,idempotency_key,created_by
  ) values (
    p_org_id,null,null,1,'DRAFT',p_customer_id,trim(p_prospect_name),
    nullif(trim(coalesce(p_prospect_phone,'')),''),nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
    nullif(trim(coalesce(p_prospect_company,'')),''),null,
    coalesce(nullif(trim(coalesce(p_event_title,'')),''),trim(p_prospect_name)),
    coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),p_guest_count,p_start_at,p_end_at,
    nullif(trim(coalesce(p_venue_name,'')),''),p_notes,p_idempotency_key,auth.uid()
  ) returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'CREATE_QUOTATION_DRAFT',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_DRAFT_CREATED','quotation',v.id::text,'{}'::jsonb);
  return v;
end$$;

create function public.update_quotation_draft(
  p_org_id uuid,p_quotation_id uuid,p_prospect_name text,p_customer_id uuid default null,
  p_prospect_phone text default null,p_prospect_whatsapp text default null,
  p_prospect_company text default null,p_event_title text default null,
  p_event_type text default null,p_start_at timestamptz default null,
  p_end_at timestamptz default null,p_guest_count int default null,
  p_venue_name text default null,p_notes text default null
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if length(trim(coalesce(p_prospect_name,'')))=0 then raise exception 'PROSPECT_NAME_REQUIRED'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers c where c.organization_id=p_org_id and c.id=p_customer_id and c.is_active) then raise exception 'CUSTOMER_NOT_IN_ORG' using errcode='23503'; end if;
  if p_guest_count is not null and p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
  if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
  update public.quotations set customer_id=p_customer_id,customer_name_snapshot=trim(p_prospect_name),
    customer_phone_snapshot=nullif(trim(coalesce(p_prospect_phone,'')),''),prospect_whatsapp=nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
    prospect_company=nullif(trim(coalesce(p_prospect_company,'')),''),event_title_snapshot=coalesce(nullif(trim(coalesce(p_event_title,'')),''),trim(p_prospect_name)),
    event_type_snapshot=coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),start_at_snapshot=p_start_at,end_at_snapshot=p_end_at,
    guest_count_snapshot=p_guest_count,venue_snapshot=nullif(trim(coalesce(p_venue_name,'')),''),notes=p_notes
  where id=p_quotation_id returning * into v;
  -- Guest changes can affect PER_GUEST lines; recalculate every draft line and aggregate.
  update public.quotation_lines l set total_selling=public.commercial_total(l.pricing_method,l.unit_selling_price,l.quantity,p_guest_count),
    total_expected_cost=public.commercial_total(l.pricing_method,l.expected_unit_cost,l.quantity,p_guest_count)
   where l.quotation_id=p_quotation_id and (l.pricing_method<>'PER_GUEST' or p_guest_count is not null);
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v.total_selling,v.total_expected_cost from public.quotation_lines where quotation_id=p_quotation_id;
  update public.quotations set total_selling=v.total_selling,total_expected_cost=v.total_expected_cost,total_expected_profit=v.total_selling-v.total_expected_cost where id=p_quotation_id returning * into v;
  return v;
end$$;

create function public.save_quotation_line(
  p_org_id uuid,p_quotation_id uuid,p_line_id uuid,p_description text,
  p_item_type public.catalog_item_type,p_unit text,p_pricing_method public.pricing_method,
  p_quantity numeric,p_unit_selling_price numeric,p_expected_unit_cost numeric default 0,
  p_is_custom boolean default true,p_source_catalog_item_id uuid default null,p_source_package_id uuid default null,p_notes text default null
) returns public.quotation_lines language plpgsql security definer set search_path='' as $$
declare v_quote public.quotations; v public.quotation_lines; v_sell numeric; v_cost numeric;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v_quote from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_quote.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if length(trim(coalesce(p_description,'')))=0 or length(trim(coalesce(p_unit,'')))=0 then raise exception 'INVALID_LINE'; end if;
  if p_quantity<=0 or p_unit_selling_price<0 or p_expected_unit_cost<0 then raise exception 'INVALID_LINE'; end if;
  if p_pricing_method='PER_GUEST' and v_quote.guest_count_snapshot is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  if p_source_catalog_item_id is not null and not exists(select 1 from public.catalog_items c where c.organization_id=p_org_id and c.id=p_source_catalog_item_id) then raise exception 'CATALOG_ITEM_NOT_IN_ORG' using errcode='23503'; end if;
  if p_source_package_id is not null and not exists(select 1 from public.packages p where p.organization_id=p_org_id and p.id=p_source_package_id) then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
  v_sell=public.commercial_total(p_pricing_method,p_unit_selling_price,p_quantity,v_quote.guest_count_snapshot);
  v_cost=public.commercial_total(p_pricing_method,p_expected_unit_cost,p_quantity,v_quote.guest_count_snapshot);
  if p_line_id is null then
    insert into public.quotation_lines(organization_id,quotation_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order)
    values(p_org_id,p_quotation_id,p_source_catalog_item_id,p_source_package_id,trim(p_description),p_item_type,trim(p_unit),p_pricing_method,p_quantity,p_unit_selling_price,p_expected_unit_cost,v_sell,v_cost,p_is_custom,p_notes,coalesce((select max(sort_order)+1 from public.quotation_lines where quotation_id=p_quotation_id),0)) returning * into v;
  else
    update public.quotation_lines set source_catalog_item_id=p_source_catalog_item_id,source_package_id=p_source_package_id,description=trim(p_description),item_type=p_item_type,unit=trim(p_unit),pricing_method=p_pricing_method,quantity=p_quantity,unit_selling_price=p_unit_selling_price,expected_unit_cost=p_expected_unit_cost,total_selling=v_sell,total_expected_cost=v_cost,is_custom=p_is_custom,notes=p_notes
     where id=p_line_id and quotation_id=p_quotation_id and organization_id=p_org_id returning * into v;
    if not found then raise exception 'LINE_NOT_FOUND'; end if;
  end if;
  update public.quotations q set total_selling=x.sell,total_expected_cost=x.cost,total_expected_profit=x.sell-x.cost
   from (select coalesce(sum(total_selling),0) sell,coalesce(sum(total_expected_cost),0) cost from public.quotation_lines where quotation_id=p_quotation_id) x where q.id=p_quotation_id;
  return v;
end$$;

create function public.delete_quotation_line(p_org_id uuid,p_quotation_id uuid,p_line_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.quotations;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  delete from public.quotation_lines where organization_id=p_org_id and quotation_id=p_quotation_id and id=p_line_id;
  if not found then raise exception 'LINE_NOT_FOUND'; end if;
  update public.quotations q set total_selling=x.sell,total_expected_cost=x.cost,total_expected_profit=x.sell-x.cost
   from (select coalesce(sum(total_selling),0) sell,coalesce(sum(total_expected_cost),0) cost from public.quotation_lines where quotation_id=p_quotation_id) x where q.id=p_quotation_id;
end$$;

create function public.reset_quotation_lines(p_org_id uuid,p_quotation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.quotations;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  delete from public.quotation_lines where organization_id=p_org_id and quotation_id=p_quotation_id;
  update public.quotations set total_selling=0,total_expected_cost=0,total_expected_profit=0 where id=p_quotation_id;
end$$;

create function public.apply_package_to_quotation(p_org_id uuid,p_quotation_id uuid,p_package_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_count int;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  if not exists(select 1 from public.packages p where p.organization_id=p_org_id and p.id=p_package_id and p.status='ACTIVE') then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
  if exists(select 1 from public.quotation_lines where organization_id=p_org_id and quotation_id=p_quotation_id and source_package_id=p_package_id) then raise exception 'PACKAGE_ALREADY_APPLIED'; end if;
  if v.guest_count_snapshot is null and exists(select 1 from public.package_items pi join public.catalog_items c on c.organization_id=pi.organization_id and c.id=pi.catalog_item_id where pi.organization_id=p_org_id and pi.package_id=p_package_id and c.pricing_method='PER_GUEST') then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  insert into public.quotation_lines(organization_id,quotation_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
  select p_org_id,p_quotation_id,c.id,p_package_id,c.name,c.item_type,c.unit,c.pricing_method,pi.quantity,c.selling_price,c.cost_price,
    public.commercial_total(c.pricing_method,c.selling_price,pi.quantity,v.guest_count_snapshot),public.commercial_total(c.pricing_method,c.cost_price,pi.quantity,v.guest_count_snapshot),false,coalesce((select max(sort_order)+1 from public.quotation_lines where quotation_id=p_quotation_id),0)+row_number() over(order by pi.sort_order)-1
  from public.package_items pi join public.catalog_items c on c.organization_id=pi.organization_id and c.id=pi.catalog_item_id
  where pi.organization_id=p_org_id and pi.package_id=p_package_id order by pi.sort_order;
  get diagnostics v_count=row_count;
  update public.quotations q set total_selling=x.sell,total_expected_cost=x.cost,total_expected_profit=x.sell-x.cost
   from (select coalesce(sum(total_selling),0) sell,coalesce(sum(total_expected_cost),0) cost from public.quotation_lines where quotation_id=p_quotation_id) x where q.id=p_quotation_id;
  perform public.record_audit(p_org_id,'PACKAGE_APPLIED_QUOTATION','quotation',p_quotation_id::text,jsonb_build_object('package_id',p_package_id,'lines',v_count));
  return v_count;
end$$;

create function public.issue_quotation(
  p_org_id uuid,p_quotation_id uuid,p_terms text default null,p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_sell numeric; v_cost numeric; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id,'terms',p_terms,'notes',p_notes));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status='ISSUED' then
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id)); return v;
  end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_ISSUE_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id) then raise exception 'EMPTY_QUOTATION'; end if;
  if exists(select 1 from public.quotation_lines where quotation_id=p_quotation_id and pricing_method='PER_GUEST') and v.guest_count_snapshot is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  update public.quotation_lines l set total_selling=public.commercial_total(l.pricing_method,l.unit_selling_price,l.quantity,v.guest_count_snapshot),total_expected_cost=public.commercial_total(l.pricing_method,l.expected_unit_cost,l.quantity,v.guest_count_snapshot) where l.quotation_id=p_quotation_id;
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_sell,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  update public.quotations set quotation_number=public.next_document_number(p_org_id,'QUOTATION','QT'),status='ISSUED',terms=p_terms,notes=coalesce(p_notes,notes),total_selling=v_sell,total_expected_cost=v_cost,total_expected_profit=v_sell-v_cost,issued_by=auth.uid(),issued_at=now()
   where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ISSUED','quotation',v.id::text,jsonb_build_object('total',v_sell,'quotation_number',v.quotation_number));
  return v;
end$$;

create function public.accept_quotation(p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid default gen_random_uuid())
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations; v_fp text; v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v from public.quotations where organization_id=p_org_id and id=(v_replay->>'quotation_id')::uuid; return v; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.event_id is not null then raise exception 'USE_ACCEPT_EVENT_QUOTATION'; end if;
  if v.status='ACCEPTED' then
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ACCEPT_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id)); return v;
  end if;
  if v.status<>'ISSUED' then raise exception 'QUOTATION_ACCEPT_NOT_ALLOWED'; end if;
  update public.quotations set status='ACCEPTED',accepted_by=auth.uid(),accepted_at=now() where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ACCEPT_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ACCEPTED','quotation',v.id::text,'{}'::jsonb);
  return v;
end$$;

create function public.convert_quotation_to_event(
  p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid,
  p_start_at timestamptz default null,p_end_at timestamptz default null,
  p_venue_name text default null,p_guest_count int default null,p_event_title text default null
) returns public.events language plpgsql security definer set search_path='' as $$
declare v_q public.quotations; v_customer public.customers; v_event public.events; v_fp text; v_replay jsonb; v_start timestamptz; v_end timestamptz; v_venue text; v_guests int; v_title text; v_matches int:=0;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_fp=public.quotation_fingerprint(jsonb_build_object('quotation_id',p_quotation_id,'start_at',p_start_at,'end_at',p_end_at,'venue',p_venue_name,'guests',p_guest_count,'title',p_event_title));
  v_replay=public.begin_command(p_org_id,'QUOTATIONS',p_idempotency_key,v_fp);
  if v_replay is not null then select * into v_event from public.events where organization_id=p_org_id and id=(v_replay->>'event_id')::uuid; return v_event; end if;
  select * into v_q from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v_q.converted_event_id is not null then
    select * into v_event from public.events where organization_id=p_org_id and id=v_q.converted_event_id;
    perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'CONVERT_QUOTATION',v_fp,'event',v_event.id,jsonb_build_object('event_id',v_event.id)); return v_event;
  end if;
  if v_q.status<>'ACCEPTED' or v_q.event_id is not null then raise exception 'QUOTATION_NOT_ACCEPTED'; end if;
  if v_q.customer_id is not null then
    select * into v_customer from public.customers where organization_id=p_org_id and id=v_q.customer_id and is_active;
    if not found then raise exception 'CUSTOMER_NOT_IN_ORG'; end if;
  else
    if nullif(trim(coalesce(v_q.customer_phone_snapshot,'')),'') is not null then
      select count(*) into v_matches from public.customers c where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=nullif(trim(v_q.customer_phone_snapshot),'');
    end if;
    if v_matches=1 then
      select * into v_customer from public.customers c where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=nullif(trim(v_q.customer_phone_snapshot),'');
    else
      insert into public.customers(organization_id,name,phone,whatsapp,customer_type,notes)
      values(p_org_id,v_q.customer_name_snapshot,v_q.customer_phone_snapshot,v_q.prospect_whatsapp,case when v_q.prospect_company is null then 'INDIVIDUAL'::public.customer_type else 'COMPANY'::public.customer_type end,v_q.prospect_company) returning * into v_customer;
    end if;
  end if;
  v_start=coalesce(p_start_at,v_q.start_at_snapshot); if v_start is null then raise exception 'EVENT_DATE_REQUIRED'; end if;
  v_end=coalesce(p_end_at,v_q.end_at_snapshot,v_start+interval '4 hours'); if v_end<=v_start then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
  v_venue=coalesce(nullif(trim(coalesce(p_venue_name,'')),''),v_q.venue_snapshot); if v_venue is null then raise exception 'VENUE_REQUIRED'; end if;
  v_guests=coalesce(p_guest_count,v_q.guest_count_snapshot); if v_guests is null or v_guests<1 then raise exception 'GUEST_COUNT_REQUIRED'; end if;
  v_title=coalesce(nullif(trim(coalesce(p_event_title,'')),''),v_q.event_title_snapshot,v_q.customer_name_snapshot);
  insert into public.events(organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,location_details,contact_name,contact_phone,status,accepted_quotation_id,idempotency_key,created_by,updated_by)
  values(p_org_id,v_customer.id,public.next_document_number(p_org_id,'EVENT','EV'),v_title,v_q.event_type_snapshot,v_start,v_end,v_guests,v_venue,v_q.location_snapshot,v_q.customer_name_snapshot,v_q.customer_phone_snapshot,'CONFIRMED',v_q.id,p_idempotency_key,auth.uid(),auth.uid()) returning * into v_event;
  insert into public.event_commercial_lines(organization_id,event_id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order)
  select organization_id,v_event.id,source_catalog_item_id,source_package_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,notes,sort_order from public.quotation_lines where quotation_id=v_q.id;
  insert into public.event_status_history(organization_id,event_id,to_status,actor_id,reason) values(p_org_id,v_event.id,'CONFIRMED',auth.uid(),'QUOTATION_CONVERTED');
  update public.quotations set status='CONVERTED',customer_id=v_customer.id,converted_event_id=v_event.id,converted_at=now() where id=v_q.id returning * into v_q;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'CONVERT_QUOTATION',v_fp,'event',v_event.id,jsonb_build_object('event_id',v_event.id));
  perform public.record_audit(p_org_id,'QUOTATION_CONVERTED','event',v_event.id::text,jsonb_build_object('quotation_id',v_q.id,'customer_id',v_customer.id,'customer_reused',v_matches=1));
  return v_event;
end$$;

create function public.cancel_quotation_draft(p_org_id uuid,p_quotation_id uuid,p_reason text default null)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations;
begin
  if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
  if v.status<>'DRAFT' then raise exception 'QUOTATION_NOT_CANCELLABLE'; end if;
  update public.quotations set status='CANCELLED',cancellation_reason=nullif(trim(coalesce(p_reason,'')),'') where id=p_quotation_id returning * into v;
  perform public.record_audit(p_org_id,'QUOTATION_DRAFT_CANCELLED','quotation',v.id::text,jsonb_build_object('reason',p_reason));
  return v;
end$$;

-- Legacy RPCs are removed together with their physical storage.
drop function public.create_quick_quote(uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,text,text,uuid);
drop function public.save_quick_quote_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,boolean);
drop function public.delete_quick_quote_line(uuid,uuid,uuid);
drop function public.reset_quick_quote_lines(uuid,uuid);
drop function public.apply_package_to_quick_quote(uuid,uuid,uuid);
drop function public.issue_quick_quote(uuid,uuid,text,text,uuid);
drop function public.accept_quick_quote(uuid,uuid,uuid);
drop function public.convert_quick_quote(uuid,uuid,uuid,timestamptz,timestamptz,text,int,text);
drop function public.discard_quick_quote(uuid,uuid,text);

drop table public.quick_quote_applied_packages;
drop table public.quick_quote_lines;
drop table public.quick_quotes;
drop type public.quick_quote_status;

-- Stable, cost-free member projection; drafts remain commercial-manager only.
create function public._view_quotations_customer()
returns table(
  id uuid,organization_id uuid,event_id uuid,quotation_number text,revision int,status public.quotation_status,
  customer_id uuid,customer_name_snapshot text,customer_phone_snapshot text,prospect_whatsapp text,prospect_company text,
  event_number_snapshot text,event_title_snapshot text,event_type_snapshot text,guest_count_snapshot int,
  start_at_snapshot timestamptz,end_at_snapshot timestamptz,venue_snapshot text,location_snapshot text,
  terms text,notes text,total_selling numeric,issued_at timestamptz,accepted_at timestamptz,
  converted_event_id uuid,created_at timestamptz,updated_at timestamptz
) language sql stable security definer set search_path='' as $$
  select q.id,q.organization_id,q.event_id,q.quotation_number,q.revision,q.status,q.customer_id,
    q.customer_name_snapshot,q.customer_phone_snapshot,q.prospect_whatsapp,q.prospect_company,
    q.event_number_snapshot,q.event_title_snapshot,q.event_type_snapshot,q.guest_count_snapshot,
    q.start_at_snapshot,q.end_at_snapshot,q.venue_snapshot,q.location_snapshot,q.terms,q.notes,
    q.total_selling,q.issued_at,q.accepted_at,q.converted_event_id,q.created_at,q.updated_at
  from public.quotations q
  where public.is_org_member(q.organization_id)
    and (q.status not in ('DRAFT','CANCELLED') or public.can_manage_commercial(q.organization_id))
$$;
create view public.quotations_customer with (security_invoker=true) as select * from public._view_quotations_customer();

create function public._view_quotation_lines_customer()
returns table(
  id uuid,organization_id uuid,quotation_id uuid,source_catalog_item_id uuid,source_package_id uuid,
  description text,item_type public.catalog_item_type,unit text,pricing_method public.pricing_method,
  quantity numeric,unit_selling_price numeric,expected_unit_cost numeric,total_selling numeric,total_expected_cost numeric,is_custom boolean,notes text,sort_order int
) language sql stable security definer set search_path='' as $$
  select l.id,l.organization_id,l.quotation_id,l.source_catalog_item_id,l.source_package_id,
    l.description,l.item_type,l.unit,l.pricing_method,l.quantity,l.unit_selling_price,
    case when public.can_read_cost(l.organization_id) then l.expected_unit_cost else null end,
    l.total_selling,case when public.can_read_cost(l.organization_id) then l.total_expected_cost else null end,
    l.is_custom,l.notes,l.sort_order
  from public.quotation_lines l join public.quotations q on q.id=l.quotation_id and q.organization_id=l.organization_id
  where public.is_org_member(l.organization_id)
    and (q.status<>'DRAFT' or public.can_manage_commercial(l.organization_id))
$$;
create view public.quotation_lines_customer with (security_invoker=true) as select * from public._view_quotation_lines_customer();

revoke all on function public._view_quotations_customer(),public._view_quotation_lines_customer() from public,anon,authenticated;
grant execute on function public._view_quotations_customer(),public._view_quotation_lines_customer() to authenticated;
revoke all on table public.quotations_customer,public.quotation_lines_customer from anon,authenticated;
grant select on table public.quotations_customer,public.quotation_lines_customer to authenticated;

-- RPC-only writes; no new table policies are introduced.
revoke all on function
  public.create_quotation_draft(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,uuid),
  public.update_quotation_draft(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text),
  public.save_quotation_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,numeric,boolean,uuid,uuid,text),
  public.delete_quotation_line(uuid,uuid,uuid),public.reset_quotation_lines(uuid,uuid),
  public.apply_package_to_quotation(uuid,uuid,uuid),public.issue_quotation(uuid,uuid,text,text,uuid),
  public.accept_quotation(uuid,uuid,uuid),public.convert_quotation_to_event(uuid,uuid,uuid,timestamptz,timestamptz,text,int,text),
  public.cancel_quotation_draft(uuid,uuid,text)
from public,anon;
grant execute on function
  public.create_quotation_draft(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,uuid),
  public.update_quotation_draft(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text),
  public.save_quotation_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,numeric,boolean,uuid,uuid,text),
  public.delete_quotation_line(uuid,uuid,uuid),public.reset_quotation_lines(uuid,uuid),
  public.apply_package_to_quotation(uuid,uuid,uuid),public.issue_quotation(uuid,uuid,text,text,uuid),
  public.accept_quotation(uuid,uuid,uuid),public.convert_quotation_to_event(uuid,uuid,uuid,timestamptz,timestamptz,text,int,text),
  public.cancel_quotation_draft(uuid,uuid,text)
to authenticated;

-- A converted prospect quotation remains the accepted commercial authority
-- for its Event. Preserve invoicing after the explicit CONVERTED transition.
create or replace function public.create_event_invoice(
  p_org_id uuid,
  p_event_id uuid,
  p_invoice_number text,
  p_due_at timestamptz,
  p_total_amount numeric,
  p_installments jsonb,
  p_note text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_invoice public.invoices;
  v_existing integer;
  v_sum numeric(14,3) := 0;
  v_item jsonb;
  v_kind text;
  v_due date;
  v_prev_due date;
  v_amount numeric(14,3);
  v_len integer;
  v_seq integer;
  v_quote_total numeric(14,3);
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_total_amount);
  if nullif(trim(coalesce(p_invoice_number, '')), '') is null then
    raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) < 2 then
    raise exception 'INVOICE_INSTALLMENTS_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CREATE_EVENT_INVOICE',
    'event_id', p_event_id,
    'invoice_number', trim(p_invoice_number),
    'due_at', p_due_at,
    'total_amount', p_total_amount::text,
    'installments', p_installments,
    'note', nullif(trim(coalesce(p_note, '')), '')
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_event_id::text, 1)
  );

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_CANCELLED';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;

  select q.total_selling::numeric(14,3)
    into v_quote_total
    from public.quotations q
   where q.organization_id = p_org_id
     and q.id = v_event.accepted_quotation_id
     and q.status in ('ACCEPTED','CONVERTED');
  if not found then
    raise exception 'INVOICE_REQUIRES_ACCEPTED_QUOTATION' using errcode = '23514';
  end if;
  if v_quote_total <> p_total_amount then
    raise exception 'INVOICE_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  select count(*) into v_existing
    from public.invoices
   where organization_id = p_org_id
     and event_id = p_event_id
     and status = 'ISSUED';
  if v_existing > 0 then
    raise exception 'INVOICE_ALREADY_EXISTS' using errcode = '23505';
  end if;

  v_len := jsonb_array_length(p_installments);
  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    if v_item ->> 'seq' is null then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;
    v_seq := (v_item ->> 'seq')::integer;
    if v_seq <> i then
      raise exception 'INVALID_INSTALLMENT_SEQUENCE' using errcode = '22023';
    end if;

    v_kind := v_item ->> 'kind';
    if (i = 0 and v_kind <> 'DEPOSIT')
       or (i = v_len - 1 and v_kind <> 'FINAL')
       or (i > 0 and i < v_len - 1 and v_kind <> 'INSTALLMENT') then
      raise exception 'INVALID_INSTALLMENT_KIND' using errcode = '22023';
    end if;

    if v_item ->> 'due_date' is null then
      raise exception 'INSTALLMENT_DUE_DATE_REQUIRED' using errcode = '22023';
    end if;
    v_due := (v_item ->> 'due_date')::date;
    if v_prev_due is not null and v_due < v_prev_due then
      raise exception 'INSTALLMENT_DATES_OUT_OF_ORDER' using errcode = '22023';
    end if;
    v_prev_due := v_due;

    if v_item ->> 'amount' is null then
      raise exception 'INVALID_INSTALLMENT_AMOUNT' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amount')::numeric;
    perform public.assert_wage_rate(v_amount);
    v_sum := v_sum + v_amount;
  end loop;

  if v_sum <> p_total_amount then
    raise exception 'INSTALLMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  insert into public.invoices (
    organization_id, event_id, quotation_id, invoice_number, due_at,
    total_amount, note, created_by
  ) values (
    p_org_id, p_event_id, v_event.accepted_quotation_id,
    trim(p_invoice_number), p_due_at, p_total_amount,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  ) returning * into v_invoice;

  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    insert into public.invoice_installments (
      organization_id, invoice_id, seq, kind, due_date, amount
    ) values (
      p_org_id, v_invoice.id, (v_item ->> 'seq')::integer,
      (v_item ->> 'kind')::public.invoice_installment_kind,
      (v_item ->> 'due_date')::date, (v_item ->> 'amount')::numeric(14,3)
    );
  end loop;

  perform public.record_audit(
    p_org_id, 'INVOICE_ISSUED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'invoice_number', trim(p_invoice_number),
      'total_amount', p_total_amount::text
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CREATE_EVENT_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;


comment on table public.quotations is 'Canonical quotation aggregate: editable DRAFT, immutable issued snapshot, acceptance and conversion lifecycle.';
comment on column public.quotation_lines.source_package_id is 'Package provenance snapshot. Package changes never mutate this quotation line.';
