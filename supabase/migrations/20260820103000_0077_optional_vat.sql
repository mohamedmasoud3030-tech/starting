-- ============================================================================
-- 0077 — Optional VAT (authoritative end-to-end)
--
-- VAT is OPTIONAL per organization and snapshotted onto issued commercial
-- documents. Historical documents are NEVER recalculated from current
-- settings: the quotation/invoice issue commands copy the VAT configuration
-- into the document row, and printed/read models read the stored snapshot.
--
-- Money rules: OMR 3 decimals everywhere; the final total is
--     pre_vat_total + round(pre_vat_total × vat_percent / 100, 3).
-- For a VAT-registered org, `total_selling` (quotation) and `total_amount`
-- (invoice) become the VAT-INCLUSIVE final total. VAT-disabled orgs snapshot
-- 0 percent / 0 amount, so their totals are unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Organization VAT settings.
-- ---------------------------------------------------------------------------
alter table public.organization_settings
  add column vat_registered boolean not null default false,
  add column vat_percent numeric(12,3) not null default 5.000,
  add column vat_registration_number text;

-- ---------------------------------------------------------------------------
-- 2. Quotation VAT snapshot columns (immutable after issue, like the rest).
-- ---------------------------------------------------------------------------
alter table public.quotations
  add column pre_vat_total numeric(14,3) not null default 0,
  add column vat_registered boolean not null default false,
  add column vat_percent numeric(12,3) not null default 0,
  add column vat_amount numeric(14,3) not null default 0,
  add column vat_registration_number text;

update public.quotations set pre_vat_total = total_selling;

-- ---------------------------------------------------------------------------
-- 3. Invoice VAT snapshot columns.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column pre_vat_total numeric(14,3) not null default 0,
  add column vat_registered boolean not null default false,
  add column vat_percent numeric(12,3) not null default 0,
  add column vat_amount numeric(14,3) not null default 0,
  add column vat_registration_number text;

update public.invoices set pre_vat_total = total_amount;

-- ---------------------------------------------------------------------------
-- 4. save_organization_settings gains VAT fields (OWNER-only, as before).
--    The pre-VAT signature is dropped so the upsert command is not overloaded.
-- ---------------------------------------------------------------------------
drop function if exists public.save_organization_settings(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text);

create or replace function public.save_organization_settings(
  p_org_id uuid,
  p_name_en text default null,
  p_logo_url text default null,
  p_primary_color text default null,
  p_accent_color text default null,
  p_phone_primary text default null,
  p_phone_secondary text default null,
  p_whatsapp text default null,
  p_email text default null,
  p_commercial_registration text default null,
  p_postal_code text default null,
  p_po_box text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_region text default null,
  p_country text default null,
  p_document_terms text default null,
  p_document_footer text default null,
  p_quotation_number_prefix text default null,
  p_invoice_number_prefix text default null,
  p_event_number_prefix text default null,
  p_manager_name text default null,
  p_manager_title text default null,
  p_vat_registered boolean default null,
  p_vat_percent numeric default null,
  p_vat_registration_number text default null
)
returns public.organization_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.organization_settings;
  v_prefix_quote text;
  v_prefix_invoice text;
  v_prefix_event text;
