-- S3 staff scheduling and reusable-equipment reservation schema.
create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  whatsapp text,
  staff_type public.staff_type not null,
  is_active boolean not null default true,
  default_compensation_method public.compensation_method not null,
  default_rate numeric(12,3) not null check (default_rate >= 0),
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,id)
);
create trigger staff_members_set_updated_at before update on public.staff_members for each row execute function public.set_updated_at();

create table public.event_staff_assignments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  event_id uuid not null, staff_member_id uuid not null,
  assignment_role public.staff_type not null,
  scheduled_start timestamptz not null, scheduled_end timestamptz not null,
  compensation_method public.compensation_method not null,
  rate numeric(12,3) not null check(rate >= 0), expected_compensation numeric(14,3) not null check(expected_compensation >= 0),
  status public.assignment_status not null default 'ACTIVE', notes text,
  idempotency_key uuid not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  check(scheduled_end > scheduled_start),
  foreign key(organization_id,event_id) references public.events(organization_id,id) on delete cascade,
  foreign key(organization_id,staff_member_id) references public.staff_members(organization_id,id) on delete restrict,
  unique(organization_id,idempotency_key),
  exclude using gist (organization_id with =, staff_member_id with =, tstzrange(scheduled_start,scheduled_end,'[)') with &&) where (status='ACTIVE')
);

create table public.equipment_capacity (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  catalog_item_id uuid not null, total_quantity int not null check(total_quantity >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(organization_id,catalog_item_id) references public.catalog_items(organization_id,id) on delete restrict,
  unique(organization_id,id), unique(organization_id,catalog_item_id)
);
create trigger equipment_capacity_set_updated_at before update on public.equipment_capacity for each row execute function public.set_updated_at();

create table public.event_equipment_reservations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  event_id uuid not null, equipment_capacity_id uuid not null,
  quantity int not null check(quantity > 0), reserved_from timestamptz not null, reserved_until timestamptz not null,
  status public.reservation_status not null default 'ACTIVE', idempotency_key uuid not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  check(reserved_until > reserved_from),
  foreign key(organization_id,event_id) references public.events(organization_id,id) on delete cascade,
  foreign key(organization_id,equipment_capacity_id) references public.equipment_capacity(organization_id,id) on delete restrict,
  unique(organization_id,idempotency_key)
);
create index equipment_reservations_overlap_idx on public.event_equipment_reservations(equipment_capacity_id,reserved_from,reserved_until) where status='ACTIVE';
