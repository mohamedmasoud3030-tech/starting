-- ============================================================================
-- 0018 — Quick Quote hardening before consolidation.
--
-- Tightens four invariants discovered during review of 0017:
--  * pre-event quotations must not fabricate an Event number;
--  * quotation status/snapshot transitions remain strictly immutable;
--  * create_quick_quote idempotency keys cannot be reused with a new payload;
--  * resetting a draft also clears package-application markers so the package
--    can be deliberately re-applied after a full draft reset.
--
-- Quick-quote drafts are commercial pre-booking data, so direct reads are
-- restricted to the same commercial role gate used by the command surface.
-- ============================================================================

-- A pre-event quotation has no Event yet; null is the truthful snapshot.
alter table public.quotations alter column event_number_snapshot drop not null;

-- Draft commercial data should not be visible merely because somebody is an
-- operational member of the organization.
drop policy if exists quick_quotes_read on public.quick_quotes;
drop policy if exists quick_quote_lines_read on public.quick_quote_lines;
drop policy if exists quick_quote_packages_read on public.quick_quote_applied_packages;
create policy quick_quotes_read on public.quick_quotes for select
  using (public.can_manage_commercial(organization_id));
create policy quick_quote_lines_read on public.quick_quote_lines for select
  using (public.can_manage_commercial(organization_id));
create policy quick_quote_packages_read on public.quick_quote_applied_packages for select
  using (public.can_manage_commercial(organization_id));

-- Idempotent create must be stable: same key + same normalized payload returns
-- the original draft; same key + different payload is rejected.
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
declare
  v public.quick_quotes;
  v_name text := trim(coalesce(p_prospect_name,''));
  v_phone text := nullif(trim(coalesce(p_prospect_phone,'')),'');
  v_whatsapp text := nullif(trim(coalesce(p_prospect_whatsapp,'')),'');
  v_company text := nullif(trim(coalesce(p_prospect_company,'')),'');
  v_title text := nullif(trim(coalesce(p_event_title,'')),'');
  v_type text := coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER');
  v_venue text := nullif(trim(coalesce(p_venue_name,'')),'');
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v
    from public.quick_quotes
   where organization_id=p_org_id and idempotency_key=p_idempotency_key;
  if found then
    if v.prospect_name is distinct from v_name
       or v.prospect_phone is distinct from v_phone
       or v.prospect_whatsapp is distinct from v_whatsapp
       or v.prospect_company is distinct from v_company
       or v.event_title is distinct from v_title
       or v.event_type is distinct from v_type
       or v.start_at is distinct from p_start_at
       or v.end_at is distinct from p_end_at
       or v.guest_count is distinct from p_guest_count
       or v.venue_name is distinct from v_venue
       or v.notes is distinct from p_notes then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v;
  end if;

  if length(v_name)=0 then raise exception 'PROSPECT_NAME_REQUIRED'; end if;
  if p_guest_count is not null and p_guest_count<1 then raise exception 'INVALID_GUEST_COUNT'; end if;
  if p_start_at is not null and p_end_at is not null and p_end_at<=p_start_at then
    raise exception 'INVALID_EVENT_WINDOW' using errcode='22007';
  end if;

  insert into public.quick_quotes(
    organization_id,prospect_name,prospect_phone,prospect_whatsapp,
    prospect_company,event_title,event_type,start_at,end_at,guest_count,
    venue_name,notes,idempotency_key,created_by
  ) values (
    p_org_id,v_name,v_phone,v_whatsapp,v_company,v_title,v_type,
    p_start_at,p_end_at,p_guest_count,v_venue,p_notes,p_idempotency_key,auth.uid()
  ) returning * into v;

  perform public.record_audit(
    p_org_id,'QUICK_QUOTE_CREATED','quick_quote',v.id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key)
  );
  return v;
end$$;

