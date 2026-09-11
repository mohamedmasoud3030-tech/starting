-- 0103 — Auto-create organization_settings with sane defaults on org creation
-- Ensures day-1 users get QT/INV/EV prefixes and VAT=false without manual save.
-- Idempotent: only inserts if missing.

create or replace function public.create_organization(p_name text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'ORGANIZATION_NAME_REQUIRED';
  end if;

  insert into public.organizations (name, display_name)
  values (trim(p_name), p_display_name)
  returning id into v_org_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_org_id, auth.uid(), 'OWNER', 'ACTIVE');

  -- Auto-create default settings row (if not exists) with valid prefixes and VAT defaults
  insert into public.organization_settings (
    organization_id,
    quotation_number_prefix,
    invoice_number_prefix,
    event_number_prefix,
    vat_registered,
    vat_percent,
    document_footer,
    country
  ) values (
    v_org_id,
    'QT',
    'INV',
    'EV',
    false,
    5.000,
    'شكراً لثقتكم بنا',
    'سلطنة عمان'
  ) on conflict (organization_id) do nothing;

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

comment on function public.create_organization(text, text) is
  'Self-serve first-organization onboarding: caller becomes OWNER + default settings row created.';

-- Backfill existing organizations that have no settings row yet
insert into public.organization_settings (
  organization_id,
  quotation_number_prefix,
  invoice_number_prefix,
  event_number_prefix,
  vat_registered,
  vat_percent,
  document_footer,
  country
)
select
  o.id,
  'QT',
  'INV',
  'EV',
  false,
  5.000,
  'شكراً لثقتكم بنا',
  'سلطنة عمان'
from public.organizations o
left join public.organization_settings s on s.organization_id = o.id
where s.organization_id is null
on conflict (organization_id) do nothing;
