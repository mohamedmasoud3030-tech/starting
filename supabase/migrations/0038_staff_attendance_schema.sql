-- ============================================================================
-- 0038 — S9 staff attendance & host payroll — schema
--
-- The largest still-missing operational slice: fixed attendance/check-in-out
-- per staff assignment (Morning/Evening shifts, two shifts per day), exact
-- wage computation (per hour / per day / per event / manual) in OMR 3dp,
-- salary advances (السلف) and actual host payouts (المدفوع), all as immutable
-- append-only financial facts with guarded VOID transitions.
--
-- All money is exact OMR numeric(12,3) / numeric(14,3); no binary floating
-- point arithmetic is ever persisted. Hours are derived from an exact integer
-- second count (EXTRACT EPOCH cast to integer) — never from a rounded float.
-- ============================================================================

create type public.staff_shift as enum ('MORNING', 'EVENING');

create type public.attendance_status as enum (
  'PRESENT',   -- حضر وسجّل دخول وخروج
  'LATE',      -- حضر متأخراً (سجّل وقت دخول بعد موعد البداية المجدول)
  'PARTIAL',   -- حضر جزءاً من الوردية
  'ABSENT'     -- غائب (بدون ساعات ولا مستحق)
);

create type public.host_payment_status as enum ('RECORDED', 'VOIDED');

-- ---------------------------------------------------------------------------
-- Shared command idempotency register (mirrors the S5/S6 pattern).
-- ---------------------------------------------------------------------------
create table public.staff_payroll_command_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  command_name text not null check (length(trim(command_name)) > 0),
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  result_entity text not null check (length(trim(result_entity)) > 0),
  result_id uuid not null,
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- staff_attendance — one immutable record per (assignment, day, shift).
-- A host may have two rows on the same day (MORNING + EVENING). ABSENT rows
-- carry no hours and no earned amount.
-- ---------------------------------------------------------------------------
create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  staff_member_id uuid not null,
  assignment_id uuid,
  attendance_date date not null,
  shift public.staff_shift not null,
  check_in timestamptz,
  check_out timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  hours_worked numeric(6,3) not null default 0 check (hours_worked >= 0),
  status public.attendance_status not null,
  wage_method public.compensation_method not null,
  wage_rate numeric(12,3) not null check (wage_rate >= 0),
  earned_amount numeric(14,3) not null default 0 check (earned_amount >= 0),
  notes text,
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint staff_attendance_org_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint staff_attendance_org_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members(organization_id, id) on delete restrict,
  constraint staff_attendance_org_assignment_fk
    foreign key (organization_id, assignment_id)
    references public.event_staff_assignments(organization_id, id) on delete restrict,
  constraint staff_attendance_org_id_unique unique (organization_id, id),
  constraint staff_attendance_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint staff_attendance_void_shape check (
    (status = 'ABSENT'
      and check_in is null
      and check_out is null)
    or (status <> 'ABSENT'
      and check_in is not null
      and check_out is not null
      and check_out > check_in)
  ),
  constraint staff_attendance_void_lifecycle check (
    (voided_by is null and voided_at is null and void_reason is null)
    or (voided_by is not null and voided_at is not null
        and length(trim(coalesce(void_reason, ''))) >= 3)
  )
);

create index staff_attendance_event_idx
  on public.staff_attendance (organization_id, event_id, attendance_date, id);
create index staff_attendance_staff_idx
  on public.staff_attendance (organization_id, staff_member_id, attendance_date, id);

-- ---------------------------------------------------------------------------
-- staff_advances — salary advances (السلف) given to a host. Immutable.
-- ---------------------------------------------------------------------------
create table public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_member_id uuid not null,
  amount numeric(12,3) not null check (amount > 0),
  advance_date date not null,
  reason text,
  status public.host_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint staff_advances_org_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members(organization_id, id) on delete restrict,
  constraint staff_advances_org_id_unique unique (organization_id, id),
  constraint staff_advances_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint staff_advances_void_shape check (
    (status = 'VOIDED'
      and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED'
      and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index staff_advances_staff_idx
  on public.staff_advances (organization_id, staff_member_id, advance_date, id);

-- ---------------------------------------------------------------------------
-- host_payouts — actual cash/bank settlement paid to a host (المدفوع).
-- Distinct from advances: an advance is money lent against future earnings;
-- a payout is money actually handed over as wage settlement. Immutable.
-- ---------------------------------------------------------------------------
create table public.host_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_member_id uuid not null,
  event_id uuid,
  amount numeric(12,3) not null check (amount > 0),
  payout_date date not null,
  payment_method public.payment_method not null,
  reference text,
  reason text,
  status public.host_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint host_payouts_org_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members(organization_id, id) on delete restrict,
  constraint host_payouts_org_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint host_payouts_org_id_unique unique (organization_id, id),
  constraint host_payouts_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint host_payouts_void_shape check (
    (status = 'VOIDED'
      and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED'
      and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index host_payouts_staff_idx
  on public.host_payouts (organization_id, staff_member_id, payout_date, id);

-- ---------------------------------------------------------------------------
-- Structural history guards: financial facts are immutable; the only permitted
-- mutation is a deliberate RECORDED -> VOIDED transition performed by the
-- server-authoritative command. A destructive DELETE is always rejected.
-- ---------------------------------------------------------------------------
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
    or new.status is distinct from old.status
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

create trigger staff_attendance_guard
  before update or delete on public.staff_attendance
  for each row execute function public.staff_attendance_guard();

create or replace function public.staff_advance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'STAFF_ADVANCE_APPEND_ONLY' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'RECORDED' and new.status = 'VOIDED') then
    raise exception 'INVALID_ADVANCE_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.staff_member_id is distinct from old.staff_member_id
    or new.amount is distinct from old.amount
    or new.advance_date is distinct from old.advance_date
    or new.reason is distinct from old.reason
    or new.recorded_by is distinct from old.recorded_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.created_at is distinct from old.created_at
  then
    raise exception 'STAFF_ADVANCE_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger staff_advances_guard
  before update or delete on public.staff_advances
  for each row execute function public.staff_advance_guard();

create or replace function public.host_payout_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'HOST_PAYOUT_APPEND_ONLY' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'RECORDED' and new.status = 'VOIDED') then
    raise exception 'INVALID_PAYOUT_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.staff_member_id is distinct from old.staff_member_id
    or new.event_id is distinct from old.event_id
    or new.amount is distinct from old.amount
    or new.payout_date is distinct from old.payout_date
    or new.payment_method is distinct from old.payment_method
    or new.reference is distinct from old.reference
    or new.reason is distinct from old.reason
    or new.recorded_by is distinct from old.recorded_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.created_at is distinct from old.created_at
  then
    raise exception 'HOST_PAYOUT_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger host_payouts_guard
  before update or delete on public.host_payouts
  for each row execute function public.host_payout_guard();

create or replace function public.staff_payroll_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'STAFF_PAYROLL_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger staff_payroll_command_idempotency_append_only
  before update or delete on public.staff_payroll_command_idempotency
  for each row execute function public.staff_payroll_append_only_guard();