-- A full line reset is a deliberate restart of the draft composition. Package
-- markers must be reset with the lines or the owner cannot re-apply a package.
create or replace function public.reset_quick_quote_lines(
  p_org_id uuid,
  p_quick_quote_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare v_quote public.quick_quotes;
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  select * into v_quote
    from public.quick_quotes
   where organization_id=p_org_id and id=p_quick_quote_id
   for update;
  if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;
  if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;

  delete from public.quick_quote_applied_packages
   where organization_id=p_org_id and quick_quote_id=p_quick_quote_id;
  delete from public.quick_quote_lines
   where organization_id=p_org_id and quick_quote_id=p_quick_quote_id;
end$$;

-- Issue a truthful pre-event snapshot. In particular, event_number_snapshot is
-- NULL until an Event actually exists; the quotation number is never passed
-- off as an Event number.
create or replace function public.issue_quick_quote(
  p_org_id uuid,
  p_quick_quote_id uuid,
  p_terms text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare
  v_quote public.quick_quotes;
  v_quote_ret public.quotations;
  v_num text;
  v_sell numeric;
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select * into v_quote
    from public.quick_quotes
   where organization_id=p_org_id and id=p_quick_quote_id
   for update;
  if not found then raise exception 'QUICK_QUOTE_NOT_FOUND'; end if;

  if v_quote.status='ISSUED' and v_quote.quotation_id is not null then
    select * into v_quote_ret
      from public.quotations
     where organization_id=p_org_id and id=v_quote.quotation_id;
    if found then return v_quote_ret; end if;
  end if;

  if v_quote.status<>'DRAFT' then raise exception 'QUICK_QUOTE_NOT_EDITABLE'; end if;
  if not exists(select 1 from public.quick_quote_lines where quick_quote_id=p_quick_quote_id) then
    raise exception 'EMPTY_QUOTATION';
  end if;

  select coalesce(sum(total_selling),0)
    into v_sell
    from public.quick_quote_lines
   where quick_quote_id=p_quick_quote_id;

  v_num:=public.next_document_number(p_org_id,'QUOTATION','QT');

  insert into public.quotations(
    organization_id,event_id,quotation_number,revision,
    customer_name_snapshot,customer_phone_snapshot,event_number_snapshot,
    event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,
    venue_snapshot,location_snapshot,terms,notes,total_selling,
    total_expected_cost,total_expected_profit,idempotency_key,issued_by
  ) values (
    p_org_id,null,v_num,1,
    v_quote.prospect_name,v_quote.prospect_phone,null,
    coalesce(v_quote.event_title,v_quote.prospect_name),v_quote.guest_count,
    v_quote.start_at,v_quote.end_at,v_quote.venue_name,null,p_terms,p_notes,
    v_sell,0,0,p_idempotency_key,auth.uid()
  ) returning * into v_quote_ret;

  insert into public.quotation_lines(
    organization_id,quotation_id,description,item_type,unit,pricing_method,
    quantity,unit_selling_price,expected_unit_cost,total_selling,
    total_expected_cost,is_custom,sort_order
  )
  select organization_id,v_quote_ret.id,description,item_type,unit,
         pricing_method,quantity,unit_selling_price,0,total_selling,0,
         is_custom,sort_order
    from public.quick_quote_lines
   where quick_quote_id=p_quick_quote_id;

  update public.quick_quotes
     set quotation_id=v_quote_ret.id,quotation_number=v_num,status='ISSUED'
   where id=p_quick_quote_id;

  perform public.record_audit(
    p_org_id,'QUICK_QUOTE_ISSUED','quotation',v_quote_ret.id::text,
    jsonb_build_object('quick_quote_id',p_quick_quote_id,'total',v_sell,'quotation_number',v_num)
  );
  return v_quote_ret;
end$$;

-- Preserve immutable commercial/customer/event snapshots while allowing only
-- the narrow lifecycle mutations required by the existing Event quote flow and
-- by pre-event Quick Quote conversion.
create or replace function public.protect_quotation_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['status','accepted_by','accepted_at','customer_id','converted_event_id','converted_at'])
       is distinct from
     (to_jsonb(old)-array['status','accepted_by','accepted_at','customer_id','converted_event_id','converted_at']) then
    raise exception 'QUOTATION_IMMUTABLE';
  end if;

  if old.status='ISSUED' and new.status='ISSUED' then
    if new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at
       or new.customer_id is distinct from old.customer_id
       or new.converted_event_id is distinct from old.converted_event_id
       or new.converted_at is distinct from old.converted_at then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ISSUED' and new.status='SUPERSEDED' then
    if new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at
       or new.customer_id is distinct from old.customer_id
       or new.converted_event_id is distinct from old.converted_event_id
       or new.converted_at is distinct from old.converted_at then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ISSUED' and new.status='ACCEPTED' then
    if new.accepted_by is null or new.accepted_at is null
       or new.customer_id is distinct from old.customer_id
       or new.converted_event_id is distinct from old.converted_event_id
       or new.converted_at is distinct from old.converted_at then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if old.status='ACCEPTED' and new.status='ACCEPTED' then
    if new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at then
      raise exception 'QUOTATION_IMMUTABLE';
    end if;

    -- Only a pre-event quote may gain conversion metadata, and it must gain the
    -- complete tuple atomically. Once set, the tuple can never be rewritten.
    if new.customer_id is distinct from old.customer_id
       or new.converted_event_id is distinct from old.converted_event_id
       or new.converted_at is distinct from old.converted_at then
      if old.event_id is not null
         or old.customer_id is not null
         or old.converted_event_id is not null
         or old.converted_at is not null
         or new.customer_id is null
         or new.converted_event_id is null
         or new.converted_at is null then
        raise exception 'QUOTATION_IMMUTABLE';
      end if;
    end if;
    return new;
  end if;

  raise exception 'QUOTATION_IMMUTABLE';
end$$;
