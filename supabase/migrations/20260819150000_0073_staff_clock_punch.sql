-- ===========================================================================
-- 0073 — Operational clock punch (دخول / خروج) for event staff
--
-- Physical fingerprint hardware is out of scope: hosts work at event venues,
-- not a fixed office gate. This migration lets a supervisor punch IN now and
-- OUT later against the existing attendance ledger without inventing money
-- until the punch is closed.
--
-- Open punch: check_in set, check_out null, hours/earned = 0.
-- Close punch: fills check_out and computes hours + earned (exact OMR).
-- Completed attendance rows stay financially immutable.
-- ===========================================================================

alter table public.staff_attendance
  drop constraint staff_attendance_void_shape;

alter table public.staff_attendance
  add constraint staff_attendance_void_shape check (
    status = 'VOIDED'
    or (
      status = 'ABSENT'
      and check_in is null
      and check_out is null
    )
    or (
      status <> 'ABSENT'
      and check_in is not null
      and (check_out is null or check_out > check_in)
    )
  );

create or replace function public.staff_attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'STAFF_ATTENDANCE_APPEND_ONLY' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status <> 'VOIDED' and new.status = 'VOIDED') then
    raise exception 'INVALID_ATTENDANCE_TRANSITION' using errcode = '23514';
  end if;

  -- Completing an open punch is the only non-void mutation allowed.
  if old.check_out is null
     and old.status <> 'VOIDED'
     and old.status <> 'ABSENT'
     and new.check_out is not null
     and new.check_out > old.check_in
     and new.organization_id is not distinct from old.organization_id
     and new.event_id is not distinct from old.event_id
     and new.staff_member_id is not distinct from old.staff_member_id
     and new.assignment_id is not distinct from old.assignment_id
     and new.attendance_date is not distinct from old.attendance_date
     and new.shift is not distinct from old.shift
     and new.check_in is not distinct from old.check_in
     and new.break_minutes is not distinct from old.break_minutes
     and new.wage_method is not distinct from old.wage_method
     and new.wage_rate is not distinct from old.wage_rate
     and new.recorded_by is not distinct from old.recorded_by
     and new.idempotency_key is not distinct from old.idempotency_key
     and new.request_fingerprint is not distinct from old.request_fingerprint
     and new.created_at is not distinct from old.created_at
     and new.status = old.status
  then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.event_id is distinct from old.event_id
    or new.staff_member_id is distinct from old.staff_member_id
    or new.assignment_id is distinct from old.assignment_id
    or new.attendance_date is distinct from old.attendance_date
    or new.shift is distinct from old.shift
    or new.check_in is distinct from old.check_in
    or new.check_out is distinct from old.check_out
    or new.break_minutes is distinct from old.break_minutes
    or new.hours_worked is distinct from old.hours_worked
    or new.wage_method is distinct from old.wage_method
    or new.wage_rate is distinct from old.wage_rate
    or new.earned_amount is distinct from old.earned_amount
    or new.notes is distinct from old.notes
    or new.recorded_by is distinct from old.recorded_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.created_at is distinct from old.created_at
  then
    raise exception 'STAFF_ATTENDANCE_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.clock_staff_in(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_assignment_id uuid,
  p_shift public.staff_shift,
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
  v_assignment public.event_staff_assignments;
  v_staff public.staff_members;
  v_fingerprint text;
  v_replay jsonb;
  v_assignment_id uuid := p_assignment_id;
  v_assignment_count integer;
  v_now timestamptz := clock_timestamp();
  v_date date;
  v_shift public.staff_shift;
  v_hour integer;
  v_method public.compensation_method;
  v_rate numeric(12,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_date := (v_now at time zone 'Asia/Muscat')::date;
  v_hour := extract(hour from (v_now at time zone 'Asia/Muscat'))::integer;
  v_shift := coalesce(
    p_shift,
    case when v_hour < 16 then 'MORNING'::public.staff_shift
         else 'EVENING'::public.staff_shift end
  );

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_IN',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'assignment_id', p_assignment_id,
    'shift', v_shift,
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
    select count(*)::int, (array_agg(id))[1]
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

  select * into v_assignment
    from public.event_staff_assignments
   where organization_id = p_org_id and id = v_assignment_id;
  select * into v_staff
    from public.staff_members
   where organization_id = p_org_id and id = p_staff_member_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_method := coalesce(v_assignment.compensation_method, v_staff.default_compensation_method, 'PER_EVENT'::public.compensation_method);
  v_rate := coalesce(v_assignment.rate, v_staff.default_rate, 0);
  perform public.assert_wage_rate(v_rate);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_org_id::text || ':' || p_event_id::text || ':' || p_staff_member_id::text ||
      ':' || v_date::text || ':' || v_shift::text,
      3
    )
  );
  if exists (
    select 1
      from public.staff_attendance
     where organization_id = p_org_id
       and event_id = p_event_id
       and staff_member_id = p_staff_member_id
       and attendance_date = v_date
       and shift = v_shift
       and status <> 'VOIDED'
  ) then
    raise exception 'ATTENDANCE_SLOT_ALREADY_RECORDED' using errcode = '23505';
  end if;

  insert into public.staff_attendance (
    organization_id, event_id, staff_member_id, assignment_id, attendance_date,
    shift, check_in, check_out, break_minutes, hours_worked, status,
    wage_method, wage_rate, earned_amount, notes, recorded_by,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, v_assignment_id, v_date,
    v_shift, v_now, null, 0, 0, 'PRESENT',
    v_method, v_rate, 0,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_IN', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'shift', v_shift
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_IN', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

create or replace function public.clock_staff_out(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
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
  v_fingerprint text;
  v_replay jsonb;
  v_now timestamptz := clock_timestamp();
  v_hours numeric(6,3) := 0;
  v_earned numeric(14,3) := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array[
    'OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role
  ]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_OUT',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'notes', nullif(trim(coalesce(p_notes, '')), '')
  ));
  v_replay := public.begin_staff_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.staff_attendance, v_replay);
  end if;

  select * into v_row
    from public.staff_attendance
   where organization_id = p_org_id
     and event_id = p_event_id
     and staff_member_id = p_staff_member_id
     and status <> 'VOIDED'
     and status <> 'ABSENT'
     and check_in is not null
     and check_out is null
   order by check_in desc
   limit 1
   for update;
  if not found then
    raise exception 'CLOCK_IN_REQUIRED';
  end if;
  if v_now <= v_row.check_in then
    raise exception 'CHECKOUT_BEFORE_CHECKIN';
  end if;

  v_hours := round(
    (round(extract(epoch from (v_now - v_row.check_in))::numeric, 0)) / 3600.0, 3
  );
  v_earned := public.compute_earned_amount(
    v_row.wage_method, v_row.wage_rate, v_row.check_in, v_now, v_row.break_minutes
  );

  update public.staff_attendance
     set check_out = v_now,
         hours_worked = v_hours,
         earned_amount = v_earned,
         notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes)
   where id = v_row.id
   returning * into v_row;

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_OUT', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'hours_worked', v_hours::text,
      'earned_amount', v_earned::text
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_OUT', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

revoke all on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, uuid) from public, anon;
revoke all on function public.clock_staff_out(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, uuid) to authenticated;
grant execute on function public.clock_staff_out(uuid, uuid, uuid, text, uuid) to authenticated;
