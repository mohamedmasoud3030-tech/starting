-- ============================================================================
-- 0005 — Commercial Catalog
-- Organization-scoped catalog categories and items. Every item keeps a
-- distinct COST price (business cost) and SELLING price (customer price).
-- Monetary values are numeric(12,3) — 3 decimal places, OMR-safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Catalog categories
-- ---------------------------------------------------------------------------
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  name_en text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_categories_org_name_unique unique (organization_id, name),
  -- Composite unique so catalog_items can structurally enforce same-org category.
  constraint catalog_categories_org_id_unique unique (organization_id, id)
);

create index catalog_categories_organization_id_idx
  on public.catalog_categories (organization_id);

create trigger catalog_categories_set_updated_at
  before update on public.catalog_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalog items
-- ---------------------------------------------------------------------------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.catalog_categories(id) on delete set null,
  code text,
  name text not null,
  name_en text,
  description text,
  item_type catalog_item_type not null default 'SERVICE',
  unit text not null default '',
  pricing_method pricing_method not null default 'FIXED',
  cost_price numeric(12,3) not null default 0
    constraint catalog_items_cost_price_nonnegative check (cost_price >= 0),
  selling_price numeric(12,3) not null default 0
    constraint catalog_items_selling_price_nonnegative check (selling_price >= 0),
  status catalog_item_status not null default 'ACTIVE',
  sort_order int not null default 0,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A catalog item must reference a category in the SAME organization.
  -- RESTRICT (not SET NULL) because the composite FK also carries the org.
  -- Category deletion is handled with soft-deactivate (is_active), matching
  -- the "prefer inactive over destructive delete" rule.
  constraint catalog_items_org_category_fk
    foreign key (category_id, organization_id)
    references public.catalog_categories (id, organization_id)
    on delete restrict,
  constraint catalog_items_org_id_unique unique (organization_id, id)
);

create unique index catalog_items_org_code_unique
  on public.catalog_items (organization_id, code)
  where code is not null;

create index catalog_items_organization_id_idx
  on public.catalog_items (organization_id);

create trigger catalog_items_set_updated_at
  before update on public.catalog_items
  for each row execute function public.set_updated_at();
