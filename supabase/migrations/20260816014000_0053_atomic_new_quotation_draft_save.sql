-- ============================================================================
-- 0053 / R11 follow-up — one atomic command for new AND existing draft saves
--
-- A new draft must not commit a header before its line collection. This command
-- owns identity creation, complete aggregate replacement, audit and canonical
-- QUOTATIONS replay in one transaction. 0052 remains the internal DRAFT-only
-- replacement primitive for existing rows.
-- ============================================================================

create function public.persist_quotation_draft(
  p_org_id uuid,
  p_quotation_id uuid,
  p_idempotency_key uuid,
  p_prospect_name text,
  p_customer_id uuid default null,
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
  p_lines jsonb default '[]'::jsonb
) returns public.quotations
language plpgsql
security definer
set search_path=''
as $$
declare
  v_quote public.quotations;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
begin
  if not public.can_manage_commercial(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  -- Normalize the same presentation fields that the aggregate primitive saves.
  -- Ordered line JSON is intentional: order is part of the quotation snapshot.
  v_payload := jsonb_build_object(
    'quotation_id',p_quotation_id,
    'customer_id',p_customer_id,
    'prospect_name',trim(coalesce(p_prospect_name,'')),
    'prospect_phone',nullif(trim(coalesce(p_prospect_phone,'')),''),
    'prospect_whatsapp',nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
    'prospect_company',nullif(trim(coalesce(p_prospect_company,'')),''),
    'event_title',nullif(trim(coalesce(p_event_title,'')),''),
    'event_type',coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),
    'start_at',p_start_at,
    'end_at',p_end_at,
    'guest_count',p_guest_count,
    'venue_name',nullif(trim(coalesce(p_venue_name,'')),''),
    'notes',p_notes,
    'lines',coalesce(p_lines,'null'::jsonb)
  );
  v_fingerprint := public.quotation_fingerprint(v_payload);
  v_replay := public.begin_command(
    p_org_id,'QUOTATIONS',p_idempotency_key,v_fingerprint
  );

  if v_replay is not null then
    select * into v_quote
      from public.quotations q
     where q.organization_id=p_org_id
       and q.id=(v_replay->>'quotation_id')::uuid;
    if not found then raise exception 'QUOTATION_REPLAY_TARGET_NOT_FOUND'; end if;
    return v_quote;
  end if;

  if p_quotation_id is null then
    -- This insert and the complete 0052 replacement below share this function's
    -- transaction. Any line cast/FK/check failure rolls the new header back.
    insert into public.quotations(
      organization_id,event_id,quotation_number,revision,status,customer_id,
      customer_name_snapshot,customer_phone_snapshot,prospect_whatsapp,
      prospect_company,event_number_snapshot,event_title_snapshot,
      event_type_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,
      venue_snapshot,notes,total_selling,total_expected_cost,
      total_expected_profit,idempotency_key,created_by
    ) values (
      p_org_id,null,null,1,'DRAFT',p_customer_id,
      trim(coalesce(p_prospect_name,'')),
      nullif(trim(coalesce(p_prospect_phone,'')),''),
      nullif(trim(coalesce(p_prospect_whatsapp,'')),''),
      nullif(trim(coalesce(p_prospect_company,'')),''),null,
      coalesce(nullif(trim(coalesce(p_event_title,'')),''),trim(coalesce(p_prospect_name,''))),
      coalesce(nullif(trim(coalesce(p_event_type,'')),''),'OTHER'),p_guest_count,
      p_start_at,p_end_at,nullif(trim(coalesce(p_venue_name,'')),''),p_notes,
      0,0,0,p_idempotency_key,auth.uid()
    ) returning * into v_quote;
  else
    select * into v_quote
      from public.quotations q
     where q.organization_id=p_org_id and q.id=p_quotation_id
     for update;
    if not found then raise exception 'QUOTATION_NOT_FOUND'; end if;
    if v_quote.status<>'DRAFT' then raise exception 'QUOTATION_NOT_EDITABLE'; end if;
  end if;

  -- Explicit signature selects the 0052 internal aggregate primitive.
  v_quote := public.save_quotation_draft(
    p_org_id,v_quote.id,p_prospect_name,p_customer_id,p_prospect_phone,
    p_prospect_whatsapp,p_prospect_company,p_event_title,p_event_type,
    p_start_at,p_end_at,p_guest_count,p_venue_name,p_notes,p_lines
  );

  perform public.finish_command(
    p_org_id,'QUOTATIONS',p_idempotency_key,'PERSIST_QUOTATION_DRAFT',
    v_fingerprint,'quotation',v_quote.id,jsonb_build_object('quotation_id',v_quote.id)
  );
  return v_quote;
end;
$$;

-- The browser has one draft-persistence contract. The 0052 primitive remains
-- callable only by trusted database functions/owners.
revoke all on function public.save_quotation_draft(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) from authenticated;

revoke all on function public.persist_quotation_draft(
  uuid,uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) from public,anon;
grant execute on function public.persist_quotation_draft(
  uuid,uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) to authenticated;

comment on function public.persist_quotation_draft(
  uuid,uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,int,text,text,jsonb
) is 'Canonical idempotent command: atomically creates/replaces a complete DRAFT quotation aggregate.';