begin
  if auth.uid() is null
     or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_vat_percent is not null and (p_vat_percent < 0 or p_vat_percent > 100) then
    raise exception 'INVALID_VAT_PERCENT' using errcode = '22023';
  end if;

  v_prefix_quote  := nullif(trim(coalesce(p_quotation_number_prefix, '')), '');
  v_prefix_invoice := nullif(trim(coalesce(p_invoice_number_prefix, '')), '');
  v_prefix_event  := nullif(trim(coalesce(p_event_number_prefix, '')), '');

  insert into public.organization_settings (
    organization_id, name_en, logo_url, primary_color, accent_color,
    phone_primary, phone_secondary, whatsapp, email,
    commercial_registration, postal_code, po_box, address_line1, city, region, country,
    document_terms, document_footer,
    quotation_number_prefix, invoice_number_prefix, event_number_prefix,
    manager_name, manager_title,
    vat_registered, vat_percent, vat_registration_number
  ) values (
    p_org_id,
    nullif(trim(p_name_en), ''),
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_primary_color), ''),
    nullif(trim(p_accent_color), ''),
    nullif(trim(p_phone_primary), ''),
    nullif(trim(p_phone_secondary), ''),
    nullif(trim(p_whatsapp), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_commercial_registration), ''),
    nullif(trim(p_postal_code), ''),
    nullif(trim(p_po_box), ''),
    nullif(trim(p_address_line1), ''),
    nullif(trim(p_city), ''),
    nullif(trim(p_region), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_document_terms), ''),
    nullif(trim(p_document_footer), ''),
    coalesce(v_prefix_quote, 'QT'),
    coalesce(v_prefix_invoice, 'INV'),
    coalesce(v_prefix_event, 'EV'),
    nullif(trim(p_manager_name), ''),
    nullif(trim(p_manager_title), ''),
    coalesce(p_vat_registered, false),
    coalesce(p_vat_percent, 5.000),
    nullif(trim(coalesce(p_vat_registration_number, '')), '')
  )
  on conflict (organization_id) do update set
    name_en = excluded.name_en,
    logo_url = excluded.logo_url,
    primary_color = excluded.primary_color,
    accent_color = excluded.accent_color,
    phone_primary = excluded.phone_primary,
    phone_secondary = excluded.phone_secondary,
    whatsapp = excluded.whatsapp,
    email = excluded.email,
    commercial_registration = excluded.commercial_registration,
    postal_code = excluded.postal_code,
    po_box = excluded.po_box,
    address_line1 = excluded.address_line1,
    city = excluded.city,
    region = excluded.region,
    country = excluded.country,
    document_terms = excluded.document_terms,
    document_footer = excluded.document_footer,
    quotation_number_prefix = excluded.quotation_number_prefix,
    invoice_number_prefix = excluded.invoice_number_prefix,
    event_number_prefix = excluded.event_number_prefix,
    manager_name = excluded.manager_name,
    manager_title = excluded.manager_title,
    vat_registered = coalesce(p_vat_registered, public.organization_settings.vat_registered),
    vat_percent = coalesce(p_vat_percent, public.organization_settings.vat_percent),
    vat_registration_number = case
      when p_vat_registration_number is null then public.organization_settings.vat_registration_number
      else nullif(trim(p_vat_registration_number), '')
    end,
    updated_at = now()
  returning * into v_result;

  perform public.record_audit(
    p_org_id,
    'ORGANIZATION_SETTINGS_SAVED',
    'organization_settings',
    p_org_id::text,
    jsonb_build_object(
      'name_en', v_result.name_en,
      'phone_primary', v_result.phone_primary,
      'commercial_registration', v_result.commercial_registration,
      'vat_registered', v_result.vat_registered,
      'vat_percent', v_result.vat_percent::text
    )
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. issue_quotation snapshots VAT from the CURRENT organization settings at
--    the moment of issue; later settings changes never touch issued quotes.
-- ---------------------------------------------------------------------------
create or replace function public.issue_quotation(
  p_org_id uuid, p_quotation_id uuid, p_terms text default null, p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.quotations language plpgsql security definer set search_path='' as $$
declare
  v public.quotations;
  v_subtotal numeric; v_cost numeric; v_discount numeric; v_grand numeric;
  v_fp text; v_replay jsonb;
  v_vat_registered boolean := false;
  v_vat_percent numeric(12,3) := 0;
  v_vat_amount numeric(14,3) := 0;
  v_vat_reg text;
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
  select coalesce(sum(total_selling),0),coalesce(sum(total_expected_cost),0) into v_subtotal,v_cost from public.quotation_lines where quotation_id=p_quotation_id;
  select q.p_discount_amount, q.p_grand_total into v_discount, v_grand
    from public.quotation_pricing(v_subtotal, v.transport_amount, v.surcharge_amount, v.discount_type, v.discount_value) q;

  -- Authoritative VAT snapshot from organization settings. Scalar subqueries
  -- (not SELECT..INTO) so a missing settings row yields the safe defaults.
  v_vat_registered := coalesce((
    select s.vat_registered from public.organization_settings s
     where s.organization_id = p_org_id
  ), false);
  v_vat_percent := coalesce((
    select s.vat_percent from public.organization_settings s
     where s.organization_id = p_org_id
  ), 5.000);
  v_vat_reg := nullif(trim(coalesce((
    select s.vat_registration_number from public.organization_settings s
     where s.organization_id = p_org_id
  ), '')), '');
  v_vat_amount := case when v_vat_registered
    then round(v_grand * v_vat_percent / 100, 3) else 0 end;

  update public.quotations set
    quotation_number=coalesce(v.quotation_number, public.next_document_number(p_org_id,'QUOTATION',null)),
    series_id=coalesce(v.series_id, v.id),
    status='ISSUED', terms=p_terms, notes=coalesce(p_notes,notes),
    subtotal=v_subtotal, discount_amount=v_discount,
    pre_vat_total=v_grand,
    vat_registered=v_vat_registered,
    vat_percent=v_vat_percent,
    vat_amount=v_vat_amount,
    vat_registration_number=v_vat_reg,
    total_selling=v_grand + v_vat_amount,
    total_expected_cost=v_cost,
    total_expected_profit=(v_grand + v_vat_amount)-v_cost,
    issued_by=auth.uid(), issued_at=now()
   where id=p_quotation_id returning * into v;
  perform public.finish_command(p_org_id,'QUOTATIONS',p_idempotency_key,'ISSUE_QUOTATION',v_fp,'quotation',v.id,jsonb_build_object('quotation_id',v.id));
  perform public.record_audit(p_org_id,'QUOTATION_ISSUED','quotation',v.id::text,jsonb_build_object('total',(v_grand + v_vat_amount),'pre_vat_total',v_grand,'vat_amount',v_vat_amount,'quotation_number',v.quotation_number,'revision',v.revision));
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- 6. create_event_invoice snapshots VAT from the accepted quotation (the
--    authoritative commercial flow), not from live settings.
-- ---------------------------------------------------------------------------
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
  v_pre_vat_total numeric(14,3);
  v_vat_registered boolean;
  v_vat_percent numeric(12,3);
  v_vat_amount numeric(14,3);
  v_vat_reg text;
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

  select q.total_selling::numeric(14,3),
         q.pre_vat_total::numeric(14,3),
         coalesce(q.vat_registered, false),
         coalesce(q.vat_percent, 0),
         coalesce(q.vat_amount, 0),
         q.vat_registration_number
    into v_quote_total, v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg
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
    total_amount, pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number,
    note, created_by
  ) values (
    p_org_id, p_event_id, v_event.accepted_quotation_id,
    trim(p_invoice_number), p_due_at, p_total_amount,
    v_pre_vat_total, v_vat_registered, v_vat_percent, v_vat_amount, v_vat_reg,
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
      'total_amount', p_total_amount::text,
      'pre_vat_total', v_pre_vat_total::text,
      'vat_amount', v_vat_amount::text
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'CREATE_EVENT_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Invoice immutability guard covers the new VAT snapshot columns.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INVOICE_APPEND_ONLY' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'ISSUED' and new.status = 'CANCELLED') then
    raise exception 'INVALID_INVOICE_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.event_id is distinct from old.event_id
    or new.quotation_id is distinct from old.quotation_id
    or new.invoice_number is distinct from old.invoice_number
    or new.issued_at is distinct from old.issued_at
    or new.due_at is distinct from old.due_at
    or new.total_amount is distinct from old.total_amount
    or new.pre_vat_total is distinct from old.pre_vat_total
    or new.vat_registered is distinct from old.vat_registered
    or new.vat_percent is distinct from old.vat_percent
    or new.vat_amount is distinct from old.vat_amount
    or new.vat_registration_number is distinct from old.vat_registration_number
    or new.currency is distinct from old.currency
    or new.note is distinct from old.note
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'INVOICE_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Read models expose the VAT snapshot (issued documents read stored
--    snapshots — never recalculated from live settings).
-- ---------------------------------------------------------------------------
drop view if exists public.quotations_customer;
drop function if exists public._view_quotations_customer();

