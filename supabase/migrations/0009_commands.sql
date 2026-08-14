-- ============================================================================
-- 0009 — Business commands (safe RPC boundaries)
-- create_organization() is the sanctioned onboarding path: it creates the
-- organization AND the calling user's OWNER membership in one transaction.
-- ============================================================================

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

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text) from public;
revoke all on function public.create_organization(text, text) from anon, authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
