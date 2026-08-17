-- Event logistics editing (defect F12): events had no edit path at all —
-- a typo in venue/date/guest count at creation was permanent.
--
-- This migration adds a role-checked UPDATE policy on `events` so the product
-- can correct logistics (title, type, window, guests, venue, contacts, notes)
-- while the event is still in its editable planning states (DRAFT/QUOTED).
--
-- Security posture:
--   * USING  — only OWNER/MANAGER/SUPERVISOR of the event's organization.
--   * CHECK  — same roles AND the post-update status stays DRAFT/QUOTED, so
--     no client can smuggle a status transition (or any other column change)
--     through this path; transitions remain server-command-only.
--   * Commercial lines, quotations and ledgers are separate tables and are
--     not affected by this policy.
--   * An event accepted via a quotation is CONFIRMED and therefore not
--     editable through this policy — extending editability to confirmed
--     events is an owner product decision (see PROJECT_DEFECTS.md D29).
--
-- Reversible and additive: dropping the policy restores read-only events.
-- Policies are not part of the generated TypeScript surface, so this
-- migration does not change src/lib/database.types.ts.

create policy events_update_operational on public.events
for update to authenticated
using (
  public.has_org_role(
    organization_id,
    array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role]
  )
)
with check (
  public.has_org_role(
    organization_id,
    array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role]
  )
  and status in ('DRAFT'::public.event_status, 'QUOTED'::public.event_status)
);

-- The role also needs table-level UPDATE privilege (migration 0016 granted
-- SELECT only); the policy above remains the actual row gate.
grant update on public.events to authenticated;
