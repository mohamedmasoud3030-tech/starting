-- Business-rule hardening (defects D32/D33/D34), forward-only and reversible:
--
--   1. CLOSED now requires zero physical outstanding: no dispatched-not-returned
--      equipment and no consumable custody still with the event. This makes the
--      documented close-out checklist (docs/architecture/02-event-lifecycle.md)
--      a database rule instead of advice. Events that never dispatched anything
--      remain closable without a reconciliation row.
--   2. record_customer_payment rejects amounts that would push RECORDED
--      payments above the accepted quotation's total_selling, so
--      "outstanding/remaining" can never go negative (no silent credit).
--   3. cancel_event now accepts mid-execution statuses (DISPATCHED /
--      IN_PROGRESS / RETURNING). The physical-recovery rule is unchanged:
--      reservations with dispatched equipment stay ACTIVE for return; only
--      undispatched reservations and assignments are released.
--
-- No data is modified by this migration. Each function is replaceable by a
-- later migration if the owner chooses different rules.

-- ===========================================================================
-- 1. transition_event_status + CLOSED guard
-- ===========================================================================
create or replace function public.transition_event_status(p_org_id uuid,p_event_id uuid,p_to public.event_status,p_reason text default null)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare v public.events; v_allowed boolean; v_from public.event_status;
  v_out numeric;
begin
  if not public.has_org_role(p_org_id,array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select * into v from public.events where organization_id=p_org_id and id=p_event_id for update; if not found then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_to='CANCELLED' then raise exception 'USE_CANCEL_EVENT'; end if;
  v_from:=v.status;
  if p_to = 'CLOSED' then
    v_out := coalesce((public.event_warehouse_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE'; end if;
    v_out := coalesce((public.event_consumable_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE'; end if;
  end if;
  v_allowed := (v.status,p_to) in (('CONFIRMED','PREPARING'),('PREPARING','DISPATCHED'),('DISPATCHED','IN_PROGRESS'),('IN_PROGRESS','RETURNING'),('RETURNING','CLOSED'));
  if not v_allowed then raise exception 'INVALID_EVENT_TRANSITION: % -> %',v.status,p_to; end if;
  update public.events set status=p_to,updated_by=auth.uid() where id=v.id returning * into v;
  insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.id,v_from,p_to,auth.uid(),p_reason);
  return v;
end;
$$;

-- ===========================================================================
-- 2. record_customer_payment + overpayment guard
-- ===========================================================================
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
  v_paid numeric;
  v_revenue numeric;
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

  select total_selling into v_revenue
    from public.quotations
   where organization_id = p_org_id and id = v_event.accepted_quotation_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.customer_payments
   where organization_id = p_org_id and event_id = p_event_id and status = 'RECORDED';
  if v_paid + p_amount > v_revenue then
    raise exception 'OVERPAYMENT_EXCEEDS_ACCEPTED' using errcode = 'P0001';
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

-- ===========================================================================
-- 3. cancel_event + mid-execution statuses
-- ===========================================================================
create or replace function public.cancel_event(
  p_org_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_staff int;
  v_equipment int;
  v_retained int;
begin
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role,
    'MANAGER'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  select * into v from public.events
   where organization_id = p_org_id and id = p_event_id
   for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v.status = 'CANCELLED' then
    return v;
  end if;
  if v.status not in ('DRAFT', 'QUOTED', 'CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_PROGRESS', 'RETURNING') then
    raise exception 'EVENT_CANNOT_BE_CANCELLED';
  end if;

  update public.event_staff_assignments
     set status = 'CANCELLED'
   where event_id = p_event_id and status = 'ACTIVE';
  get diagnostics v_staff = row_count;

  -- Release only lines that have no physical recovery obligation NOW.
  update public.event_equipment_reservations r
     set status = 'CANCELLED'
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE'
     and coalesce((
       select sum(
         m.dispatched_quantity
         - m.returned_good_quantity
         - m.damaged_quantity
         - m.lost_quantity
       )
       from public.event_equipment_movements m
       where m.organization_id = r.organization_id
         and m.reservation_id = r.id
     ), 0) = 0;
  get diagnostics v_equipment = row_count;

  select count(*)::int into v_retained
    from public.event_equipment_reservations r
   where r.organization_id = p_org_id
     and r.event_id = p_event_id
     and r.status = 'ACTIVE';

  insert into public.event_status_history(
    organization_id, event_id, from_status, to_status, actor_id, reason
  ) values (
    p_org_id, p_event_id, v.status, 'CANCELLED', auth.uid(), trim(p_reason)
  );

  update public.events
     set status = 'CANCELLED',
         cancellation_reason = trim(p_reason),
         updated_by = auth.uid()
   where id = p_event_id
  returning * into v;

  perform public.record_audit(
    p_org_id, 'EVENT_CANCELLED', 'event', p_event_id::text,
    jsonb_build_object(
      'reason', trim(p_reason),
      'staff_released', v_staff,
      'equipment_released', v_equipment,
      'equipment_retained_outstanding', v_retained,
      'idempotency_key', p_idempotency_key
    )
  );

  return v;
end;
$$;
