-- ============================================================================
-- 0036 — S6 server-authoritative customer payment commands
--
-- AUTHORIZATION MATRIX (enforced in the database, never in the client):
--
--   command               | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT
--   ----------------------|-------|---------|------------|-----------|-----------
--   record_customer_payment| yes  |   yes   |    no      |    no     |    yes
--   void_customer_payment  | yes  |   yes   |    no      |    no     |    yes
--
-- Financial reads (payment amounts, economics) are gated by can_read_cost()
-- (OWNER/MANAGER/ACCOUNTANT) in migration 0037; operational roles are
-- default-deny for customer financial data.
--
-- IDEMPOTENCY CONTRACT (identical to the S5 commands): same org + same key +
-- same canonical payload -> original row returned, no second effect, no second
-- audit event; same org + same key + DIFFERENT payload -> hard rejection with
-- IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
--
-- CONCURRENCY: each command takes an advisory transaction lock on
-- (organization, idempotency key) before touching the ledger. record* inserts
-- a new immutable row; void* takes a row lock (SELECT ... FOR UPDATE) before
-- transitioning, so two concurrent voids serialize and exactly one wins. The
-- customer balance is never stored — it is derived from the RECORDED ledger,
-- so no balance can be corrupted by racing commands.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Idempotency helpers (internal; never client-callable).
-- ---------------------------------------------------------------------------
create or replace function public.begin_payment_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.payments_command_idempotency;
begin
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
    from public.payments_command_idempotency i
   where i.organization_id = p_org_id
     and i.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' using errcode = '22023';
    end if;
    return v_existing.response_payload;
  end if;
  return null;
end;
$$;

create or replace function public.finish_payment_command(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_command_name text,
  p_fingerprint text,
  p_result_entity text,
  p_result_id uuid,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payments_command_idempotency (
    organization_id, idempotency_key, command_name, request_fingerprint,
    result_entity, result_id, response_payload, actor_id
  ) values (
    p_org_id, p_idempotency_key, p_command_name, p_fingerprint,
    p_result_entity, p_result_id, p_response, auth.uid()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Exact OMR validation (reject; never silently round).
-- ---------------------------------------------------------------------------
create or replace function public.assert_payment_omr(p_amount numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT';
  end if;
  if round(p_amount, 3) <> p_amount then
    raise exception 'OMR_PRECISION_EXCEEDED';
  end if;
  if p_amount > 999999999.999 then
    raise exception 'OMR_AMOUNT_OUT_OF_RANGE';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_customer_payment — OWNER/MANAGER/ACCOUNTANT.
-- Requires a non-cancelled event with an ACCEPTED quotation (the authoritative
-- revenue basis). Rejects non-exact amounts and cross-org references.
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_payment(
  p_org_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_reference text,
  p_notes text,
  p_paid_at timestamptz,
  p_idempotency_key uuid
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_event public.events;
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
  perform public.assert_payment_omr(p_amount);
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_CUSTOMER_PAYMENT',
    'event_id', p_event_id,
    'amount', p_amount::text,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'paid_at', p_paid_at
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_event
    from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.status = 'CANCELLED' then
    raise exception 'EVENT_NOT_PAYABLE';
  end if;
  if v_event.accepted_quotation_id is null then
    raise exception 'PAYMENT_REQUIRES_ACCEPTED_QUOTATION';
  end if;

  insert into public.customer_payments (
    organization_id, event_id, amount, payment_method, reference, notes,
    paid_at, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_amount, p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(p_paid_at, now()), auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_payment;

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_RECORDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'amount', p_amount::text,
      'payment_method', p_payment_method
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'RECORD_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_customer_payment — OWNER/MANAGER/ACCOUNTANT.
-- Records a reversing lifecycle transition (RECORDED -> VOIDED) without ever
-- deleting the original financial fact. A repeated void of the same payment is
-- a hard error (PAYMENT_ALREADY_VOIDED) so operators cannot silently no-op.
-- ---------------------------------------------------------------------------
create or replace function public.void_customer_payment(
  p_org_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
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
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'PAYMENT_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_CUSTOMER_PAYMENT',
    'payment_id', p_payment_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.customer_payments, v_replay);
  end if;

  select * into v_payment
    from public.customer_payments
   where organization_id = p_org_id and id = p_payment_id
   for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'PAYMENT_ALREADY_VOIDED';
  end if;

  update public.customer_payments
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payment_id
   returning * into v_payment;

  perform public.record_audit(
    p_org_id, 'CUSTOMER_PAYMENT_VOIDED', 'customer_payment', v_payment.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', v_payment.event_id,
      'amount', v_payment.amount::text,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_CUSTOMER_PAYMENT', v_fingerprint,
    'customer_payment', v_payment.id, to_jsonb(v_payment)
  );
  return v_payment;
end;
$$;

-- Internal helper functions are never client-callable.
revoke all on function public.begin_payment_command(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_payment_command(uuid, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assert_payment_omr(numeric) from public, anon, authenticated;

-- Public command grants. Role checks are repeated inside every SECURITY
-- DEFINER function; authenticated EXECUTE alone is never authorization.
revoke all on function
  public.record_customer_payment(uuid, uuid, numeric, public.payment_method, text, text, timestamptz, uuid),
  public.void_customer_payment(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.record_customer_payment(uuid, uuid, numeric, public.payment_method, text, text, timestamptz, uuid),
  public.void_customer_payment(uuid, uuid, text, uuid)
  to authenticated;
