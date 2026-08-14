-- ============================================================================
-- 0017 — Quick Quote (عرض سعر سريع): fast pre-booking commercial workflow.
--
-- Product intent: the owner/manager must be able to produce a quotation with
-- minimal prospect data (no permanent Customer required) and only later
-- convert an ACCEPTED quotation into a real Customer + Event.
--
-- Design rules:
--  * NO second pricing engine: line totals reuse public.commercial_total().
--  * NO duplicate immutable quotation concepts: an issued Quick Quote IS a
--    row in public.quotations + public.quotation_lines (the existing
--    immutable snapshot system). quick_quotes is only the EDITABLE pre-event
--    workspace aggregate.
--  * Quick Quote lines carry NO expected cost: customer-facing quotations
--    never expose cost/profit; totals are selling-side only
--    (total_expected_cost = total_expected_profit = 0 on issued quotes).
--  * No sensitive direct writes: every change goes through SECURITY DEFINER
--    commands gated on can_manage_commercial (OWNER/MANAGER).
--  * Idempotency: create/issue/accept/convert retries never duplicate rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Workspace aggregate: the lightweight prospect/event snapshot (a draft is
-- NOT a Customer and NOT an Event; neither is ever created until convert).
-- ---------------------------------------------------------------------------
create type public.quick_quote_status as enum ('DRAFT','ISSUED','ACCEPTED','CONVERTED','DISCARDED');

create table public.quick_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid,
  quotation_number text,
  status public.quick_quote_status not null default 'DRAFT',
  prospect_name text not null check (length(trim(prospect_name)) > 0),
  prospect_phone text,
  prospect_whatsapp text,
  prospect_company text,
  event_title text,
  event_type text,
  start_at timestamptz,
  end_at timestamptz,
  guest_count int check (guest_count is null or guest_count > 0),
  venue_name text,
  notes text,
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,idempotency_key),
  unique (quotation_id),
  constraint quick_quotes_quotation_fk foreign key (quotation_id) references public.quotations(id) on delete set null,
  constraint quick_quotes_window check (end_at is null or start_at is null or end_at > start_at)
);
create index quick_quotes_org_idx on public.quick_quotes(organization_id, created_at desc);
create trigger quick_quotes_set_updated_at before update on public.quick_quotes for each row execute function public.set_updated_at();

create table public.quick_quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quick_quote_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  item_type public.catalog_item_type not null,
  unit text not null,
  pricing_method public.pricing_method not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_selling_price numeric(12,3) not null check (unit_selling_price >= 0),
  total_selling numeric(14,3) not null check (total_selling >= 0),
  is_custom boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,quick_quote_id) references public.quick_quotes(organization_id,id) on delete cascade,
  unique (organization_id,id)
);
create index quick_quote_lines_qq_idx on public.quick_quote_lines(quick_quote_id,sort_order);
create trigger quick_quote_lines_set_updated_at before update on public.quick_quote_lines for each row execute function public.set_updated_at();

