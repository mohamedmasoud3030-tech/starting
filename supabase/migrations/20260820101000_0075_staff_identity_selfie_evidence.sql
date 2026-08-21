-- ============================================================================
-- 0075 — Staff identity documents + selfie-backed attendance clock
--
-- 1. staff_members gains `id_number` (civil/card number) for the roster.
-- 2. The operational punch clock (0073) is upgraded so a check-in / check-out
--    REQUIRES selfie evidence. The selfie is uploaded to the private bucket
--    first, then linked atomically inside the clock command: if the upload is
--    missing, the command fails and no attendance row is written — there is
--    no "silently verified" state.
--
-- The canonical evidence relationship is:
--     attachment_evidence(entity_type='staff_attendance', entity_id=<row id>,
--                          evidence_type=ATTENDANCE_CHECKIN/CHECKOUT)
-- There are deliberately NO attachment id columns on staff_attendance.
-- ============================================================================

alter table public.staff_members
  add column id_number text;

-- ---------------------------------------------------------------------------
-- Selfie-required clock in (replaces the 0073 signature).
-- ---------------------------------------------------------------------------
drop function if exists public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, uuid);

create or replace function public.clock_staff_in(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_assignment_id uuid,
  p_shift public.staff_shift,
  p_notes text,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
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
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
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
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'evidence_path', p_evidence_path
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

  -- Link the selfie in the SAME transaction: a missing/failed upload aborts
  -- the whole punch (no verified attendance without evidence).
  perform public.link_evidence(
    p_org_id, 'ATTENDANCE_CHECKIN', 'staff_attendance', v_row.id,
    p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
  );

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_IN', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'shift', v_shift,
      'selfie', p_evidence_path
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_IN', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Selfie-required clock out (replaces the 0073 signature).
-- ---------------------------------------------------------------------------
drop function if exists public.clock_staff_out(uuid, uuid, uuid, text, uuid);

create or replace function public.clock_staff_out(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_notes text,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
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
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_OUT',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'evidence_path', p_evidence_path
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

  perform public.link_evidence(
    p_org_id, 'ATTENDANCE_CHECKOUT', 'staff_attendance', v_row.id,
    p_evidence_path, p_evidence_file_name, p_evidence_mime_type, p_evidence_size_bytes
  );

  perform public.record_audit(
    p_org_id, 'STAFF_CLOCK_OUT', 'staff_attendance', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'event_id', p_event_id,
      'staff_member_id', p_staff_member_id,
      'hours_worked', v_hours::text,
      'earned_amount', v_earned::text,
      'selfie', p_evidence_path
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_OUT', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

revoke all on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, text, text, text, bigint, uuid) from public, anon;
revoke all on function public.clock_staff_out(uuid, uuid, uuid, text, text, text, text, bigint, uuid) from public, anon;
grant execute on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, text, text, text, bigint, uuid) to authenticated;
grant execute on function public.clock_staff_out(uuid, uuid, uuid, text, text, text, text, bigint, uuid) to authenticated;
