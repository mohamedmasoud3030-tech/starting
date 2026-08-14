-- ============================================================================
-- 0001 — Enums
-- Hospitality Operations Platform — Oman
--
-- Note: gen_random_uuid() is a core function since PostgreSQL 13, so no
-- extension is required here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum (
      'OWNER',
      'MANAGER',
      'SUPERVISOR',
      'WAREHOUSE',
      'ACCOUNTANT'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Membership state
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type membership_status as enum ('ACTIVE', 'INACTIVE', 'INVITED');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog item type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'catalog_item_type') then
    create type catalog_item_type as enum (
      'SERVICE',
      'REUSABLE_EQUIPMENT',
      'CONSUMABLE',
      'STAFF',
      'CATERING',
      'TRANSPORT',
      'ADDON',
      'OTHER'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pricing methods (how a default price is expressed)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pricing_method') then
    create type pricing_method as enum (
      'FIXED',
      'PER_EVENT',
      'PER_GUEST',
      'PER_UNIT',
      'PER_HOUR',
      'PER_DAY',
      'MANUAL'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog item status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'catalog_item_status') then
    create type catalog_item_status as enum ('ACTIVE', 'INACTIVE');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Package status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'package_status') then
    create type package_status as enum ('ACTIVE', 'INACTIVE');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Customer type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_type') then
    create type customer_type as enum ('INDIVIDUAL', 'COMPANY', 'GOVERNMENT');
  end if;
end $$;
