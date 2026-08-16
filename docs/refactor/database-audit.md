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
  `src/features/*/*.api.ts` and `src/lib/procurement.api.ts`.
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
