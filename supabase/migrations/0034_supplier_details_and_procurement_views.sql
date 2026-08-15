-- ============================================================================
-- 0034 — S5 Integration: supplier details and procurement receipt line read models
--
-- Exposes safe cost-gated supplier detail projection (with notes, CRN, email)
-- for OWNER/MANAGER/ACCOUNTANT roles, and procurement receipt lines for all
-- active organization members.
-- ============================================================================

create view public.supplier_details as
select
  s.id as supplier_id,
  s.organization_id,
  s.name,
  s.category,
  s.commercial_registration_number,
  s.contact_name,
  s.phone,
  s.whatsapp,
  s.email,
  s.notes,
  s.status,
  s.created_at,
  s.updated_at
from public.suppliers s
where public.can_read_cost(s.organization_id);

create view public.procurement_receipt_line_summaries as
select
  rl.id as receipt_line_id,
  rl.organization_id,
  rl.order_id,
  rl.receipt_id,
  rl.order_line_id,
  rl.quantity,
  rl.consumable_movement_id,
  rl.created_at
from public.procurement_receipt_lines rl
where public.is_org_member(rl.organization_id);

-- ---------------------------------------------------------------------------
-- Explicit default-grant revocation and SELECT re-grant to authenticated.
-- ---------------------------------------------------------------------------
revoke all on table
  public.supplier_details,
  public.procurement_receipt_line_summaries
  from anon, authenticated;

grant select on table
  public.supplier_details,
  public.procurement_receipt_line_summaries
  to authenticated;
