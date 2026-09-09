-- 0101 — staff_leaves decision-shape fix.
--
-- Migration 0100 required PENDING and CANCELLED to both have null
-- decided_by/decided_at. That made "إلغاء" a non-decision, but in the
-- register cancelling a pending request is itself an action that must record
-- WHO cancelled and WHEN (the UI sends the acting user's id). Only a truly
-- undecided PENDING row must have no decider.
--
-- Applied on top of 0100 in the live database and in the clean replay chain
-- (a new migration because 0100 is already applied and therefore immutable).
alter table public.staff_leaves
  drop constraint staff_leaves_decision_shape;

alter table public.staff_leaves
  add constraint staff_leaves_decision_shape check (
    (status = 'PENDING' and decided_by is null and decided_at is null)
    or
    (status in ('APPROVED', 'REJECTED', 'CANCELLED')
       and decided_by is not null and decided_at is not null)
  );
