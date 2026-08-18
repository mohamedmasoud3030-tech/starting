-- ============================================================================
-- 0061 — Organization settings: identity, contact, legal, documents, numbering
--
-- Establishes the entity-identity and document layer the product renders from.
-- The tenant ROOT stays `organizations` (name, currency, timezone, is_active);
-- this table is a 1:1 extension holding everything that identifies the entity
-- on customer-facing documents (quotations, invoices, receipts) and in the app.
--
-- Rules honored:
--   * No commercial information is hard-coded anywhere: every value below is
--     owner-supplied at runtime (the numbering prefixes are technical defaults
--     matching the current EV/QT/PO behavior, not business data).
--   * Writes go through a single OWNER-only command (audited); members may read
--     their own organization's settings (needed to render documents).
--   * Identity data stays OUT of the operational tables — clean separation
--     between entity data, system config, and activity data.
-- ============================================================================

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  -- Identity
  name_en text,
  logo_url text,
  primary_color text,
  accent_color text,

  -- Contact
  phone_primary text,
  phone_secondary text,
  whatsapp text,
  email text,

  -- Legal / address
  commercial_registration text,
  postal_code text,
  po_box text,
  address_line1 text,
  city text,
  region text,
  country text,

  -- Document settings (consumed by the document engine)
  document_terms text,
  document_footer text,

  -- Numbering (technical defaults mirror the current EV/QT/PO prefixes)
  quotation_number_prefix text not null default 'QT',
  invoice_number_prefix text not null default 'INV',
  event_number_prefix text not null default 'EV',

  -- Signature block
  manager_name text,
  manager_title text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_settings_set_updated_at
  before update on public.organization_settings
  for each row execute function public.set_updated_at();

alter table public.organization_settings enable row level security;

create policy "organization_settings_select_member" on public.organization_settings
  for select using (public.is_org_member(organization_id));

-- No client INSERT/UPDATE/DELETE policies: writes are owned by the
-- save_organization_settings command (OWNER only), consistent with the
-- "role checks live in the database" rule.

revoke all on table public.organization_settings from anon;
grant select on table public.organization_settings to authenticated;

-- ---------------------------------------------------------------------------
-- save_organization_settings — OWNER-only upsert (audited).
-- ---------------------------------------------------------------------------
create or replace function public.save_organization_settings(
  p_org_id uuid,
  p_name_en text default null,
  p_logo_url text default null,
  p_primary_color text default null,
  p_accent_color text default null,
  p_phone_primary text default null,
  p_phone_secondary text default null,
  p_whatsapp text default null,
  p_email text default null,
  p_commercial_registration text default null,
  p_postal_code text default null,
  p_po_box text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_region text default null,
  p_country text default null,
  p_document_terms text default null,
  p_document_footer text default null,
  p_quotation_number_prefix text default null,
  p_invoice_number_prefix text default null,
  p_event_number_prefix text default null,
  p_manager_name text default null,
  p_manager_title text default null
)
returns public.organization_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.organization_settings;
  v_prefix_quote text;
  v_prefix_invoice text;
  v_prefix_event text;
begin
  if auth.uid() is null
     or not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Empty strings are normalized to NULL so the UI's cleared fields stay
  -- truly empty (and technical defaults re-apply for numbering prefixes).
  v_prefix_quote  := nullif(trim(coalesce(p_quotation_number_prefix, '')), '');
  v_prefix_invoice := nullif(trim(coalesce(p_invoice_number_prefix, '')), '');
  v_prefix_event  := nullif(trim(coalesce(p_event_number_prefix, '')), '');

  insert into public.organization_settings (
    organization_id, name_en, logo_url, primary_color, accent_color,
    phone_primary, phone_secondary, whatsapp, email,
    commercial_registration, postal_code, po_box, address_line1, city, region, country,
    document_terms, document_footer,
    quotation_number_prefix, invoice_number_prefix, event_number_prefix,
    manager_name, manager_title
  ) values (
    p_org_id,
    nullif(trim(p_name_en), ''),
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_primary_color), ''),
    nullif(trim(p_accent_color), ''),
    nullif(trim(p_phone_primary), ''),
    nullif(trim(p_phone_secondary), ''),
    nullif(trim(p_whatsapp), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_commercial_registration), ''),
    nullif(trim(p_postal_code), ''),
    nullif(trim(p_po_box), ''),
    nullif(trim(p_address_line1), ''),
    nullif(trim(p_city), ''),
    nullif(trim(p_region), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_document_terms), ''),
    nullif(trim(p_document_footer), ''),
    coalesce(v_prefix_quote, 'QT'),
    coalesce(v_prefix_invoice, 'INV'),
    coalesce(v_prefix_event, 'EV'),
    nullif(trim(p_manager_name), ''),
    nullif(trim(p_manager_title), '')
  )
  on conflict (organization_id) do update set
    name_en = excluded.name_en,
    logo_url = excluded.logo_url,
    primary_color = excluded.primary_color,
    accent_color = excluded.accent_color,
    phone_primary = excluded.phone_primary,
    phone_secondary = excluded.phone_secondary,
    whatsapp = excluded.whatsapp,
    email = excluded.email,
    commercial_registration = excluded.commercial_registration,
    postal_code = excluded.postal_code,
    po_box = excluded.po_box,
    address_line1 = excluded.address_line1,
    city = excluded.city,
    region = excluded.region,
    country = excluded.country,
    document_terms = excluded.document_terms,
    document_footer = excluded.document_footer,
    quotation_number_prefix = excluded.quotation_number_prefix,
    invoice_number_prefix = excluded.invoice_number_prefix,
    event_number_prefix = excluded.event_number_prefix,
    manager_name = excluded.manager_name,
    manager_title = excluded.manager_title,
    updated_at = now()
  returning * into v_result;

  perform public.record_audit(
    p_org_id,
    'ORGANIZATION_SETTINGS_SAVED',
    'organization_settings',
    p_org_id::text,
    jsonb_build_object(
      'name_en', v_result.name_en,
      'phone_primary', v_result.phone_primary,
      'commercial_registration', v_result.commercial_registration
    )
  );

  return v_result;
end;
$$;

revoke all on function public.save_organization_settings from public;
revoke all on function public.save_organization_settings from anon, authenticated;
grant execute on function public.save_organization_settings to authenticated;
