-- S1-S3 production schema. The imported prototype is reference-only.
create extension if not exists btree_gist;

create type public.event_status as enum ('DRAFT','QUOTED','CONFIRMED','PREPARING','DISPATCHED','IN_PROGRESS','RETURNING','CLOSED','CANCELLED');
create type public.quotation_status as enum ('ISSUED','ACCEPTED','SUPERSEDED');
create type public.staff_type as enum ('HOST','HOSTESS','SUPERVISOR','DRIVER','WAREHOUSE','OTHER');
create type public.compensation_method as enum ('PER_EVENT','PER_HOUR','PER_DAY','MANUAL');
create type public.assignment_status as enum ('ACTIVE','RELEASED','CANCELLED');
create type public.reservation_status as enum ('ACTIVE','RELEASED','CANCELLED');

alter table public.customers add constraint customers_org_id_unique unique (organization_id,id);

create table public.document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('EVENT','QUOTATION')),
  year int not null,
  last_value bigint not null default 0,
  primary key (organization_id,kind,year)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  event_number text not null,
  title text not null check (length(trim(title)) > 0),
  event_type text not null default 'OTHER',
  start_at timestamptz not null,
  end_at timestamptz not null,
  guest_count int not null check (guest_count > 0),
  venue_name text not null,
  location_details text,
  contact_name text,
  contact_phone text,
  notes text,
  status public.event_status not null default 'DRAFT',
  cancellation_reason text,
  accepted_quotation_id uuid,
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_valid_window check (end_at > start_at),
  constraint events_customer_org_fk foreign key (organization_id,customer_id) references public.customers(organization_id,id) on delete restrict,
  constraint events_org_id_unique unique (organization_id,id),
  constraint events_org_number_unique unique (organization_id,event_number),
  constraint events_org_idempotency_unique unique (organization_id,idempotency_key)
);
create index events_org_start_idx on public.events(organization_id,start_at desc);
create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();

create table public.event_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  event_id uuid not null,
  from_status public.event_status,
  to_status public.event_status not null,
  reason text,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id,event_id) references public.events(organization_id,id) on delete cascade
);
create index event_history_event_idx on public.event_status_history(event_id,created_at);

