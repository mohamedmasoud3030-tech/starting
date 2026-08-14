-- ============================================================================
-- 0033 — S5A Event lifecycle serialization
--
-- Procurement may attach to an Event only while that Event is procureable.
-- The original S5A commands checked Event status with a snapshot read. A
-- concurrent cancel_event() could therefore commit beside create/update/
-- approval. This structural guard moves the check to the procurement-order
-- write edge while holding the Event row lock.
--
-- Lock order remains acyclic:
--   create: idempotency advisory -> supplier -> Event
--   draft update / approval: idempotency advisory -> order -> supplier -> Event
--   Event cancellation: Event only
--
-- Once procurement has progressed beyond approval, later Event cancellation
-- does NOT erase or mutate the external procurement commitment. Procurement
-- must then be cancelled/received explicitly according to its own lifecycle.
-- ============================================================================

create or replace function public.procurement_event_lifecycle_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event_status public.event_status;
begin
  -- Guard only the points where an Event-linked procurement commitment is
  -- created, edited, or approved. Later procurement lifecycle transitions are
  -- intentionally independent so Event cancellation never rewrites supplier
  -- history or blocks explicit procurement resolution.
  if new.event_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE'
         and old.status = 'DRAFT'
         and new.status in ('DRAFT', 'APPROVED')) then
    select e.status
      into v_event_status
      from public.events e
     where e.organization_id = new.organization_id
       and e.id = new.event_id
     for update;

    if not found or v_event_status in ('CLOSED', 'CANCELLED') then
      raise exception 'EVENT_NOT_PROCUREABLE' using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists procurement_orders_event_lifecycle_guard
  on public.procurement_orders;
create trigger procurement_orders_event_lifecycle_guard
  before insert or update on public.procurement_orders
  for each row execute function public.procurement_event_lifecycle_guard();

revoke all on function public.procurement_event_lifecycle_guard()
  from public, anon, authenticated;
