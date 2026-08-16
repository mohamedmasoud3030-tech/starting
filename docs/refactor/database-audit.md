# Database audit — no destructive cleanup (2026-08-16)

Scope: `supabase/migrations/` (53 numbered + 4 timestamped) against the
current frontend read/write surface (`src/`). No schema change was made as a
result of this audit; findings are recorded here so future work can proceed
with full context.

## 1. Historical migrations that must remain

Every applied migration is immutable (AGENTS.md). Nothing below proposes
editing, squashing or reordering history. `supabase db reset` must keep
replaying from an empty database (verified in CI).

## 2. Live duplicate objects — none found

Repeated `create or replace function/view` statements across migrations are
*hardening edits* to the same logical object (e.g. `record_staff_attendance`
defined 4× across the S9 attendance migrations 0044–0047), not concurrent
duplicates. Each object has exactly one live definition in the final schema.

## 3. Quick-quote legacy path — already fully superseded and dropped

Migrations `0017`/`0018` introduced the prototype `quick_quotes` aggregate
(`quick_quotes`, `quick_quote_lines`, `quick_quote_applied_packages`,
`quick_quote_status`) with 9 command RPCs. Migration
`20260816012000_0051_canonical_quotation_lifecycle.sql`:

- migrated all quick-quote data into the canonical `quotations` /
  `quotation_lines` snapshot system (with a two-phase map for linked and
  unlinked rows),
- dropped all 9 quick-quote functions, the 3 tables and the enum type
  (lines 509–520),
- replaced legacy read helpers with `_view_*` RPCs + `security_invoker`
  views.

The frontend (`src/features/quotes/quotes.api.ts`, `useQuotationDraft.ts`)
calls only the canonical path (`persist_quotation_draft`, `issue_quotation`,
`cancel_quotation_draft`, `_view_quotations_customer`,
`_view_quotation_lines_customer`). **No live quick-quote object remains.**

## 4. Legacy command idempotency registers — consolidated (0049)

Migration `0049_command_idempotency_consolidation` merged the three physical
replay registers (`procurement/payments/staff_command_idempotency`) into one
canonical `command_idempotency` table with compatibility views. No live
duplicate register remains.

## 5. Read models / views — inventory

32 views exist; each is created once and hardened in place. Two families are
live and used by the frontend:

- Direct scoped views read through PostgREST: `catalog_items_operational`,
  `event_commercial_lines[_operational]`, `quotations_customer`,
  `quotation_lines_customer`, `staff_members_operational`,
  `event_staff_assignments_operational`, `event_warehouse_lines[_valued]`,
  `consumable_stock_summary`, `event_consumable_lines`, plus the
  `*_summaries`, `supplier_*`, `procurement_*` read models consumed by
  `src/features/*/*.api.ts` and `src/features/procurement/procurement.api.ts`.
- `_view_*` security-definer RPCs backing `security_invoker=true` views
  (quotation read models).

No obsolete view is referenced by nothing: every view in the schema maps to
at least one `src/` table/query name.

## 6. Read-model RPCs without a current frontend consumer — retained

The following functions are not called by `src/` today but ARE exercised by
authoritative pgTAP tests (`supabase/tests/`) and remain granted in the demo
allowlist: `equipment_availability`, `event_consumable_state`,
`consumable_stock_on_hand`, `warehouse_reservation_state`,
`get_host_payroll_summary`. They are org-scoped read models kept as part of
the tested DB contract. **Removal is not justified** without stronger
evidence than "unused by the current UI".

## 7. Intentionally private objects

- `app_private.*` — RLS/demo helpers, schema revoked from
  anon/authenticated.
- `create_organization`, `handle_new_user` — auth/onboarding bootstrap,
  never granted to the browser role; currently unused by the UI (future
  self-service onboarding would call them server-side or via a restricted
  path).
- Internal guards/asserts (`*_guard`, `assert_*`, `begin_*/finish_*`) — used
  inside command bodies; not dead.

## 8. Demo-mode migrations (security-relevant)

`20260816083938_public_demo_full_access.sql` and
`20260816085022_public_demo_admin_role_grants.sql` are forward-only,
explicitly temporary ("Temporary public full-access mode"), and confine anon
capability to the single named demo organization via
`app_private.is_public_demo_request()`. Full security analysis and the
frontend-side mitigation are in the security commit
(`src/app/publicDemo.ts` env-gating + `src/app/publicDemo.test.ts`).

## 9. Conclusion

- No new migration is required by this audit.
- No historical migration was touched.
- The schema contains no live duplicate objects and no safely-removable
  dead objects; the only legacy path (quick quote) was already dropped
  forward-only in 0051.

---

# Addendum — multi-organization membership readiness audit (2026-08-16, follow-up mission)

Question: does exposing an organization (account/tenant) switcher in the
frontend require any schema change, and is tenant isolation still sound when
one user holds memberships in several independent organizations? (Each
organization is one independent business; there are no branches or locations
inside an organization.)

## A1. The schema is already fully multi-tenant — no migration required

Every business table carries `organization_id`. A sweep of all `create table
public.*` statements found exactly one table without it — `organizations`
itself, which is the tenant root:

```
NO ORG SCOPE: organizations
```

Isolation is enforced per organization, not per session, by
`public.is_org_member(p_org_id)` / `public.has_org_role(p_org_id, roles)`
(migration 0003). Both resolve `auth.uid()` against an **ACTIVE membership in
an ACTIVE organization** for *that specific* organization id, and they are
`security definer` with `set search_path = ''`.

Consequences for multi-organization membership:

1. A user with memberships in A and B is authorized **independently** in each.
   Holding OWNER in B grants nothing in A.
2. The role is per membership, so the same person can be OWNER in one
   organization and SUPERVISOR in another; the frontend now reflects this by
   deriving
   capabilities from the membership inside the *active* organization.
3. Composite foreign keys (`(organization_id, id)`) make cross-organization
   references impossible at the constraint level, independent of RLS.

**No new migration was added for organization switching, and none is needed.** The gap
was purely a frontend one: the UI hard-selected a single membership.

## A2. Frontend-side isolation defect found and fixed (P0, no schema change)

The database was never at risk, but the client cache was: query keys for
`event`, `event-workspace`, `event-warehouse` and `event-consumables` were
keyed by event id only, and nothing cleared the TanStack Query cache when the
identity changed. Two identities in one browser tab could therefore share
cache entries. Fixed in the frontend only (org-scoped keys + cache reset on
identity change); see `src/app/tenantCache.ts`. **No RLS, RPC, grant or
migration was modified.**

## A3. Demo-mode re-verification under multi-organization membership

`app_private.is_public_demo_request(p_org_id)` checks the org id **and** the
org name, so anonymous demo capability cannot follow an organization switch
into a real tenant: a demo visitor has no memberships at all, and the switcher only
ever offers organizations backed by a real ACTIVE membership. The switcher
therefore does not widen the demo surface.

## A4. Conclusion (unchanged from the main audit)

- No historical migration edited, squashed, reordered or deleted.
- No live database object dropped.
- **No new migration added by this mission.**
- The only isolation defect found was in the browser cache and was fixed
  entirely in the frontend.
