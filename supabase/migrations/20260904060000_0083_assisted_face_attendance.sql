-- ============================================================================
-- 0083 — Assisted face-matching attendance + wage-free attendance commands.
--
-- THE MODEL (honest by construction):
--   * Face matching is an IDENTIFICATION AID. A (server-recorded) match never
--     creates or mutates attendance by itself: the office user confirms, and
--     the CONFIRMING command (clock_staff_in/out) validates everything again
--     server-side — including that the single-use match attempt still exists,
--     belongs to THIS event + staff + action, and is fresh (< 5 minutes).
--   * NO biometric data is ever stored on the server. Enrollment rows hold
--     only opaque metadata (provider code, model version, capture count, and
--     an opaque device-local template reference token). Training frames never
--     leave the device; attendance EVIDENCE photos go to the private bucket
--     through the mature 0074 attachment architecture (append-only, org-first
--     path, no public exposure, reclaim lifecycle inherited).
--   * There is deliberately NO recognition engine shipped here. The provider
--     registry on the client ships ZERO production providers; until a real,
--     safe provider is deployed the UI says so and the manual path remains
--     fully first-class. No fake/confidence values can ever exist: a match
--     attempt row can only be written by a client whose provider registry is
--     active, and the server never invents any.
--
-- ALSO IN THIS MIGRATION (same domain, forward-only):
--   * `record_staff_attendance` loses its wage parameters: wage method/rate
--     are DERIVED server-side exactly like the clock path (assignment
--     override → staff default), so no caller can smuggle client-side wage
--     computation into the ledger — one canonical calculation chain (0039
--     compute_earned_amount) for every entry point.
--   * `event_attendance_status`: wage-free operational attendance read for
--     the clock/panel surfaces (attendance.record OR any finance reader),
--     with method + evidence flags + confirming user surfaced as metadata.
--
-- Payroll NEVER reads confidence, attempts or enrollments — only confirmed
-- `staff_attendance` rows. The biometric columns are audit metadata only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums.
-- ---------------------------------------------------------------------------
create type public.attendance_method as enum ('MANUAL', 'FACE_ASSISTED');
create type public.face_match_status as enum ('MATCHED', 'CONSUMED', 'REJECTED', 'EXPIRED');
create type public.face_enrollment_status as enum ('ACTIVE', 'REVOKED');

-- ---------------------------------------------------------------------------
-- staff_face_enrollments — opaque enrollment METADATA only.
-- ---------------------------------------------------------------------------
create table public.staff_face_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_member_id uuid not null,
  provider_code text not null check (length(trim(provider_code)) between 1 and 64),
  model_version text not null check (length(trim(model_version)) between 1 and 64),
  -- Opaque token pointing at the DEVICE-LOCAL descriptor store. It is not a
  -- secret and not biometric data; the bytes it "references" never existed on
  -- this server and the server could not read them if they did.
  template_ref text not null check (length(template_ref) between 1 and 128),
  capture_count int not null check (capture_count between 1 and 64),
  status public.face_enrollment_status not null default 'ACTIVE',
  enrolled_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_face_enrollments_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members (organization_id, id) on delete cascade,
  -- At most one enrollment per host (re-enrollment supersedes in place).
  constraint staff_face_enrollments_one_per_staff unique (organization_id, staff_member_id)
);

create index staff_face_enrollments_active_idx
  on public.staff_face_enrollments (organization_id, staff_member_id)
  where status = 'ACTIVE';

alter table public.staff_face_enrollments enable row level security;
-- NO policies and NO table grants: enrollment metadata is reachable ONLY
-- through the RPCs below (SECURITY DEFINER, org-gated). The device does not
-- need read access to the token — it stores descriptors locally. The explicit
-- revokes below defeat Supabase's default-privilege grants for anon and
-- authenticated (the same posture public_demo_removal enforces repo-wide).
revoke all on table public.staff_face_enrollments from anon;
revoke all on table public.staff_face_enrollments from authenticated;

