-- ============================================================================
-- 0007 — Audit events
-- Minimal, append-only audit foundation for sensitive operations. Only safe,
-- bounded keys are expected in metadata; no unrestricted sensitive dumps.
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
-- record_audit — the sanctioned way to append an audit event. The caller's
-- identity is derived server-side (never trusted from client input).
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

revoke all on function public.record_audit(uuid, text, text, text, jsonb) from public;
grant execute on function public.record_audit(uuid, text, text, text, jsonb) to authenticated;
