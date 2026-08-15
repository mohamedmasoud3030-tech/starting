-- ============================================================================
-- 0042 — S6+ invoicing commands
--
-- AUTHORIZATION (enforced in DB): OWNER / MANAGER / ACCOUNTANT only.
-- create_event_invoice builds a formal invoice with a deposit + installment
-- schedule from the accepted quotation total; the schedule sum MUST equal the
-- invoice total (exact 3dp). Payments remain in the S6 ledger; installment
-- PAID state is derived there, never duplicated here.
-- ============================================================================

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
  v_existing int;
  v_sum numeric(14,3) := 0;
  v_item jsonb;
  v_kind text;
  v_due date;
  v_amount numeric(14,3);
  v_len int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_wage_rate(p_total_amount);
  if nullif(trim(coalesce(p_invoice_number, '')), '') is null then
    raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023';
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

  select count(*) into v_existing
    from public.invoices
   where organization_id = p_org_id and event_id = p_event_id and status = 'ISSUED';
  if v_existing > 0 then
    raise exception 'INVOICE_ALREADY_EXISTS';
  end if;

  if p_installments is null or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) = 0 then
    raise exception 'INVOICE_INSTALLMENTS_REQUIRED';
  end if;

  v_len := jsonb_array_length(p_installments);
  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    v_kind := v_item ->> 'kind';
    v_due := (v_item ->> 'due_date')::date;
    v_amount := (v_item ->> 'amount')::numeric;
    if v_kind is distinct from all (array['DEPOSIT', 'INSTALLMENT', 'FINAL']) then
      raise exception 'INVALID_INSTALLMENT_KIND';
    end if;
    if v_due is null then
      raise exception 'INSTALLMENT_DUE_DATE_REQUIRED' using errcode = '22023';
    end if;
    perform public.assert_wage_rate(v_amount);
    v_sum := v_sum + v_amount;
  end loop;
  if round(v_sum, 3) <> round(p_total_amount, 3) then
    raise exception 'INSTALLMENT_TOTAL_MISMATCH';
  end if;

  insert into public.invoices (
    organization_id, event_id, quotation_id, invoice_number, due_at,
    total_amount, note, created_by
  ) values (
    p_org_id, p_event_id, v_event.accepted_quotation_id,
    nullif(trim(p_invoice_number), ''), p_due_at, p_total_amount,
    nullif(trim(p_note), ''), auth.uid()
  ) returning * into v_invoice;

  for i in 0..v_len - 1 loop
    v_item := p_installments -> i;
    insert into public.invoice_installments (
      organization_id, invoice_id, seq, kind, due_date, amount
    ) values (
      p_org_id, v_invoice.id, (v_item ->> 'seq')::int,
      (v_item ->> 'kind')::public.invoice_installment_kind,
      (v_item ->> 'due_date')::date, (v_item ->> 'amount')::numeric(14,3)
    );
  end loop;

  perform public.record_audit(
    p_org_id, 'INVOICE_ISSUED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'event_id', p_event_id, 'invoice_number', p_invoice_number,
      'total_amount', p_total_amount::text
    )
  );
  return v_invoice;
end;
$$;

create or replace function public.void_invoice(
  p_org_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_invoice
    from public.invoices
   where organization_id = p_org_id and id = p_invoice_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'CANCELLED' then
    raise exception 'INVOICE_ALREADY_CANCELLED';
  end if;

  update public.invoice_installments
     set status = 'CANCELLED'
   where organization_id = p_org_id and invoice_id = p_invoice_id
     and status <> 'CANCELLED';
  update public.invoices
     set status = 'CANCELLED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_invoice_id
   returning * into v_invoice;

  perform public.record_audit(
    p_org_id, 'INVOICE_CANCELLED', 'invoice', v_invoice.id::text,
    jsonb_build_object('reason', trim(p_reason))
  );
  return v_invoice;
end;
$$;

revoke all on function
  public.create_event_invoice(uuid, uuid, text, timestamptz, numeric, jsonb, text, uuid),
  public.void_invoice(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.create_event_invoice(uuid, uuid, text, timestamptz, numeric, jsonb, text, uuid),
  public.void_invoice(uuid, uuid, text, uuid)
  to authenticated;
