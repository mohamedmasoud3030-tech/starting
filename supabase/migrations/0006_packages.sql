-- ============================================================================
-- 0006 — Packages (reusable templates)
-- A package is a TEMPLATE. Package lines reference catalog items and carry a
-- template quantity. Historical event pricing will NOT depend on these rows
-- (events will snapshot prices into their own lines in a later slice).
--
-- Cross-organization integrity is enforced structurally: package_items carries
-- organization_id and uses composite foreign keys so a package can only
-- reference a catalog item in the SAME organization.
-- ============================================================================

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  name_en text,
  description text,
  status package_status not null default 'ACTIVE',
  -- Optional reference guest count for future scaling hints (not a rules engine).
  base_guest_count int check (base_guest_count is null or base_guest_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packages_org_id_unique unique (organization_id, id)
);

create index packages_organization_id_idx on public.packages (organization_id);

create trigger packages_set_updated_at
  before update on public.packages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Package template lines
-- ---------------------------------------------------------------------------
create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  package_id uuid not null,
  catalog_item_id uuid not null,
  quantity numeric(12,3) not null default 1
    constraint package_items_quantity_nonnegative check (quantity >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_items_package_org_fk
    foreign key (package_id, organization_id)
    references public.packages (id, organization_id)
    on delete cascade,
  constraint package_items_catalog_org_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items (id, organization_id)
    on delete restrict,
  constraint package_items_package_item_unique unique (package_id, catalog_item_id)
);

create index package_items_package_id_idx on public.package_items (package_id);
create index package_items_catalog_item_id_idx on public.package_items (catalog_item_id);

create trigger package_items_set_updated_at
  before update on public.package_items
  for each row execute function public.set_updated_at();