-- Prevents double-applying the same package to one draft (duplicate lines).
create table public.quick_quote_applied_packages (
  organization_id uuid not null,
  quick_quote_id uuid not null,
  package_id uuid not null,
  applied_at timestamptz not null default now(),
  primary key (organization_id,quick_quote_id,package_id),
  foreign key (organization_id,quick_quote_id) references public.quick_quotes(organization_id,id) on delete cascade,
  foreign key (organization_id,package_id) references public.packages(organization_id,id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- quotations: allow PRE-EVENT quotations (event_id nullable) and carry the
-- convert metadata (resolved customer + converted event) for idempotency.
-- Snapshots that can legitimately be unknown for a prospect quote
-- (guests/date/venue) become nullable; the event flow still fills them.
-- ---------------------------------------------------------------------------
alter table public.quotations alter column event_id drop not null;
alter table public.quotations alter column guest_count_snapshot drop not null;
alter table public.quotations alter column start_at_snapshot drop not null;
alter table public.quotations alter column end_at_snapshot drop not null;
alter table public.quotations alter column venue_snapshot drop not null;

alter table public.quotations add column customer_id uuid;
alter table public.quotations add column converted_event_id uuid;
alter table public.quotations add column converted_at timestamptz;
alter table public.quotations add constraint quotations_converted_event_unique unique (converted_event_id);
alter table public.quotations add constraint quotations_customer_org_fk
  foreign key (organization_id,customer_id) references public.customers(organization_id,id) on delete set null;
alter table public.quotations add constraint quotations_converted_event_org_fk
  foreign key (organization_id,converted_event_id) references public.events(organization_id,id) on delete restrict;

-- The immutability trigger must allow the convert metadata columns and the
-- ACCEPTED → convert update, while STILL forbidding any change to snapshot
-- columns or to any other lifecycle state.
create or replace function public.protect_quotation_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','accepted_by','accepted_at','customer_id','converted_event_id','converted_at']) is distinct from (to_jsonb(old)-array['status','accepted_by','accepted_at','customer_id','converted_event_id','converted_at']) then raise exception 'QUOTATION_IMMUTABLE'; end if;
 if old.status not in ('ISSUED','ACCEPTED') then raise exception 'QUOTATION_IMMUTABLE'; end if;
 return new;
end$$;

-- ---------------------------------------------------------------------------
-- RLS + grants: org-scoped reads for members; ALL writes are RPC-only.
-- ---------------------------------------------------------------------------
alter table public.quick_quotes enable row level security;
alter table public.quick_quote_lines enable row level security;
alter table public.quick_quote_applied_packages enable row level security;

create policy quick_quotes_read on public.quick_quotes for select using(public.is_org_member(organization_id));
create policy quick_quote_lines_read on public.quick_quote_lines for select using(public.is_org_member(organization_id));
create policy quick_quote_packages_read on public.quick_quote_applied_packages for select using(public.is_org_member(organization_id));

revoke all on table public.quick_quotes,public.quick_quote_lines,public.quick_quote_applied_packages from anon;
grant select on public.quick_quotes,public.quick_quote_lines,public.quick_quote_applied_packages to authenticated;

-- ============================================================================
-- Commands (SECURITY DEFINER, empty search_path, can_manage_commercial gate)
-- ============================================================================

-- 1. Create the editable prospect/event draft. Idempotent by idempotency key.
create or replace function public.create_quick_quote(
  p_org_id uuid,
  p_prospect_name text,
  p_prospect_phone text default null,
  p_prospect_whatsapp text default null,
  p_prospect_company text default null,
  p_event_title text default null,
  p_event_type text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_guest_count int default null,
  p_venue_name text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quick_quotes language plpgsql security definer set search_path='' as $$
declare v public.quick_quotes;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.quick_quotes where organization_id=p_org_id and idempotency_key=p_idempotency_key; if found then return v; end if;
 if length(trim(p_prospect_name))=0 then raise exception 'PROSPECT_NAME_REQUIRED'; end if;
 if p_guest_count is not null and p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
 if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
 insert into public.quick_quotes(organization_id,prospect_name,prospect_phone,prospect_whatsapp,prospect_company,event_title,event_type,start_at,end_at,guest_count,venue_name,notes,idempotency_key,created_by)
 values(p_org_id,trim(p_prospect_name),nullif(trim(coalesce(p_prospect_phone,'')),''),nullif(trim(coalesce(p_prospect_whatsapp,'')),''),nullif(trim(coalesce(p_prospect_company,'')),''),nullif(trim(coalesce(p_event_title,'')),''),coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),p_start_at,p_end_at,p_guest_count,nullif(trim(coalesce(p_venue_name,'')),''),p_notes,p_idempotency_key,auth.uid()) returning * into v;
 perform public.record_audit(p_org_id,'QUICK_QUOTE_CREATED','quick_quote',v.id::text,jsonb_build_object('idempotency_key',p_idempotency_key)); return v;
end$$;

-- 2. Upsert one draft line. PER_GUEST requires a known guest count.
create or replace function public.save_quick_quote_line(
  p_org_id uuid,
  p_quick_quote_id uuid,
  p_line_id uuid,
  p_description text,
  p_item_type public.catalog_item_type,
  p_unit text,
  p_pricing_method public.pricing_method,
  p_quantity numeric,
  p_unit_selling_price numeric,
  p_is_custom boolean default true
) returns public.quick_quote_lines language plpgsql security definer set search_path='' as $$
declare v public.quick_quote_lines; v_quote public.quick_quotes; v_total numeric;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
 if p_quantity<=0 or p_unit_selling_price<0 then raise exception 'INVALID_COMMERCIAL_VALUE'; end if;
 if length(trim(p_description))=0 then raise exception 'DESCRIPTION_REQUIRED'; end if;
 if p_pricing_method='PER_GUEST' and v_quote.guest_count is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
 v_total:=public.commercial_total(p_pricing_method,p_unit_selling_price,p_quantity,coalesce(v_quote.guest_count,0));
 if p_line_id is null then
  insert into public.quick_quote_lines(organization_id,quick_quote_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,total_selling,is_custom,sort_order)
  values(p_org_id,p_quick_quote_id,trim(p_description),p_item_type,trim(p_unit),p_pricing_method,p_quantity,p_unit_selling_price,v_total,p_is_custom,coalesce((select max(sort_order)+1 from public.quick_quote_lines where quick_quote_id=p_quick_quote_id),0)) returning * into v;
 else
  update public.quick_quote_lines set description=trim(p_description),item_type=p_item_type,unit=trim(p_unit),pricing_method=p_pricing_method,quantity=p_quantity,unit_selling_price=p_unit_selling_price,total_selling=v_total,is_custom=p_is_custom
  where id=p_line_id and quick_quote_id=p_quick_quote_id and organization_id=p_org_id returning * into v;
 end if;
 if v.id is null then raise exception 'LINE_NOT_FOUND'; end if; return v;
end$$;

-- 3. Remove one draft line.
create or replace function public.delete_quick_quote_line(p_org_id uuid,p_quick_quote_id uuid,p_line_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
 delete from public.quick_quote_lines where id=p_line_id and quick_quote_id=p_quick_quote_id and organization_id=p_org_id;
 if not found then raise exception 'LINE_NOT_FOUND'; end if;
end$$;

-- 4. Replace all draft lines (used when resuming/editing a draft before issue).
create or replace function public.reset_quick_quote_lines(p_org_id uuid,p_quick_quote_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
 delete from public.quick_quote_lines where quick_quote_id=p_quick_quote_id;
end$$;

-- 5. Apply an ACTIVE package as selling-only snapshot lines (double apply guarded).
create or replace function public.apply_package_to_quick_quote(p_org_id uuid,p_quick_quote_id uuid,p_package_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes; v_count int; v_guests int;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
 if not exists(select 1 from public.packages where organization_id=p_org_id and id=p_package_id and status='ACTIVE') then raise exception 'PACKAGE_NOT_IN_ORG' using errcode='23503'; end if;
 if exists(select 1 from public.quick_quote_applied_packages where organization_id=p_org_id and quick_quote_id=p_quick_quote_id and package_id=p_package_id) then raise exception 'PACKAGE_ALREADY_APPLIED'; end if;
 v_guests:=coalesce(v_quote.guest_count,0);
 if v_guests=0 and exists(
    select 1 from public.package_items pi
    join public.catalog_items c on c.id=pi.catalog_item_id and c.organization_id=pi.organization_id
    where pi.organization_id=p_org_id and pi.package_id=p_package_id and c.pricing_method='PER_GUEST')
 then raise exception 'GUEST_COUNT_REQUIRED'; end if;
 insert into public.quick_quote_lines(organization_id,quick_quote_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,total_selling,is_custom,sort_order)
 select p_org_id,p_quick_quote_id,c.name,c.item_type,c.unit,c.pricing_method,pi.quantity,c.selling_price,public.commercial_total(c.pricing_method,c.selling_price,pi.quantity,v_guests),false,pi.sort_order
 from public.package_items pi join public.catalog_items c on c.id=pi.catalog_item_id and c.organization_id=pi.organization_id
 where pi.organization_id=p_org_id and pi.package_id=p_package_id;
 get diagnostics v_count=row_count;
 insert into public.quick_quote_applied_packages(organization_id,quick_quote_id,package_id) values(p_org_id,p_quick_quote_id,p_package_id);
 perform public.record_audit(p_org_id,'PACKAGE_APPLIED_QUICK_QUOTE','quick_quote',p_quick_quote_id::text,jsonb_build_object('package_id',p_package_id,'lines',v_count)); return v_count;
end$$;

-- 6. Issue: the draft BECOMES a normal, immutable quotation (revision 1,
-- event_id NULL). Idempotent: retry returns the already-issued quotation.
create or replace function public.issue_quick_quote(
  p_org_id uuid,
  p_quick_quote_id uuid,
  p_terms text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes; v_quote_ret public.quotations; v_num text; v_sell numeric;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status='ISSUED' and v_quote.quotation_id is not null then
  select * into v_quote_ret from public.quotations where organization_id=p_org_id and id=v_quote.quotation_id; if found then return v_quote_ret; end if;
 end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
 if not exists(select 1 from public.quick_quote_lines where quick_quote_id=p_quick_quote_id) then raise exception 'EMPTY_QUOTATION'; end if;
 select coalesce(sum(total_selling),0) into v_sell from public.quick_quote_lines where quick_quote_id=p_quick_quote_id;
 v_num:=public.next_document_number(p_org_id,'QUOTATION','QT');
 insert into public.quotations(organization_id,event_id,quotation_number,revision,customer_name_snapshot,customer_phone_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,location_snapshot,terms,notes,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by)
 values(p_org_id,null,v_num,1,v_quote.prospect_name,v_quote.prospect_phone,v_num,coalesce(v_quote.event_title,v_quote.prospect_name),v_quote.guest_count,v_quote.start_at,v_quote.end_at,v_quote.venue_name,null,p_terms,p_notes,v_sell,0,0,p_idempotency_key,auth.uid()) returning * into v_quote_ret;
 insert into public.quotation_lines(organization_id,quotation_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
 select organization_id,v_quote_ret.id,description,item_type,unit,pricing_method,quantity,unit_selling_price,0,total_selling,0,is_custom,sort_order from public.quick_quote_lines where quick_quote_id=p_quick_quote_id;
 update public.quick_quotes set quotation_id=v_quote_ret.id,quotation_number=v_num,status='ISSUED' where id=p_quick_quote_id;
 perform public.record_audit(p_org_id,'QUICK_QUOTE_ISSUED','quotation',v_quote_ret.id::text,jsonb_build_object('quick_quote_id',p_quick_quote_id,'total',v_sell,'quotation_number',v_num)); return v_quote_ret;
end$$;

-- 7. Accept an issued prospect quotation (no Event exists yet).
create or replace function public.accept_quick_quote(p_org_id uuid,p_quotation_id uuid,p_idempotency_key uuid default gen_random_uuid())
returns public.quotations language plpgsql security definer set search_path='' as $$
declare v public.quotations;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v from public.quotations where organization_id=p_org_id and id=p_quotation_id for update; if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
 if v.event_id is not null then raise exception 'USE_ACCEPT_EVENT_QUOTATION'; end if;
 if v.status='ACCEPTED' then return v; end if;
 if v.status<>'ISSUED' then raise exception 'QUOTATION_ACCEPT_NOT_ALLOWED'; end if;
 update public.quotations set status='ACCEPTED',accepted_by=auth.uid(),accepted_at=now() where id=v.id returning * into v;
 update public.quick_quotes set status='ACCEPTED' where quotation_id=v.id;
 perform public.record_audit(p_org_id,'QUOTATION_ACCEPTED','quotation',v.id::text,jsonb_build_object('idempotency_key',p_idempotency_key)); return v;
end$$;

-- 8. Convert an ACCEPTED prospect quotation into Customer + Event,
-- transactionally and idempotently (converted_event_id guards retries).
-- Customer resolution: reuse ONLY on an unambiguous exact phone match;
-- ambiguous matches and name-only matches NEVER merge — a new Customer is
-- created. No Event is ever created for rejected/abandoned quotations.
create or replace function public.convert_quick_quote(
  p_org_id uuid,
  p_quotation_id uuid,
  p_idempotency_key uuid,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_venue_name text default null,
  p_guest_count int default null,
  p_event_title text default null
) returns public.events language plpgsql security definer set search_path='' as $$
declare
  v_quote public.quotations; v_qq public.quick_quotes; v_customer public.customers; v_event public.events;
  v_start timestamptz; v_end timestamptz; v_venue text; v_guests int; v_title text; v_type text;
  v_phone text; v_matches int;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quotations where organization_id=p_org_id and id=p_quotation_id for update; if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
 if v_quote.converted_event_id is not null then
  select * into v_event from public.events where id=v_quote.converted_event_id and organization_id=p_org_id; if found then return v_event; end if;
 end if;
 if v_quote.status<>'ACCEPTED' then raise exception 'QUOTATION_NOT_ACCEPTED'; end if;
 select * into v_qq from public.quick_quotes where quotation_id=v_quote.id; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;

 v_phone:=nullif(trim(coalesce(v_qq.prospect_phone,'')),'');
 v_matches:=0;
 if v_phone is not null then
  select count(*) into v_matches from public.customers c
   where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=v_phone;
 end if;
 if v_matches=1 then
  select * into v_customer from public.customers c
   where c.organization_id=p_org_id and c.is_active and nullif(trim(coalesce(c.phone,'')),'')=v_phone;
 else
  insert into public.customers(organization_id,name,phone,whatsapp,customer_type,notes)
  values(p_org_id,v_qq.prospect_name,v_qq.prospect_phone,v_qq.prospect_whatsapp,
         case when v_qq.prospect_company is not null then 'COMPANY'::public.customer_type else 'INDIVIDUAL' end,
         v_qq.prospect_company) returning * into v_customer;
 end if;

 v_start:=coalesce(p_start_at,v_qq.start_at); if v_start is null then raise exception 'EVENT_DATE_REQUIRED'; end if;
 v_end:=coalesce(p_end_at,v_qq.end_at,v_start+interval '4 hours'); if v_end<=v_start then raise exception 'INVALID_EVENT_WINDOW' using errcode='22007'; end if;
 v_venue:=coalesce(nullif(trim(coalesce(p_venue_name,'')),''),v_qq.venue_name); if v_venue is null then raise exception 'VENUE_REQUIRED'; end if;
 v_guests:=coalesce(p_guest_count,v_qq.guest_count); if v_guests is null then raise exception 'GUEST_COUNT_REQUIRED'; end if;
 v_title:=coalesce(nullif(trim(coalesce(p_event_title,'')),''),v_qq.event_title,v_qq.prospect_name);
 v_type:=coalesce(v_qq.event_type,'OTHER');

 insert into public.events(organization_id,customer_id,event_number,title,event_type,start_at,end_at,guest_count,venue_name,status,accepted_quotation_id,idempotency_key,created_by,updated_by)
 values(p_org_id,v_customer.id,public.next_document_number(p_org_id,'EVENT','EV'),v_title,v_type,v_start,v_end,v_guests,v_venue,'CONFIRMED',v_quote.id,p_idempotency_key,auth.uid(),auth.uid()) returning * into v_event;
 insert into public.event_status_history(organization_id,event_id,to_status,actor_id,reason) values(p_org_id,v_event.id,'CONFIRMED',auth.uid(),'QUICK_QUOTE_CONVERTED');
 update public.quotations set customer_id=v_customer.id,converted_event_id=v_event.id,converted_at=now() where id=v_quote.id;
 update public.quick_quotes set status='CONVERTED' where id=v_qq.id;
 perform public.record_audit(p_org_id,'QUICK_QUOTE_CONVERTED','event',v_event.id::text,jsonb_build_object('quotation_id',v_quote.id,'customer_id',v_customer.id,'customer_reused',v_matches=1,'idempotency_key',p_idempotency_key));
 return v_event;
end$$;

-- 9. Discard an abandoned DRAFT (never creates Customer/Event/audit truth).
create or replace function public.discard_quick_quote(p_org_id uuid,p_quick_quote_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes;
begin
 if not public.can_manage_commercial(p_org_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_quote from public.quick_quotes where organization_id=p_org_id and id=p_quick_quote_id for update; if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
 if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_DISCARDABLE'; end if;
 delete from public.quick_quotes where id=p_quick_quote_id;
 perform public.record_audit(p_org_id,'QUICK_QUOTE_DISCARDED','quick_quote',p_quick_quote_id::text,jsonb_build_object('reason',p_reason));
end$$;

-- ---------------------------------------------------------------------------
-- Least-privilege grants (commands only; no direct table writes).
-- ---------------------------------------------------------------------------
revoke all on function public.create_quick_quote(uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,text,text,uuid),
  public.save_quick_quote_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,boolean),
  public.delete_quick_quote_line(uuid,uuid,uuid),
  public.reset_quick_quote_lines(uuid,uuid),
  public.apply_package_to_quick_quote(uuid,uuid,uuid),
  public.issue_quick_quote(uuid,uuid,text,text,uuid),
  public.accept_quick_quote(uuid,uuid,uuid),
  public.convert_quick_quote(uuid,uuid,uuid,timestamptz,timestamptz,text,int,text),
  public.discard_quick_quote(uuid,uuid,text) from public,anon;
grant execute on function public.create_quick_quote(uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,text,text,uuid),
  public.save_quick_quote_line(uuid,uuid,uuid,text,public.catalog_item_type,text,public.pricing_method,numeric,numeric,boolean),
  public.delete_quick_quote_line(uuid,uuid,uuid),
  public.reset_quick_quote_lines(uuid,uuid),
  public.apply_package_to_quick_quote(uuid,uuid,uuid),
  public.issue_quick_quote(uuid,uuid,text,text,uuid),
  public.accept_quick_quote(uuid,uuid,uuid),
  public.convert_quick_quote(uuid,uuid,uuid,timestamptz,timestamptz,text,int,text),
  public.discard_quick_quote(uuid,uuid,text) to authenticated;
