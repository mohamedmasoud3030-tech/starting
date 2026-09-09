-- 0100 — HR upgrade: roster directory fields + staff leaves / absence notices.
--
-- Context (owner workflows):
--   * Work is EVENT-based, not fixed days: a host is called for an event;
--     attendance is recorded per event. There is no daily time-clock.
--   * HR need here is a per-member FILE that contains everything about the
--     person (identity, hiring, contracts, document expiries, leaves &
--     absence notices) in one place.
--   * Leaves/absence are therefore a lightweight RECORD (type + dates +
--     status + reason), not a strict scheduler. EVENT_ABSENCE is used when a
--     member was expected at an event but could not attend.
--
-- Security follows the existing conventions:
--   * staff_members read gate = can_read_cost (0016, unchanged).
--   * Writes gate = has_permission(organization_id,'staff.manage') (0079).
--   * Audit columns recorded_by / decided_by mirror staff_advances (0038).

-- ============================================================================
-- PART A — roster directory fields (all nullable, additive, non-breaking)
-- ============================================================================
alter table public.staff_members
  add column if not exists hire_date date,
  add column if not exists birth_date date,
  add column if not exists nationality text,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists emergency_phone text,
  add column if not exists iban text,
  add column if not exists contract_status text
    not null default 'ACTIVE'
    check (contract_status in ('ACTIVE', 'PROBATION', 'ENDED')),
  add column if not exists civil_id_expires_on date,
  add column if not exists health_card_expires_on date;

comment on column public.staff_members.hire_date is 'تاريخ التعيين (بداية العمل).';
comment on column public.staff_members.contract_status is 'حالة التعاقد: ACTIVE / PROBATION (تحت التجربة) / ENDED (منتهي).';
comment on column public.staff_members.civil_id_expires_on is 'تاريخ انتهاء البطاقة المدنية — يستخدم لتنبيهات انتهاء الوثائق.';
comment on column public.staff_members.health_card_expires_on is 'تاريخ انتهاء البطاقة الصحية / تصريح تداول الأغذية.';

-- ============================================================================
-- PART B — staff leaves / absence notices (non-monetary record table)
-- ============================================================================
create table if not exists public.staff_leaves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_member_id uuid not null,
  leave_type text not null
    check (leave_type in ('ANNUAL', 'SICK', 'EMERGENCY', 'UNPAID', 'EVENT_ABSENCE')),
  start_date date not null,
  end_date date null,
  days_count numeric(5, 1) not null default 1 check (days_count >= 0),
  reason text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  recorded_by uuid not null default auth.uid() references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_leaves_org_staff_fk
    foreign key (organization_id, staff_member_id)
    references public.staff_members(organization_id, id) on delete cascade,
  constraint staff_leaves_org_id_unique unique (organization_id, id),
  constraint staff_leaves_dates_shape check (
    end_date is null or end_date >= start_date
  ),
  constraint staff_leaves_decision_shape check (
    (status in ('PENDING', 'CANCELLED') and decided_by is null and decided_at is null)
    or
    (status in ('APPROVED', 'REJECTED') and decided_by is not null and decided_at is not null)
  )
);

comment on table public.staff_leaves is
  'سجل إجازات وغياب/اعتذارات أعضاء الفريق. النشاط مربوط بالمناسبات لا بأيام دوام ثابتة؛ '
  'EVENT_ABSENCE تعني اعتذاراً عن مناسبة كان العضو متوقعاً فيها.';

create trigger staff_leaves_set_updated_at
  before update on public.staff_leaves
  for each row execute function public.set_updated_at();

alter table public.staff_leaves enable row level security;

-- Read: same gate as the roster the page renders from.
create policy staff_leaves_cost_read
  on public.staff_leaves for select
  using (public.can_read_cost(organization_id));

-- Write: staff.manage holders manage leaves (record + decide + cancel).
create policy staff_leaves_manage
  on public.staff_leaves for all
  using (public.has_permission(organization_id, 'staff.manage'))
  with check (public.has_permission(organization_id, 'staff.manage'));

revoke all on public.staff_leaves from anon;
revoke all on public.staff_leaves from authenticated;
grant select, insert, update on public.staff_leaves to authenticated;
