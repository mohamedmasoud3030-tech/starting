-- ============================================================================
-- 0045 — S9 closeout hardening
--
-- Closes correctness gaps found during merge review without mutating any
-- migration that may already exist outside this PR. This migration keeps the
-- public RPC signatures and read-model column shapes stable while hardening:
--   * one live attendance slot per host/event/day/shift;
--   * assignment/event/staff consistency;
--   * event payroll vs global staff advances semantics;
--   * invoice idempotency, accepted-quotation authority and schedule shape;
--   * cancelled installment read-state semantics.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Attendance identity: a retry with a DIFFERENT idempotency key must still not
-- create a second live financial fact for the same host/event/day/shift. A
-- voided fact releases the slot so a corrected repost can be recorded.
-- ---------------------------------------------------------------------------
create unique index staff_attendance_live_slot_unique
  on public.staff_attendance (
    organization_id, event_id, staff_member_id, attendance_date, shift
  )
  where status <> 'VOIDED';

-- ---------------------------------------------------------------------------
-- record_staff_attendance — hardened assignment integrity + slot serialization.
-- If the UI omits assignment_id, exactly one ACTIVE assignment for the
-- host/event is resolved server-side. Multiple assignments require the caller
-- to choose explicitly; a mismatched assignment is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.record_staff_attendance(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_assignment_id uuid,
  p_attendance_date date,
  p_shift public.staff_shift,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_break_minutes integer,
  p_status public.attendance_status,
  p_wage_method public.compensation_method,
  p_wage_rate numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_event public.events;
  v_fingerprint text;
  v_replay jsonb;
  v_hours numeric(6,3) := 0;
  v_earned numeric(14,3) := 0;
  v_break integer := coalesce(p_break_minutes, 0);
  v_assignment_id uuid := p_assignment_id;
  v_assignment_count integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_wage_rate(p_wage_rate);
  if v_break < 0 then
    raise exception 'INVALID_BREAK_MINUTES';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_STAFF_ATTENDANCE',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'assignment_id', p_assignment_id,
    'attendance_date', p_attendance_date,
    'shift', p_shift,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'break_minutes', v_break,
    'status', p_status,
    'wage_method', p_wage_method,
    'wage_rate', p_wage_rate::text,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

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

  if v_assignment_id is null then
    select count(*)::int, min(id)
      into v_assignment_count, v_assignment_id
      from public.event_staff_assignments
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE';
    if v_assignment_count = 0 then
      raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_assignment_count > 1 then
      raise exception 'ASSIGNMENT_REQUIRED' using errcode = '22023';
    end if;
  elsif not exists (
    select 1
      from public.event_staff_assignments
     where organization_id = p_org_id
       and id = v_assignment_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE'
  ) then
    raise exception 'ASSIGNMENT_MISMATCH' using errcode = '23503';
  end if;

  -- Different request keys for the same business slot serialize here. The
  -- partial unique index remains the final structural backstop.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_org_id::text || ':' || p_event_id::text || ':' || p_staff_member_id::text ||
      ':' || p_attendance_date::text || ':' || p_shift::text,
      3
    )
  );
  if exists (
    select 1
      from public.staff_attendance
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and attendance_date = p_attendance_date
       and shift = p_shift
       and status <> 'VOIDED'
  ) then
    raise exception 'ATTENDANCE_SLOT_ALREADY_RECORDED' using errcode = '23505';
  end if;

  if p_status = 'ABSENT' then
    if p_check_in is not null or p_check_out is not null then
      raise exception 'ABSENT_HAS_NO_TIMES';
    end if;
  else
    if p_check_in is null or p_check_out is null then
      raise exception 'ATTENDANCE_REQUIRES_TIMES';
    end if;
    if p_check_out <= p_check_in then
      raise exception 'CHECKOUT_BEFORE_CHECKIN';
    end if;
    if round(extract(epoch from (p_check_out - p_check_in))::numeric, 0) < v_break * 60 then
      raise exception 'BREAK_EXCEEDS_SHIFT' using errcode = '22023';
    end if;
    v_hours := round(
      (round(extract(epoch from (p_check_out - p_check_in))::numeric, 0)
        - v_break * 60) / 3600.0, 3
    );
  end if;
  v_earned := public.compute_earned_amount(
    p_wage_method, p_wage_rate, p_check_in, p_check_out, v_break
  );
  if p_status = 'ABSENT' then
    v_earned := 0;
  end if;

  insert into public.staff_attendance (
    organization_id, event_id, staff_member_id, assignment_id, attendance_date,
    shift, check_in, check_out, break_minutes, hours_worked, status,
    wage_method, wage_rate, earned_amount, notes, recorded_by,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, v_assignment_id, p_attendance_date,
    p_shift, p_check_in, p_check_out, v_break, v_hours, p_status,
    p_wage_method, p_wage_rate, v_earned,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ATTENDANCE_RECORDED', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'assignment_id', v_assignment_id,
      'shift', p_shift,
      'status', p_status,
      'hours_worked', v_hours::text,
      'earned_amount', v_earned::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_STAFF_ATTENDANCE', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Event payroll semantics.
--
-- staff_advances is deliberately a STAFF-LEVEL ledger (it has no event_id), so
-- it must never be repeated and subtracted once per event. Event rows therefore
-- expose event earnings + event-linked payouts only; global advances are
-- applied exactly once by get_host_payroll_summary(..., NULL) and by the staff
-- archive using the underlying advance/payout ledgers.
-- ---------------------------------------------------------------------------
create or replace view public.host_event_payroll_summaries as
select
  a.organization_id,
  a.staff_member_id,
  s.name as staff_name,
  s.staff_type,
  a.event_id,
  e.event_number,
  e.title as event_title,
  count(*) filter (where a.status <> 'VOIDED')::int as attendance_count,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as earned_total,
  0::numeric(14,3) as advances_total,
  coalesce((
    select sum(p.amount) from public.host_payouts p
     where p.organization_id = a.organization_id
       and p.staff_member_id = a.staff_member_id
       and p.event_id = a.event_id
       and p.status = 'RECORDED'
  ), 0)::numeric(14,3) as payouts_total,
  coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)::numeric(14,3) as due_total,
  coalesce((
    select sum(p.amount) from public.host_payouts p
     where p.organization_id = a.organization_id
       and p.staff_member_id = a.staff_member_id
       and p.event_id = a.event_id
       and p.status = 'RECORDED'
  ), 0)::numeric(14,3) as paid_total,
  (
    coalesce(sum(a.earned_amount) filter (where a.status <> 'VOIDED'), 0)
    - coalesce((
      select sum(p.amount) from public.host_payouts p
       where p.organization_id = a.organization_id
         and p.staff_member_id = a.staff_member_id
         and p.event_id = a.event_id
         and p.status = 'RECORDED'
    ), 0)
  )::numeric(14,3) as late_total
