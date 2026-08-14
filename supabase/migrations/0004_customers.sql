-- ============================================================================
-- 0004 — Customers
-- Minimal customer foundation (not a full CRM).
-- ============================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  whatsapp text,
  customer_type customer_type not null default 'INDIVIDUAL',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_organization_id_idx on public.customers (organization_id);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
