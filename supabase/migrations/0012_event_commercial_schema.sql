-- S2 event pricing snapshots and immutable quotation schema.
create table public.event_commercial_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  source_catalog_item_id uuid,
  source_package_id uuid,
  description text not null check (length(trim(description)) > 0),
  item_type public.catalog_item_type not null,
  unit text not null,
  pricing_method public.pricing_method not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_selling_price numeric(12,3) not null check (unit_selling_price >= 0),
  expected_unit_cost numeric(12,3) not null check (expected_unit_cost >= 0),
  total_selling numeric(14,3) not null check (total_selling >= 0),
  total_expected_cost numeric(14,3) not null check (total_expected_cost >= 0),
  is_custom boolean not null default false,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,event_id) references public.events(organization_id,id) on delete cascade,
  foreign key (organization_id,source_catalog_item_id) references public.catalog_items(organization_id,id) on delete restrict,
  foreign key (organization_id,source_package_id) references public.packages(organization_id,id) on delete restrict,
  unique (organization_id,id)
);
create index event_lines_event_idx on public.event_commercial_lines(event_id,sort_order);
create trigger event_lines_set_updated_at before update on public.event_commercial_lines for each row execute function public.set_updated_at();

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  quotation_number text not null,
  revision int not null check (revision > 0),
  status public.quotation_status not null default 'ISSUED',
  customer_name_snapshot text not null,
  customer_phone_snapshot text,
  event_number_snapshot text not null,
  event_title_snapshot text not null,
  guest_count_snapshot int not null,
  start_at_snapshot timestamptz not null,
  end_at_snapshot timestamptz not null,
  venue_snapshot text not null,
  location_snapshot text,
  terms text,
  notes text,
  total_selling numeric(14,3) not null,
  total_expected_cost numeric(14,3) not null,
  total_expected_profit numeric(14,3) not null,
  idempotency_key uuid not null,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  foreign key (organization_id,event_id) references public.events(organization_id,id) on delete restrict,
  unique (organization_id,id), unique (organization_id,quotation_number),
  unique (event_id,revision), unique (organization_id,idempotency_key)
);

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quotation_id uuid not null,
  description text not null,
  item_type public.catalog_item_type not null,
  unit text not null,
  pricing_method public.pricing_method not null,
  quantity numeric(12,3) not null,
  unit_selling_price numeric(12,3) not null,
  expected_unit_cost numeric(12,3) not null,
  total_selling numeric(14,3) not null,
  total_expected_cost numeric(14,3) not null,
  is_custom boolean not null,
  sort_order int not null,
  foreign key (organization_id,quotation_id) references public.quotations(organization_id,id) on delete restrict
);
create index quotation_lines_quote_idx on public.quotation_lines(quotation_id,sort_order);
alter table public.events add constraint events_accepted_quote_fk foreign key (organization_id,accepted_quotation_id) references public.quotations(organization_id,id) deferrable initially deferred;

