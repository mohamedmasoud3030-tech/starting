-- ============================================================================
-- 0098 — audit_events retention policy (defect D20)
--
-- The append-only audit log had no retention mechanism, so it would grow
-- without bound in production. This migration adds an OWNER-only, per-
-- organization purge command with a documented default cutoff of 24 months.
--
-- Security model:
--   * Only an OWNER of the organization may purge (checked server-side via
--     has_org_role, never trusted from the caller).
--   * The purge is itself recorded in the audit log BEFORE rows are deleted,
--     so a retention action is auditable like any other sensitive command.
--   * No other role, and no anonymous caller, can invoke the command.
--
-- Operational note: the command is manual/schedulable (e.g. pg_cron or an
-- external job). The default cutoff (24 months) is documented in
-- OPERATIONS.md and can be overridden per call with an explicit cutoff.
-- ============================================================================

create or replace function public.purge_old_audit_events(
  p_org_id uuid,
  p_older_than timestamptz default (now() - interval '24 months')
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Record the retention action itself before deleting, so the purge is
  -- auditable (append-only audit discipline).
  perform public.record_audit(
    p_org_id,
    'AUDIT_RETENTION_PURGE',
    'audit_events',
    null,
    jsonb_build_object('older_than', p_older_than)
  );

  delete from public.audit_events
   where organization_id = p_org_id
     and created_at < p_older_than;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_old_audit_events(uuid, timestamptz) from public;
revoke all on function public.purge_old_audit_events(uuid, timestamptz) from anon, authenticated;
grant execute on function public.purge_old_audit_events(uuid, timestamptz) to authenticated;