create function public._view_quotations_customer()
returns table(
  id uuid,organization_id uuid,event_id uuid,quotation_number text,revision int,status public.quotation_status,
  customer_id uuid,customer_name_snapshot text,customer_phone_snapshot text,prospect_whatsapp text,prospect_company text,
  event_number_snapshot text,event_title_snapshot text,event_type_snapshot text,guest_count_snapshot int,
  start_at_snapshot timestamptz,end_at_snapshot timestamptz,venue_snapshot text,location_snapshot text,
  terms text,notes text,subtotal numeric,total_selling numeric,
  pre_vat_total numeric,vat_registered boolean,vat_percent numeric,vat_amount numeric,vat_registration_number text,
  transport_required boolean,transport_zone text,transport_amount numeric,transport_note text,
  surcharge_amount numeric,surcharge_note text,
  discount_type public.quotation_discount_type,discount_value numeric,discount_amount numeric,
  valid_until timestamptz,series_id uuid,superseded_reason text,
  issued_at timestamptz,accepted_at timestamptz,rejected_at timestamptz,expired_at timestamptz,
  converted_event_id uuid,is_expired boolean,created_at timestamptz,updated_at timestamptz
) language sql stable security definer set search_path='' as $$
  select q.id,q.organization_id,q.event_id,q.quotation_number,q.revision,q.status,q.customer_id,
    q.customer_name_snapshot,q.customer_phone_snapshot,q.prospect_whatsapp,q.prospect_company,
    q.event_number_snapshot,q.event_title_snapshot,q.event_type_snapshot,q.guest_count_snapshot,
    q.start_at_snapshot,q.end_at_snapshot,q.venue_snapshot,q.location_snapshot,q.terms,q.notes,
    q.subtotal,q.total_selling,
    q.pre_vat_total,q.vat_registered,q.vat_percent,q.vat_amount,q.vat_registration_number,
    q.transport_required,q.transport_zone,q.transport_amount,q.transport_note,
    q.surcharge_amount,q.surcharge_note,
    q.discount_type,q.discount_value,q.discount_amount,
    q.valid_until,q.series_id,q.superseded_reason,
    q.issued_at,q.accepted_at,q.rejected_at,q.expired_at,q.converted_event_id,
    (q.status='ISSUED' and q.valid_until is not null and q.valid_until < now()),
    q.created_at,q.updated_at
  from public.quotations q
  where public.is_org_member(q.organization_id)
    and (q.status not in ('DRAFT','CANCELLED') or public.can_manage_commercial(q.organization_id))
