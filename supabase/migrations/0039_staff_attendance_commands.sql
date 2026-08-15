-- ============================================================================
-- 0039 — S9 server-authoritative staff attendance & host payroll commands
--
-- AUTHORIZATION MATRIX (enforced in the database, never in the client):
--
--   command                  | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT
--   -------------------------|-------|---------|------------|-----------|-----------
--   record_staff_attendance  | yes  |   yes   |    yes     |    no     |    no
--   void_staff_attendance    | yes  |   yes   |    yes     |    no     |    no
--   record_staff_advance     | yes  |   yes   |    no      |    no     |    yes
--   void_staff_advance       | yes  |   yes   |    no      |    no     |    yes
--   record_host_payout       | yes  |   yes   |    no      |    no     |    yes
--   void_host_payout         | yes  |   yes   |    no      |    no     |    yes
--
-- Attendance is operational (recorded by supervisors on site); advances and
-- payouts are financial (OWNER/MANAGER/ACCOUNTANT only).
--
-- IDEMPOTENCY: same org + key + canonical payload -> original row; same key +
-- different payload -> IDEMPOTENCY_KEY_PAYLOAD_MISMATCH. CONCURRENCY: each
-- command takes an advisory xact lock on (org, key) before touching the ledger.
-- ============================================================================

