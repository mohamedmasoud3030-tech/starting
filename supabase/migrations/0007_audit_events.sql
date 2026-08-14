-- ============================================================================
-- 0007 — Audit events
-- Minimal, append-only audit foundation for sensitive operations.
--
-- SECURITY: record_audit() is INTERNAL ONLY. EXECUTE is revoked from both
-- public and authenticated; it can only be invoked by SECURITY DEFINER
-- commands (which run as the function owner) or triggers. There is no client
-- callable audit path, so a caller cannot forge organization_id or metadata.
-- Audit READ is restricted to OWNER/MANAGER (see 0008).
--
-- Only safe, bounded keys are expected in metadata; no unrestricted sensitive
-- dumps.
-- ============================================================================

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_organization_id_idx on public.audit_events (organization_id);
create index audit_events_entity_idx on public.audit_events (entity, entity_id);

-- ---------------------------------------------------------------------------
-- record_audit — internal-only audit append. The caller's identity is derived
-- from auth.uid() server-side; the organization is passed by an already
-- authorized SECURITY DEFINER caller (never trusted from the client).
-- ---------------------------------------------------------------------------
create or replace function public.record_audit(
  p_org_id uuid,
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (organization_id, user_id, action, entity, entity_id, metadata)
  values (p_org_id, auth.uid(), p_action, p_entity, p_entity_id, p_metadata);
end;
$$;

-- Internal only: no client EXECUTE.
revoke all on function public.record_audit(uuid, text, text, text, jsonb) from public;
revoke all on function public.record_audit(uuid, text, text, text, jsonb) from anon, authenticated;