from public.staff_attendance a
join public.staff_members s
  on s.organization_id = a.organization_id and s.id = a.staff_member_id
join public.events e
  on e.organization_id = a.organization_id and e.id = a.event_id
where public.can_read_cost(a.organization_id)
group by a.organization_id, a.staff_member_id, s.name, s.staff_type,
         a.event_id, e.event_number, e.title;

create or replace function public.get_host_payroll_summary(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid default null
)
returns table (
  staff_member_id uuid,
  event_id uuid,
  earned_total numeric(14,3),
  advances_total numeric(14,3),
  payouts_total numeric(14,3),
  due_total numeric(14,3),
  paid_total numeric(14,3),
  late_total numeric(14,3),
  attendance_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_read_cost(p_org_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  with totals as (
    select
      coalesce(sum(a.earned_amount) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      ), 0)::numeric(14,3) as earned,
      case when p_event_id is null then coalesce((
        select sum(adv.amount)
          from public.staff_advances adv
         where adv.organization_id = p_org_id
           and adv.staff_member_id = p_staff_member_id
           and adv.status = 'RECORDED'
      ), 0) else 0 end::numeric(14,3) as advances,
      coalesce((
        select sum(p.amount)
          from public.host_payouts p
         where p.organization_id = p_org_id
           and p.staff_member_id = p_staff_member_id
           and (p_event_id is null or p.event_id = p_event_id)
           and p.status = 'RECORDED'
      ), 0)::numeric(14,3) as payouts,
      count(a.id) filter (
        where a.status <> 'VOIDED'
          and (p_event_id is null or a.event_id = p_event_id)
      )::int as attendance_count
    from public.staff_attendance a
    where a.organization_id = p_org_id
      and a.staff_member_id = p_staff_member_id
  )
  select
    p_staff_member_id,
    p_event_id,
    t.earned,
    t.advances,
    t.payouts,
    t.earned,
    (t.advances + t.payouts)::numeric(14,3),
    (t.earned - t.advances - t.payouts)::numeric(14,3),
    t.attendance_count
  from totals t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoicing: the accepted quotation remains the authoritative revenue amount.
-- The command idempotency register from S6 is reused so invoice retries follow
-- the exact same contract as customer-payment retries.
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
     and q.status = 'ACCEPTED';
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
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_INVOICE',
    'invoice_id', p_invoice_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_payment_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.invoices, v_replay);
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
   where organization_id = p_org_id
     and invoice_id = p_invoice_id
     and status = 'PENDING';
  update public.invoices
     set status = 'CANCELLED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_invoice_id
   returning * into v_invoice;

  perform public.record_audit(
    p_org_id, 'INVOICE_CANCELLED', 'invoice', v_invoice.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_payment_command(
    p_org_id, p_idempotency_key, 'VOID_INVOICE', v_fingerprint,
    'invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelled plans must never render as "PENDING" or "PAID".
-- ---------------------------------------------------------------------------
create or replace view public.invoice_installment_summaries as
select
  i.id as installment_id,
  i.organization_id,
  i.invoice_id,
  inv.event_id,
  inv.invoice_number,
  i.seq,
  i.kind,
  i.due_date,
  i.amount,
  i.status as plan_status,
  coalesce(cp.paid_total, 0)::numeric(14,3) as invoice_paid_total,
  sum(i.amount) over (partition by i.invoice_id order by i.seq)::numeric(14,3) as cumulative_amount,
  case
    when inv.status = 'CANCELLED' or i.status = 'CANCELLED' then 'CANCELLED'::text
    when sum(i.amount) over (partition by i.invoice_id order by i.seq)
         <= coalesce(cp.paid_total, 0) then 'PAID'::text
    else 'PENDING'::text
  end as effective_status
from public.invoice_installments i
join public.invoices inv
  on inv.organization_id = i.organization_id and inv.id = i.invoice_id
left join (
  select organization_id, event_id, sum(amount) as paid_total
  from public.customer_payments
  where status = 'RECORDED'
  group by organization_id, event_id
) cp on cp.organization_id = inv.organization_id and cp.event_id = inv.event_id
where public.can_read_cost(i.organization_id);