create or replace function public.begin_staff_command(
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
  v_existing public.staff_payroll_command_idempotency;
begin
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
    from public.staff_payroll_command_idempotency i
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

create or replace function public.finish_staff_command(
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
  insert into public.staff_payroll_command_idempotency (
    organization_id, idempotency_key, command_name, request_fingerprint,
    result_entity, result_id, response_payload, actor_id
  ) values (
    p_org_id, p_idempotency_key, p_command_name, p_fingerprint,
    p_result_entity, p_result_id, p_response, auth.uid()
  );
end;
$$;

-- Exact OMR validation for a wage rate (>= 0; balances may be zero).
create or replace function public.assert_wage_rate(p_rate numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_rate is null or p_rate < 0 then
    raise exception 'INVALID_WAGE_RATE';
  end if;
  if round(p_rate, 3) <> p_rate then
    raise exception 'OMR_PRECISION_EXCEEDED';
  end if;
  if p_rate > 999999999.999 then
    raise exception 'OMR_AMOUNT_OUT_OF_RANGE';
  end if;
end;
$$;

-- Compute exact OMR earned amount from hours and wage, no binary float in the
-- stored money path (seconds are rounded to integers before any arithmetic).
create or replace function public.compute_earned_amount(
  p_wage_method public.compensation_method,
  p_wage_rate numeric,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_break_minutes integer
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_seconds integer;
  v_work_seconds numeric;
  v_hours numeric(6,3);
begin
  if p_wage_method in ('PER_DAY', 'PER_EVENT', 'MANUAL') then
    return round(p_wage_rate, 3);
  end if;
  -- PER_HOUR only.
  v_seconds := round(extract(epoch from (p_check_out - p_check_in))::numeric, 0)::integer;
  v_work_seconds := v_seconds - coalesce(p_break_minutes, 0) * 60;
  v_hours := round(v_work_seconds / 3600.0, 3);
  return round(v_hours * p_wage_rate, 3);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_staff_attendance — OWNER/MANAGER/SUPERVISOR.
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
    v_hours := round(
      (round(extract(epoch from (p_check_out - p_check_in))::numeric, 0)
        - v_break * 60) / 3600.0, 3
    );
  end if;
  v_earned := public.compute_earned_amount(
    p_wage_method, p_wage_rate, p_check_in, p_check_out, v_break
  );
  -- ABSENT carries no hours and no earned amount regardless of wage method.
  if p_status = 'ABSENT' then
    v_earned := 0;
  end if;

  insert into public.staff_attendance (
    organization_id, event_id, staff_member_id, assignment_id, attendance_date,
    shift, check_in, check_out, break_minutes, hours_worked, status,
    wage_method, wage_rate, earned_amount, notes, recorded_by,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, p_assignment_id, p_attendance_date,
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
-- void_staff_attendance — OWNER/MANAGER/SUPERVISOR.
-- ---------------------------------------------------------------------------
create or replace function public.void_staff_attendance(
  p_org_id uuid,
  p_attendance_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_attendance;
  v_fingerprint text;
  v_replay jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_STAFF_ATTENDANCE',
    'attendance_id', p_attendance_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_row
    from public.staff_attendance
   where organization_id = p_org_id and id = p_attendance_id
   for update;
  if not found then
    raise exception 'ATTENDANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'ATTENDANCE_ALREADY_VOIDED';
  end if;

  update public.staff_attendance
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_attendance_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ATTENDANCE_VOIDED', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', v_row.event_id,
      'staff_member_id', v_row.staff_member_id,
      'reason', trim(p_reason)
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ATTENDANCE', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_staff_advance — OWNER/MANAGER/ACCOUNTANT.
-- ---------------------------------------------------------------------------
create or replace function public.record_staff_advance(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
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
  if p_advance_date is null then
    raise exception 'ADVANCE_DATE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_STAFF_ADVANCE',
    'staff_member_id', p_staff_member_id,
    'amount', p_amount::text,
    'advance_date', p_advance_date,
    'reason', nullif(trim(coalesce(p_reason, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  insert into public.staff_advances (
    organization_id, staff_member_id, amount, advance_date, reason,
    recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_amount, p_advance_date,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_RECORDED', 'staff_advance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'amount', p_amount::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_staff_advance — OWNER/MANAGER/ACCOUNTANT.
-- ---------------------------------------------------------------------------
create or replace function public.void_staff_advance(
  p_org_id uuid,
  p_advance_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.staff_advances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_advances;
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
    'command', 'VOID_STAFF_ADVANCE',
    'advance_id', p_advance_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_advances, v_replay);
  end if;

  select * into v_row
    from public.staff_advances
   where organization_id = p_org_id and id = p_advance_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'ADVANCE_ALREADY_VOIDED';
  end if;

  update public.staff_advances
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_advance_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_ADVANCE_VOIDED', 'staff_advance', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_STAFF_ADVANCE', v_fingerprint,
    'staff_advance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_host_payout — OWNER/MANAGER/ACCOUNTANT.
-- ---------------------------------------------------------------------------
create or replace function public.record_host_payout(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_payout_date date,
  p_payment_method public.payment_method,
  p_reference text,
  p_reason text,
  p_idempotency_key uuid
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.host_payouts;
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
  if p_payout_date is null then
    raise exception 'PAYOUT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_HOST_PAYOUT',
    'staff_member_id', p_staff_member_id,
    'event_id', p_event_id,
    'amount', p_amount::text,
    'payout_date', p_payout_date,
    'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  insert into public.host_payouts (
    organization_id, staff_member_id, event_id, amount, payout_date,
    payment_method, reference, reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_staff_member_id, p_event_id, p_amount, p_payout_date,
    p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_RECORDED', 'host_payout', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'staff_member_id', p_staff_member_id,
      'event_id', p_event_id,
      'amount', p_amount::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'RECORD_HOST_PAYOUT', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_host_payout — OWNER/MANAGER/ACCOUNTANT.
-- ---------------------------------------------------------------------------
create or replace function public.void_host_payout(
  p_org_id uuid,
  p_payout_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.host_payouts;
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
    'command', 'VOID_HOST_PAYOUT',
    'payout_id', p_payout_id,
    'reason', trim(p_reason)
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.host_payouts, v_replay);
  end if;

  select * into v_row
    from public.host_payouts
   where organization_id = p_org_id and id = p_payout_id
   for update;
  if not found then
    raise exception 'PAYOUT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'VOIDED' then
    raise exception 'PAYOUT_ALREADY_VOIDED';
  end if;

  update public.host_payouts
     set status = 'VOIDED',
         voided_by = auth.uid(),
         voided_at = now(),
         void_reason = trim(p_reason)
   where id = p_payout_id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'HOST_PAYOUT_VOIDED', 'host_payout', v_row.id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', trim(p_reason))
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'VOID_HOST_PAYOUT', v_fingerprint,
    'host_payout', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- Internal helpers are never client-callable.
revoke all on function public.begin_staff_command(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_staff_command(uuid, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assert_wage_rate(numeric) from public, anon, authenticated;
revoke all on function public.compute_earned_amount(public.compensation_method, numeric, timestamptz, timestamptz, integer) from public, anon, authenticated;

-- Public command grants (role checks are repeated inside each SECURITY DEFINER fn).
revoke all on function
  public.record_staff_attendance(uuid, uuid, uuid, uuid, date, public.staff_shift, timestamptz, timestamptz, integer, public.attendance_status, public.compensation_method, numeric, text, uuid),
  public.void_staff_attendance(uuid, uuid, text, uuid),
  public.record_staff_advance(uuid, uuid, numeric, date, text, uuid),
  public.void_staff_advance(uuid, uuid, text, uuid),
  public.record_host_payout(uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid),
  public.void_host_payout(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function
  public.record_staff_attendance(uuid, uuid, uuid, uuid, date, public.staff_shift, timestamptz, timestamptz, integer, public.attendance_status, public.compensation_method, numeric, text, uuid),
  public.void_staff_attendance(uuid, uuid, text, uuid),
  public.record_staff_advance(uuid, uuid, numeric, date, text, uuid),
  public.void_staff_advance(uuid, uuid, text, uuid),
  public.record_host_payout(uuid, uuid, uuid, numeric, date, public.payment_method, text, text, uuid),
  public.void_host_payout(uuid, uuid, text, uuid)
  to authenticated;
