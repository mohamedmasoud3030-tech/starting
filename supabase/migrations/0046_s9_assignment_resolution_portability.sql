-- ============================================================================
-- 0046 — Portable assignment resolution for S9 attendance.
--
-- The closeout hardening must not depend on min(uuid), which is not a portable
-- PostgreSQL aggregate contract. Count first, then fetch the single UUID.
-- The public RPC signature and behavior are unchanged.
-- ============================================================================

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
    select count(*)::int
      into v_assignment_count
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
    select id
      into strict v_assignment_id
      from public.event_staff_assignments
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and status = 'ACTIVE';
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
