-- ============================================================================
-- 0066 — Operational transition override (Phase C)
--
-- Keeps the existing Event state machine (DRAFT→QUOTED→CONFIRMED→PREPARING→
-- DISPATCHED→IN_PROGRESS→RETURNING→CLOSED + CANCELLED) UNCHANGED. This only
-- adds an explicit, audited override for the one transition where the real
-- business sometimes has to proceed with an incomplete team/equipment:
-- PREPARING → DISPATCHED.
--
-- The database remains the single authority. When readiness is not READY the
-- transition REQUIRES a non-empty override reason; the override is recorded in
-- an append-only table plus the audit trail (who, when, from→to, why). Closing
-- (RETURNING → CLOSED) keeps its hard blocks (outstanding equipment/consumables).
--
-- No status is renamed and no existing flow is broken: the new parameter has a
-- default and the existing callers (p_to, p_reason) continue to work.
-- ============================================================================

create table public.event_transition_overrides (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  event_id uuid not null,
  from_status public.event_status not null,
  to_status public.event_status not null,
  reason text not null check (length(trim(reason)) >= 3),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete cascade
);

create index event_transition_overrides_event_idx
  on public.event_transition_overrides (organization_id, event_id, created_at);

alter table public.event_transition_overrides enable row level security;

create policy "event_transition_overrides_select_member"
  on public.event_transition_overrides
  for select using (public.is_org_member(organization_id));

revoke all on table public.event_transition_overrides from anon;
grant select on table public.event_transition_overrides to authenticated;

-- Replace the 0058 version (same 3 leading arg types) rather than adding a
-- second overload: `create or replace` would otherwise leave the old 4-arg
-- signature alongside the new 5-arg one and make 3-positional calls ambiguous.
drop function if exists public.transition_event_status(uuid, uuid, public.event_status, text);

create or replace function public.transition_event_status(
  p_org_id uuid,
  p_event_id uuid,
  p_to public.event_status,
  p_reason text default null,
  p_override_reason text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.events;
  v_allowed boolean;
  v_from public.event_status;
  v_out numeric;
  v_readiness_status text;
begin
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role,'MANAGER'::public.app_role,'SUPERVISOR'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  select * into v from public.events where organization_id=p_org_id and id=p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_to='CANCELLED' then raise exception 'USE_CANCEL_EVENT'; end if;

  v_from := v.status;
  v_allowed := (v.status,p_to) in (('CONFIRMED','PREPARING'),('PREPARING','DISPATCHED'),('DISPATCHED','IN_PROGRESS'),('IN_PROGRESS','RETURNING'),('RETURNING','CLOSED'));
  if not v_allowed then raise exception 'INVALID_EVENT_TRANSITION: % -> %', v.status, p_to; end if;

  if p_to = 'CLOSED' then
    v_out := coalesce((public.event_warehouse_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE'; end if;
    v_out := coalesce((public.event_consumable_summary(p_org_id, p_event_id)->>'outstanding')::numeric, 0);
    if v_out > 0 then raise exception 'CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE'; end if;
  end if;

  -- Readiness gate: dispatching with missing resources requires an explicit,
  -- audited override. Readiness is derived (staff/equipment), never a status.
  if p_to = 'DISPATCHED' then
    v_readiness_status := coalesce(public.event_readiness(p_org_id, p_event_id)->>'status', 'READY');
    if v_readiness_status <> 'READY' and nullif(trim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'READINESS_OVERRIDE_REQUIRED' using errcode = '23514';
    end if;
  end if;

  update public.events set status=p_to, updated_by=auth.uid() where id=v.id returning * into v;
  insert into public.event_status_history(organization_id,event_id,from_status,to_status,actor_id,reason) values(p_org_id,v.id,v_from,p_to,auth.uid(),p_reason);

  if p_to = 'DISPATCHED' and nullif(trim(coalesce(p_override_reason, '')), '') is not null then
    insert into public.event_transition_overrides(organization_id,event_id,from_status,to_status,reason,actor_id)
    values(p_org_id, v.id, v_from, p_to, trim(p_override_reason), auth.uid());
    perform public.record_audit(p_org_id, 'EVENT_TRANSITION_OVERRIDDEN', 'event', v.id::text,
      jsonb_build_object('from', v_from::text, 'to', p_to::text, 'reason', trim(p_override_reason)));
  end if;

  return v;
end;
$$;