$$;
create view public.quotations_customer with (security_invoker=true) as select * from public._view_quotations_customer();

revoke all on function public._view_quotations_customer() from public,anon,authenticated;
grant execute on function public._view_quotations_customer() to authenticated;
revoke all on table public.quotations_customer from anon,authenticated;
grant select on table public.quotations_customer to authenticated;

-- Invoice read model exposes the VAT snapshot.
drop view if exists public.invoice_summaries;

create view public.invoice_summaries as
select
  inv.id as invoice_id,
  inv.organization_id,
  inv.event_id,
  e.event_number,
  e.title as event_title,
  inv.quotation_id,
  inv.invoice_number,
  inv.issued_at,
  inv.due_at,
  inv.total_amount,
  inv.pre_vat_total,
  inv.vat_registered,
  inv.vat_percent,
  inv.vat_amount,
  inv.vat_registration_number,
  inv.status as invoice_status,
  inv.note,
  inv.voided_by,
  inv.voided_at,
  inv.void_reason,
  inv.created_at,
  coalesce(cp.paid_total, 0)::numeric(14,3) as paid_total,
  (inv.total_amount - coalesce(cp.paid_total, 0))::numeric(14,3) as remaining_balance
from public.invoices inv
join public.events e
  on e.organization_id = inv.organization_id and e.id = inv.event_id
left join (
  select organization_id, event_id, sum(amount) as paid_total
  from public.customer_payments
  where status = 'RECORDED'
  group by organization_id, event_id
) cp on cp.organization_id = inv.organization_id and cp.event_id = inv.event_id
where public.can_read_cost(inv.organization_id);

revoke all on table public.invoice_summaries from anon, authenticated;
grant select on table public.invoice_summaries to authenticated;

revoke all on function public.issue_quotation(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.create_event_invoice(uuid, uuid, text, timestamptz, numeric, jsonb, text, uuid) from public, anon;
grant execute on function public.issue_quotation(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.create_event_invoice(uuid, uuid, text, timestamptz, numeric, jsonb, text, uuid) to authenticated;