-- ---------------------------------------------------------------------------
-- face_match_attempts — transient, single-use server-validated match records.
-- ---------------------------------------------------------------------------
create table public.face_match_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  staff_member_id uuid not null,
  action text not null check (action in ('CHECK_IN', 'CHECK_OUT')),
  provider_code text not null,
  -- Human-readable relaying of what the PROVIDER reported (e.g. "0.94").
  -- TEXT on purpose: the server never re-derives, thresholds, or computes
  -- anything from it, and payroll never reads this table at all.
  confidence_label text,
  status public.face_match_status not null default 'MATCHED',
  attempted_by uuid not null references auth.users(id),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint face_match_attempts_event_fk
    foreign key (organization_id, event_id)
    references public.events (organization_id, id) on delete cascade,
  constraint face_match_attempts_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members (organization_id, id) on delete cascade
);

create index face_match_attempts_lookup_idx
  on public.face_match_attempts (organization_id, event_id, staff_member_id, status, created_at desc);

alter table public.face_match_attempts enable row level security;
-- Same rule: no direct access at all; commands only.
revoke all on table public.face_match_attempts from anon;
revoke all on table public.face_match_attempts from authenticated;

-- Retention: attempts are audit-transient. Expire (never delete silently)
-- anything older than the single-use window so abandoned dialogs age out.
create or replace function public.expire_face_match_attempts(p_org_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  with expired as (
    update public.face_match_attempts
       set status = 'EXPIRED'
     where organization_id = p_org_id
       and status = 'MATCHED'
       and created_at < now() - interval '5 minutes'
    returning 1
  )
  select count(*)::int into v_n from expired;
  return v_n;
end;
$$;

revoke all on function public.expire_face_match_attempts(uuid) from public, anon;
grant execute on function public.expire_face_match_attempts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_attendance: HOW each side of the punch happened (method + who
-- confirmed + which match attempt, if any). All nullable-with-safe-default so
-- every pre-0083 row reads as MANUAL — history is never rewritten.
-- ---------------------------------------------------------------------------
alter table public.staff_attendance
  add column check_in_method public.attendance_method not null default 'MANUAL',
  add column check_out_method public.attendance_method not null default 'MANUAL',
  add column confirmed_by uuid references auth.users(id),
  add column match_attempt_id uuid;

comment on column public.staff_attendance.check_in_method is
  'MANUAL = office user selected the host from the roster; FACE_ASSISTED = the match CANDIDATE was presented by a provider and CONFIRMED BY THE OFFICE USER. Payroll is identical either way.';
comment on column public.staff_attendance.match_attempt_id is
  'Audit link to the single-use face_match_attempts row revalidated at confirmation. Not read by payroll, ever.';

-- ---------------------------------------------------------------------------
-- Enrollment commands (staff.manage only — enrollment is a personnel action,
-- not an operational one).
-- ---------------------------------------------------------------------------
create or replace function public.enroll_staff_face(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_provider_code text,
  p_model_version text,
  p_template_ref text,
  p_capture_count int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_face_enrollments;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'staff.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.staff_members s
    where s.organization_id = p_org_id and s.id = p_staff_member_id
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.staff_face_enrollments (
    organization_id, staff_member_id, provider_code, model_version,
    template_ref, capture_count, status, enrolled_by
  ) values (
    p_org_id, p_staff_member_id, trim(p_provider_code), trim(p_model_version),
    trim(p_template_ref), p_capture_count, 'ACTIVE', auth.uid()
  )
  on conflict (organization_id, staff_member_id) do update
     set provider_code = excluded.provider_code,
         model_version = excluded.model_version,
         template_ref = excluded.template_ref,
         capture_count = excluded.capture_count,
         status = 'ACTIVE',
         revoked_at = null,
         revoke_reason = null,
         enrolled_by = excluded.enrolled_by,
         updated_at = now()
  returning * into v_row;

  -- A new enrollment invalidates any prior pending matches for this host.
  update public.face_match_attempts
     set status = 'REJECTED'
   where organization_id = p_org_id
     and staff_member_id = p_staff_member_id
     and status = 'MATCHED';

  perform public.record_audit(
    p_org_id, 'STAFF_FACE_ENROLLED', 'staff_member', p_staff_member_id::text,
    jsonb_build_object('provider', v_row.provider_code, 'model', v_row.model_version,
                       'captures', v_row.capture_count)
  );
  return jsonb_build_object(
    'status', v_row.status,
    'provider_code', v_row.provider_code,
    'model_version', v_row.model_version,
    'capture_count', v_row.capture_count,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.enroll_staff_face(uuid, uuid, text, text, text, int) from public, anon;
grant execute on function public.enroll_staff_face(uuid, uuid, text, text, text, int) to authenticated;

create or replace function public.revoke_staff_face(
  p_org_id uuid,
  p_staff_member_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'staff.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  update public.staff_face_enrollments
     set status = 'REVOKED',
         revoked_at = now(),
         revoke_reason = nullif(trim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where organization_id = p_org_id and staff_member_id = p_staff_member_id;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Revocation MUST invalidate outstanding matches immediately.
  update public.face_match_attempts
     set status = 'REJECTED'
   where organization_id = p_org_id
     and staff_member_id = p_staff_member_id
     and status = 'MATCHED';

  perform public.record_audit(
    p_org_id, 'STAFF_FACE_REVOKED', 'staff_member', p_staff_member_id::text,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
end;
$$;

revoke all on function public.revoke_staff_face(uuid, uuid, text) from public, anon;
grant execute on function public.revoke_staff_face(uuid, uuid, text) to authenticated;

create or replace function public.get_staff_face_enrollment(
  p_org_id uuid,
  p_staff_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'status', e.status::text,
       'provider_code', e.provider_code,
       'model_version', e.model_version,
       'capture_count', e.capture_count,
       'updated_at', e.updated_at
     )
     from public.staff_face_enrollments e
     where e.organization_id = p_org_id
       and e.staff_member_id = p_staff_member_id),
    jsonb_build_object('status', 'NONE')
  )
  where public.is_org_member(p_org_id);
$$;

revoke all on function public.get_staff_face_enrollment(uuid, uuid) from public, anon;
grant execute on function public.get_staff_face_enrollment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Candidate scope — EXACTLY: org → this event → ACTIVE assignments → hosts
-- with ACTIVE enrollment. A caller cannot enumerate the org's whole roster.
-- ---------------------------------------------------------------------------
create or replace function public.event_attendance_candidates(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  staff_member_id uuid,
  staff_name text,
  assignment_id uuid,
  assignment_role text,
  -- ACTIVE enrollment is the JOIN itself; the flag is relayed for the UI.
  enrollment_active boolean,
  -- Server-computed open-punch state (never client-guessed): a confirming
  -- office user must not accidentally stack a second check-in on a host who
  -- is already inside.
  is_open boolean,
  open_check_in timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.staff_member_id,
    s.name,
    a.id,
    a.assignment_role::text,
    true,
    (o.id is not null),
    o.check_in
  from public.event_staff_assignments a
  join public.staff_members s
    on s.organization_id = a.organization_id and s.id = a.staff_member_id
  join public.staff_face_enrollments e
    on e.organization_id = a.organization_id
   and e.staff_member_id = a.staff_member_id
   and e.status = 'ACTIVE'
  left join lateral (
    select x.id, x.check_in
    from public.staff_attendance x
    where x.organization_id = a.organization_id
      and x.event_id = a.event_id
      and x.staff_member_id = a.staff_member_id
      and x.check_in is not null
      and x.check_out is null
      and x.status <> 'VOIDED'
    order by x.created_at desc
    limit 1
  ) o on true
  where a.organization_id = p_org_id
    and a.event_id = p_event_id
    and a.status = 'ACTIVE'
    and s.is_active
    and public.has_permission(p_org_id, 'attendance.record')
  order by s.name
  limit 12
$$;

revoke all on function public.event_attendance_candidates(uuid, uuid) from public, anon;
grant execute on function public.event_attendance_candidates(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_face_match_attempt — persists ONLY what a REAL provider observed.
--
-- The client never trusts its own candidate choice: this command revalidates
-- server-side that the staff id is (a) actively assigned to this event and
-- (b) ACTIVE-enrolled, or the attempt is refused. An attempt is single-use
-- and short-lived; the attendance mutation itself happens ONLY when the
-- confirming office user completes clock_staff_in/out with this id.
-- ---------------------------------------------------------------------------
create or replace function public.record_face_match_attempt(
  p_org_id uuid,
  p_event_id uuid,
  p_action text,
  p_staff_member_id uuid,
  p_provider_code text,
  p_confidence_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_action not in ('CHECK_IN', 'CHECK_OUT') then
    raise exception 'INVALID_FACE_ACTION' using errcode = '22023';
  end if;

  -- SERVER REVALIDATION of the candidate identity (never trust the client).
  if not exists (
    select 1
    from public.event_staff_assignments a
    join public.staff_members s
      on s.organization_id = a.organization_id and s.id = a.staff_member_id
    join public.staff_face_enrollments e
      on e.organization_id = a.organization_id
     and e.staff_member_id = a.staff_member_id
     and e.status = 'ACTIVE'
     and e.provider_code = trim(p_provider_code)
    where a.organization_id = p_org_id
      and a.event_id = p_event_id
      and a.staff_member_id = p_staff_member_id
      and a.status = 'ACTIVE'
      and s.is_active
  ) then
    raise exception 'CANDIDATE_MISMATCH' using errcode = '23503';
  end if;

  insert into public.face_match_attempts (
    organization_id, event_id, staff_member_id, action,
    provider_code, confidence_label, attempted_by
  ) values (
    p_org_id, p_event_id, p_staff_member_id, p_action,
    trim(p_provider_code),
    left(nullif(trim(coalesce(p_confidence_label, '')), ''), 32),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_face_match_attempt(uuid, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.record_face_match_attempt(uuid, uuid, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Attempt consumption — shared by both clock commands. Returns the attempt id
-- when the punch is face-assisted and VALID; raises on anything stale, used,
-- mismatched, or revoked since. MANUAL passes through untouched.
-- ---------------------------------------------------------------------------
create or replace function public.consume_face_match_attempt(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_action text,
  p_attempt_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.face_match_attempts;
begin
  if p_attempt_id is null then
    return null; -- MANUAL path.
  end if;

  select * into v_attempt
    from public.face_match_attempts
   where organization_id = p_org_id
     and id = p_attempt_id
   for update;
  if not found then
    raise exception 'CANDIDATE_MISMATCH' using errcode = '23503';
  end if;
  if v_attempt.event_id <> p_event_id
     or v_attempt.staff_member_id <> p_staff_member_id
     or v_attempt.action <> p_action then
    raise exception 'CANDIDATE_MISMATCH' using errcode = '23503';
  end if;
  if v_attempt.status = 'CONSUMED' then
    raise exception 'FACE_MATCH_ALREADY_CONSUMED' using errcode = '23505';
  end if;
  if v_attempt.status <> 'MATCHED' then
    raise exception 'FACE_MATCH_NOT_USABLE' using errcode = '23503';
  end if;
  if v_attempt.created_at < now() - interval '5 minutes' then
    update public.face_match_attempts
       set status = 'EXPIRED'
     where id = v_attempt.id;
    raise exception 'FACE_STALE_MATCH' using errcode = 'P0001';
  end if;
  -- Enrollment revoked between match and confirmation → dead candidate.
  if not exists (
    select 1 from public.staff_face_enrollments e
    where e.organization_id = p_org_id
      and e.staff_member_id = p_staff_member_id
      and e.status = 'ACTIVE'
  ) then
    raise exception 'CANDIDATE_MISMATCH' using errcode = '23503';
  end if;

  update public.face_match_attempts
     set status = 'CONSUMED', consumed_at = now()
   where id = v_attempt.id;
  return v_attempt.id;
end;
$$;

revoke all on function public.consume_face_match_attempt(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.consume_face_match_attempt(uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- clock_staff_in / clock_staff_out — same gates, same evidence-first punch,
-- plus (p_attendance_method, p_match_attempt_id). A FACE_ASSISTED row is
-- created ONLY through an office user's confirmation command that survives
-- consume_face_match_attempt revalidation.
-- ---------------------------------------------------------------------------
-- Old (pre-face) signatures dropped first: a defaulted extra parameter must
-- not leave an ambiguity where the client's old call silently skips the face
-- validation path.
drop function if exists public.clock_staff_in(
  uuid, uuid, uuid, uuid, public.staff_shift, text, text, text, text, bigint, uuid
);
drop function if exists public.clock_staff_out(
  uuid, uuid, uuid, text, text, text, text, bigint, uuid
);

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
  p_idempotency_key uuid,
  p_attendance_method public.attendance_method default 'MANUAL',
  p_match_attempt_id uuid default null
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
  v_attempt uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
  end if;

  -- Face-assisted? Revalidate the match NOW (fresh, single-use, correct
  -- target) — the punch is MANUAL unless this succeeds.
  v_attempt := public.consume_face_match_attempt(
    p_org_id, p_event_id, p_staff_member_id, 'CHECK_IN', p_match_attempt_id
  );

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
    'evidence_path', p_evidence_path,
    'attendance_method', p_attendance_method,
    'match_attempt_id', v_attempt
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
    check_in_method, confirmed_by, match_attempt_id,
    idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_event_id, p_staff_member_id, v_assignment_id, v_date,
    v_shift, v_now, null, 0, 0, 'PRESENT',
    v_method, v_rate, 0,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    coalesce(p_attendance_method, 'MANUAL'), auth.uid(), v_attempt,
    p_idempotency_key, v_fingerprint
  ) returning * into v_row;

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
      'selfie', p_evidence_path,
      'attendance_method', coalesce(p_attendance_method, 'MANUAL')::text,
      'match_attempt_id', v_attempt
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_IN', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

revoke all on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, text, text, text, bigint, uuid, public.attendance_method, uuid) from public, anon;
grant execute on function public.clock_staff_in(uuid, uuid, uuid, uuid, public.staff_shift, text, text, text, text, bigint, uuid, public.attendance_method, uuid) to authenticated;

create or replace function public.clock_staff_out(
  p_org_id uuid,
  p_event_id uuid,
  p_staff_member_id uuid,
  p_notes text,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
  p_idempotency_key uuid,
  p_attendance_method public.attendance_method default 'MANUAL',
  p_match_attempt_id uuid default null
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
  v_attempt uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_evidence_path, '')), '') is null then
    raise exception 'SELFIE_REQUIRED' using errcode = '22023';
  end if;

  v_attempt := public.consume_face_match_attempt(
    p_org_id, p_event_id, p_staff_member_id, 'CHECK_OUT', p_match_attempt_id
  );

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'CLOCK_STAFF_OUT',
    'event_id', p_event_id,
    'staff_member_id', p_staff_member_id,
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'evidence_path', p_evidence_path,
    'attendance_method', p_attendance_method,
    'match_attempt_id', v_attempt
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
         check_out_method = coalesce(p_attendance_method, 'MANUAL'),
         confirmed_by = auth.uid(),
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
      'selfie', p_evidence_path,
      'attendance_method', coalesce(p_attendance_method, 'MANUAL')::text,
      'match_attempt_id', v_attempt
    )
  );
  perform public.finish_staff_command(
    p_org_id, p_idempotency_key, 'CLOCK_STAFF_OUT', v_fingerprint,
    'staff_attendance', v_row.id, to_jsonb(v_row)
  );
  return v_row;
end;
$$;

revoke all on function public.clock_staff_out(uuid, uuid, uuid, text, text, text, text, bigint, uuid, public.attendance_method, uuid) from public, anon;
grant execute on function public.clock_staff_out(uuid, uuid, uuid, text, text, text, text, bigint, uuid, public.attendance_method, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_staff_attendance — WAGE-FREE signature. The former p_wage_method /
-- p_wage_rate parameters were a second input path into the payroll ledger;
-- the rate now derives exactly like the clock path (assignment override →
-- staff default → PER_EVENT/0), computed in ONE place. Old signature is
-- dropped so no caller can keep smuggling wages from the client.
-- ---------------------------------------------------------------------------
drop function if exists public.record_staff_attendance(
  uuid, uuid, uuid, uuid, date, public.staff_shift, timestamptz, timestamptz,
  integer, public.attendance_status, public.compensation_method, numeric, text, uuid
);

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
  v_staff public.staff_members;
  v_fingerprint text;
  v_replay jsonb;
  v_hours numeric(6,3) := 0;
  v_earned numeric(14,3) := 0;
  v_break integer := coalesce(p_break_minutes, 0);
  v_assignment_id uuid := p_assignment_id;
  v_assignment_count integer;
  v_wage_method public.compensation_method;
  v_wage_rate numeric(12,3);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'attendance.record') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
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

  -- Canonical wage derivation — the SAME chain as clock_staff_in.
  select * into v_staff
    from public.staff_members
   where organization_id = p_org_id and id = p_staff_member_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;
  select
    coalesce(a.compensation_method, v_staff.default_compensation_method, 'PER_EVENT'::public.compensation_method),
    coalesce(a.rate, v_staff.default_rate, 0)
  into v_wage_method, v_wage_rate
  from public.event_staff_assignments a
  where a.organization_id = p_org_id and a.id = v_assignment_id;
  v_wage_method := coalesce(v_wage_method, v_staff.default_compensation_method, 'PER_EVENT'::public.compensation_method);
  v_wage_rate := coalesce(v_wage_rate, v_staff.default_rate, 0);
  perform public.assert_wage_rate(v_wage_rate);

  -- Preserve 0079 request validation EXACTLY (semantics preserved; only the
  -- wage SOURCE changed — derived server-side, never accepted from the client).
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

  v_earned := public.compute_earned_amount(
    v_wage_method, v_wage_rate, p_check_in, p_check_out, v_break
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
    v_wage_method, v_wage_rate, v_earned,
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

revoke all on function public.record_staff_attendance(uuid, uuid, uuid, uuid, date, public.staff_shift, timestamptz, timestamptz, integer, public.attendance_status, text, uuid) from public, anon;
grant execute on function public.record_staff_attendance(uuid, uuid, uuid, uuid, date, public.staff_shift, timestamptz, timestamptz, integer, public.attendance_status, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- event_attendance_status — the wage-free operational read used by the clock,
-- panels and the command center. Gates: an org member holding attendance
-- record OR any finance visibility (payroll needs the same rows). Staff
-- wage columns NEVER appear in this projection.
-- ---------------------------------------------------------------------------
create or replace function public.event_attendance_status(
  p_org_id uuid,
  p_event_id uuid
)
returns table (
  attendance_id uuid,
  staff_member_id uuid,
  staff_name text,
  assignment_id uuid,
  attendance_date date,
  shift public.staff_shift,
  status public.attendance_status,
  check_in timestamptz,
  check_out timestamptz,
  hours_worked numeric,
  check_in_method public.attendance_method,
  check_out_method public.attendance_method,
  has_checkin_evidence boolean,
  has_checkout_evidence boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.staff_member_id,
    s.name,
    a.assignment_id,
    a.attendance_date,
    a.shift,
    a.status,
    a.check_in,
    a.check_out,
    a.hours_worked,
    a.check_in_method,
    a.check_out_method,
    exists (
      select 1 from public.attachment_evidence e
      where e.organization_id = a.organization_id
        and e.entity_type = 'staff_attendance'
        and e.entity_id = a.id
        and e.evidence_type = 'ATTENDANCE_CHECKIN'
        and e.superseded_at is null
    ),
    exists (
      select 1 from public.attachment_evidence e
      where e.organization_id = a.organization_id
        and e.entity_type = 'staff_attendance'
        and e.entity_id = a.id
        and e.evidence_type = 'ATTENDANCE_CHECKOUT'
        and e.superseded_at is null
    )
  from public.staff_attendance a
  join public.staff_members s on s.organization_id = a.organization_id and s.id = a.staff_member_id
  where a.organization_id = p_org_id
    and a.event_id = p_event_id
    and public.is_org_member(p_org_id)
    and (
      public.has_permission(p_org_id, 'attendance.record')
      or public.can_read_cost(p_org_id)
      or public.can_read_payroll(p_org_id)
    );
$$;

revoke all on function public.event_attendance_status(uuid, uuid) from public, anon;
grant execute on function public.event_attendance_status(uuid, uuid) to authenticated;

-- Index for the status read (per-event attendance listing).
create index if not exists staff_attendance_event_status_idx
  on public.staff_attendance (organization_id, event_id, attendance_date desc, staff_member_id);

-- ---------------------------------------------------------------------------
-- staff_ledger_history — the host profile's chronological financial history.
-- ONE UNION over the REAL ledgers (attendance earnings, advances, payouts),
-- signed balance effects computed IN SQL with the same rules the payroll
-- summary uses (VOIDED rows never move the balance). No second ledger, no
-- client-side reconciliation: this is the canonical data re-projected, not a
-- parallel computation. Payroll-read capability gates the whole read.
-- ---------------------------------------------------------------------------
create or replace function public.staff_ledger_history(
  p_org_id uuid,
  p_staff_member_id uuid
)
returns table (
  kind text,
  occurred_at timestamptz,
  label text,
  event_number text,
  effect numeric(14,3),
  amount numeric(14,3),
  status text,
  void_reason text,
  event_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    x.kind,
    x.occurred_at,
    x.label,
    x.event_number,
    x.effect,
    x.amount,
    x.status,
    x.void_reason,
    x.event_id
  from (
    select
      'ATTENDANCE'::text as kind,
      coalesce(a.check_out, a.check_in, a.created_at) as occurred_at,
      'ورديّة ' || a.attendance_date::text || ' (' || a.shift::text || ')' as label,
      e.event_number::text,
      case when a.status::text = 'VOIDED' then 0 else a.earned_amount end::numeric(14,3) as effect,
      a.earned_amount::numeric(14,3) as amount,
      case when a.status::text = 'VOIDED' then 'VOIDED' else 'RECORDED' end::text as status,
      a.void_reason,
      a.event_id
    from public.staff_attendance a
    left join public.events e on e.organization_id = a.organization_id and e.id = a.event_id
    where a.organization_id = p_org_id and a.staff_member_id = p_staff_member_id

    union all

    select
      'ADVANCE',
      v.advance_date::timestamp at time zone 'Asia/Muscat',
      'سلفة' || coalesce(' — ' || nullif(trim(v.reason), ''), ''),
      null,
      case when v.status = 'VOIDED' then 0 else -v.amount end,
      v.amount,
      v.status::text,
      v.void_reason,
      null
    from public.staff_advances v
    where v.organization_id = p_org_id and v.staff_member_id = p_staff_member_id

    union all

    select
      'PAYOUT',
      w.payout_date::timestamp at time zone 'Asia/Muscat',
      'دفعة' || coalesce(' — ' || nullif(trim(w.reference), ''), ' — ' || nullif(trim(w.reason), ''), ''),
      e2.event_number::text,
      case when w.status = 'VOIDED' then 0 else -w.amount end,
      w.amount,
      w.status::text,
      w.void_reason,
      w.event_id
    from public.host_payouts w
    left join public.events e2 on e2.organization_id = w.organization_id and e2.id = w.event_id
    where w.organization_id = p_org_id and w.staff_member_id = p_staff_member_id
  ) x
  where public.is_org_member(p_org_id)
    and (public.can_read_cost(p_org_id) or public.can_read_payroll(p_org_id))
  order by x.occurred_at desc nulls last, x.kind, x.event_id nulls last, x.amount desc
$$;

revoke all on function public.staff_ledger_history(uuid, uuid) from public, anon;
grant execute on function public.staff_ledger_history(uuid, uuid) to authenticated;
