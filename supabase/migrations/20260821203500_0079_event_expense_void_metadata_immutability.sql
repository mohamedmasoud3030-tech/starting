-- ============================================================================
-- 0079 — Event-expense VOID metadata immutability
-- ----------------------------------------------------------------------------
-- Independent review of Guardian migration 0078 found one remaining gap:
-- after RECORDED -> VOIDED, the append-only guard protected the commercial
-- fields but did not protect voided_by / voided_at / void_reason themselves.
-- A privileged/direct UPDATE could therefore rewrite the audit meaning of an
-- already-voided expense.
--
-- Keep 0078 immutable. This additive migration replaces only the trigger
-- function body and leaves the existing trigger in place.
-- ============================================================================

create or replace function public.event_expenses_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EXPENSE_APPEND_ONLY' using errcode = '42501';
  end if;

  -- Commercial/source facts never change after insertion.
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

  -- The only state transition is RECORDED -> VOIDED.
  if new.status is distinct from old.status then
    if not (old.status = 'RECORDED' and new.status = 'VOIDED') then
      raise exception 'INVALID_EXPENSE_TRANSITION' using errcode = '23514';
    end if;
    -- The table CHECK constraint requires voided_by/voided_at/void_reason to be
    -- complete on this transition. They are allowed to be written exactly once.
    return new;
  end if;

  -- Once written, VOID audit metadata is historical evidence and cannot be
  -- rewritten independently (including on an already-VOIDED row).
  if new.voided_by is distinct from old.voided_by
     or new.voided_at is distinct from old.voided_at
     or new.void_reason is distinct from old.void_reason
  then
    raise exception 'EXPENSE_VOID_METADATA_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;
