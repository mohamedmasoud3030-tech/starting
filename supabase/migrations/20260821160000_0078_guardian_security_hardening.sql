-- ============================================================================
-- 0078 — Database Guardian security hardening
-- ----------------------------------------------------------------------------
-- Fixes the real findings of the first Guardian run (2026-08-21):
--
-- G-0001 (HIGH)  save_organization_settings (SECURITY DEFINER) became
--                PUBLIC-executable when migration 0077 created a NEW function
--                object (VAT params added) without re-applying the 0061
--                revoke/grant. The body self-guards, but least privilege
--                requires anon EXECUTE to be denied.
-- G-0002 (HIGH)  transition_event_status (SECURITY DEFINER) became
--                PUBLIC-executable when migration 0066 dropped and recreated
--                the function with a new signature (override_reason).
-- G-0003 (HIGH)  guard_event_financially_closed (SECURITY DEFINER trigger
--                helper) was PUBLIC-executable (default ACL).
-- G-0004 (MEDIUM) invoice_summaries / host_event_payroll_summaries /
--                host_payout_allocation_summaries are definer-security views
--                (not security_invoker). They ARE org-filtered in their bodies
--                (WHERE can_read_cost(...)) and behaviorally verified by
--                guardian_tenant_isolation.test.sql; converting them to
--                security_invoker would require widening raw-table grants to
--                authenticated, which the design deliberately avoids. The
--                Guardian enforces the hard invariant instead: every view body
--                MUST carry an org filter (guardian_schema_contract.test.sql),
--                so dropping the filter becomes a CRITICAL regression.
-- G-0006 (HIGH)  event_expenses allowed hard DELETE/UPDATE of expense rows
--                while the event was NOT financially closed (only the
--                closure guard existed).
-- G-0007 (HIGH)  event_financial_closures had no guard at all: DELETE and
--                non-reopen UPDATE were possible at the database level.
-- G-0008 (MEDIUM) audit_events had no append-only guard.
--
-- Every fix is additive (new objects / ACL + view options). No data is
-- touched, no applied migration is edited. Regression tests:
--   supabase/tests/guardian_schema_contract.test.sql
--   supabase/tests/guardian_financial_integrity.test.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER least privilege (G-0001 / G-0002 / G-0003)
-- ---------------------------------------------------------------------------
revoke all on function public.save_organization_settings(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, numeric, text
) from public, anon;
grant execute on function public.save_organization_settings(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, numeric, text
) to authenticated;

revoke all on function public.transition_event_status(
  uuid, uuid, public.event_status, text, text
) from public, anon;
grant execute on function public.transition_event_status(
  uuid, uuid, public.event_status, text, text
) to authenticated;

-- Internal trigger helper: not client-callable by anyone.
revoke all on function public.guard_event_financially_closed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. event_expenses: append-only + documented void transition (G-0006)
-- ---------------------------------------------------------------------------
create or replace function public.event_expenses_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EXPENSE_APPEND_ONLY' using errcode = '42501';
  end if;
  -- Status may only move RECORDED → VOIDED (record_event_expense → void_event_expense).
  if new.status is distinct from old.status
     and not (old.status = 'RECORDED' and new.status = 'VOIDED') then
    raise exception 'INVALID_EXPENSE_TRANSITION' using errcode = '23514';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.event_id is distinct from old.event_id
     or new.category is distinct from old.category
     or new.amount is distinct from old.amount
     or new.expense_date is distinct from old.expense_date
     or new.description is distinct from old.description
     or new.payment_method is distinct from old.payment_method
     or new.payee is distinct from old.payee
     or new.reference is distinct from old.reference
     or new.recorded_by is distinct from old.recorded_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_at is distinct from old.created_at
  then
    raise exception 'EXPENSE_FINANCIAL_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger event_expenses_append_only_guard
  before update or delete on public.event_expenses
  for each row execute function public.event_expenses_append_only_guard();

-- ---------------------------------------------------------------------------
-- 3. event_financial_closures: append-only + documented reopen (G-0007)
-- ---------------------------------------------------------------------------
create or replace function public.event_financial_closures_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CLOSURE_APPEND_ONLY' using errcode = '42501';
  end if;
  -- Only the documented reopen transition (reopen_event_financially):
  -- reopened_at was NULL and is being set now.
  if not (old.reopened_at is null and new.reopened_at is not null) then
    raise exception 'CLOSURE_IMMUTABLE' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.event_id is distinct from old.event_id
     or new.closed_at is distinct from old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.close_note is distinct from old.close_note
     or new.revenue_at_close is distinct from old.revenue_at_close
     or new.collected_at_close is distinct from old.collected_at_close
     or new.outstanding_at_close is distinct from old.outstanding_at_close
     or new.costs_at_close is distinct from old.costs_at_close
     or new.profit_at_close is distinct from old.profit_at_close
     or new.margin_at_close is distinct from old.margin_at_close
     or new.created_at is distinct from old.created_at
  then
    raise exception 'CLOSURE_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger event_financial_closures_guard
  before update or delete on public.event_financial_closures
  for each row execute function public.event_financial_closures_guard();

-- ---------------------------------------------------------------------------
-- 4. audit_events: append-only (G-0008)
-- ---------------------------------------------------------------------------
create or replace function public.audit_events_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger audit_events_append_only_guard
  before update or delete on public.audit_events
  for each row execute function public.audit_events_append_only_guard();
