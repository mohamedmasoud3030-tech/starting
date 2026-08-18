-- ============================================================================
-- 0062 — Commercial engine: price components, validity, versioning columns
--
-- Phase B schema foundation. This file ONLY adds enum values, columns,
-- defaults, backfills and the numbering-prefix helper. It must NOT reference
-- the newly-added enum values in any function body (PostgreSQL forbids using
-- a just-added enum value in the same transaction); the commands that use
-- REJECTED/EXPIRED live in 0063.
--
-- Rules honored:
--   * Every new column is nullable or has a safe default — no invented
--     business values. Existing quotes keep subtotal = total_selling and zero
--     transport/surcharge/discount, so their stored totals are unchanged.
--   * total_selling becomes the GRAND TOTAL (customer pays), derived from
--     subtotal + transport + surcharge - discount. Downstream (payments,
--     invoices, event finance) reads total_selling unchanged.
-- ============================================================================

alter type public.quotation_status add value if not exists 'EXPIRED' after 'ISSUED';
alter type public.quotation_status add value if not exists 'REJECTED' after 'ACCEPTED';

create type public.quotation_discount_type as enum ('NONE', 'FIXED', 'PERCENT');

-- ---------------------------------------------------------------------------
-- Price components, validity and versioning columns
-- ---------------------------------------------------------------------------
alter table public.quotations
  add column subtotal numeric(14,3) not null default 0,
  add column transport_required boolean not null default false,
  add column transport_zone text,
  add column transport_amount numeric(14,3) not null default 0,
  add column transport_note text,
  add column surcharge_amount numeric(14,3) not null default 0,
  add column surcharge_note text,
  add column discount_type public.quotation_discount_type not null default 'NONE',
  add column discount_value numeric(14,3) not null default 0,
  add column discount_amount numeric(14,3) not null default 0,
  add column valid_until timestamptz,
  add column series_id uuid,
  add column superseded_reason text,
  add column rejected_by uuid references auth.users(id),
  add column rejected_at timestamptz,
  add column expired_by uuid references auth.users(id),
  add column expired_at timestamptz;

-- Legacy-safe backfill: for existing quotes the line sum IS the customer
-- total (no transport/discount existed), so subtotal mirrors total_selling.
update public.quotations set subtotal = total_selling;

alter table public.quotations
  add constraint quotations_transport_amount_nonnegative check (transport_amount >= 0),
  add constraint quotations_surcharge_amount_nonnegative check (surcharge_amount >= 0),
  add constraint quotations_discount_value_nonnegative check (discount_value >= 0),
  add constraint quotations_discount_amount_nonnegative check (discount_amount >= 0);

-- Versioning: revisions of one quote share the same quotation_number, so the
-- uniqueness key becomes (organization_id, quotation_number, revision).
alter table public.quotations
  drop constraint quotations_organization_id_quotation_number_key;
alter table public.quotations
  add constraint quotations_org_number_revision_key unique (organization_id, quotation_number, revision);

-- ---------------------------------------------------------------------------
-- Package guest range (recommendation only, never a hard constraint)
-- ---------------------------------------------------------------------------
alter table public.packages
  add column min_guests int,
  add column max_guests int,
  add constraint packages_guest_range_order check (
    min_guests is null or max_guests is null or min_guests <= max_guests
  ),
  add constraint packages_guest_bounds_nonnegative check (
    (min_guests is null or min_guests > 0) and (max_guests is null or max_guests > 0)
  );

-- ---------------------------------------------------------------------------
-- Document numbering derives its prefix from organization settings (AC #1).
-- The passed p_prefix remains a fallback for callers/legacy, but QUOTATION and
-- EVENT resolve from organization_settings when a row exists.
-- ---------------------------------------------------------------------------
create or replace function public.document_number_prefix(p_org_id uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'QUOTATION' then coalesce(nullif(trim(
      (select s.quotation_number_prefix from public.organization_settings s where s.organization_id = p_org_id)
    ), ''), 'QT')
    when 'EVENT' then coalesce(nullif(trim(
      (select s.event_number_prefix from public.organization_settings s where s.organization_id = p_org_id)
    ), ''), 'EV')
    when 'PROCUREMENT_ORDER' then 'PO'
    else 'DOC'
  end;
$$;
revoke all on function public.document_number_prefix(uuid, text) from public, anon, authenticated;

create or replace function public.next_document_number(
  p_org uuid,
  p_kind text,
  p_prefix text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from timezone('Asia/Muscat', now()));
  v_num bigint;
  v_prefix text;
begin
  -- Settings-driven prefix; the explicit argument is only a legacy fallback.
  v_prefix := coalesce(nullif(trim(p_prefix), ''), public.document_number_prefix(p_org, p_kind));
  insert into public.document_sequences(organization_id, kind, year, last_value)
  values (p_org, p_kind, v_year, 1)
  on conflict (organization_id, kind, year)
  do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v_num;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_num::text, 5, '0');
end;
$$;
revoke all on function public.next_document_number(uuid, text, text) from public, anon, authenticated;
