# Phase 2 report — data-access architecture, TanStack Query correctness

## Baseline

| Item | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/starting` |
| PR #23 merged as | `ed66ca469ff9769cd9648e319d2ec3d9f69e2aac` (squash, new canonical `origin/main`) |
| Phase 2 branched from | `ed66ca4` exactly |
| Product model | One Organization = one independent business (tenant). No branches, no locations, no multi-location entities. Organization switching = account/tenant switching. |

## Pre-merge corrections applied to PR #23 before merging

1. **Terminology** — the PR had mislabeled Organizations as "locations/branches":
   `OrganizationSwitcher` Arabic UI (`الموقع` → `المنشأة`, `اختيار الموقع` →
   `اختيار المنشأة`, `المواقع المتاحة` → `المنشآت المتاحة`), test fixtures
   (`الفرع الرئيسي` / `فرع صحار` → real business names), comments, docs and the
   database-audit addendum now consistently describe **organization/account
   switching between independent tenants**.
2. **PWA** — behavioural verification of the real `public/sw.js` was added
   (`src/pwa/serviceWorker.behavior.test.ts`, 11 tests executing the actual
   install/activate/fetch handlers): offline shell boot after one online
   visit, recovery from a failed install pre-cache, no interception of
   cross-origin (Supabase REST/auth/realtime) or non-GET traffic, no caching
   of same-origin fetch/XHR requests, cache-first only for hashed static
   assets, versioned cache invalidation on activate. One real defect was
   found and fixed: a **redirected document response could be cached as the
   app shell**; browsers refuse to serve a redirected cached response to a
   navigation, which would have broken the offline fallback exactly when
   needed. Both the install pre-cache and the runtime shell refresh now
   reject redirected responses.

## Phase 2 — confirmed defects (each has a regression test)

| # | Defect | Fix | Test |
| --- | --- | --- | --- |
| 1 | Workspace commands never refreshed the standalone `["event-readiness", org, event]` key the dashboard reads → Home showed stale readiness after the operator fixed a shortage | `useEventCommand` invalidates it | `events.invalidation.test.tsx` |
| 2 | Payment record/void never refreshed invoice read models, although `paid_total`/`remaining_balance`/installment `effective_status` are DERIVED from the payments ledger (migration 0043) | `invalidatePaymentReadModels` refreshes payments+finance+invoice+installments | `payments.invalidation.test.tsx` |
| 3 | Attendance record/void never refreshed `["attendance-gaps", org]` → dashboard kept alerting on a fixed gap | both mutations invalidate it | `staff.invalidation.test.tsx` |
| 4 | `convert_quotation_to_event` can CREATE a customer (migration 0051) but the customers list was never refreshed | `useConvertQuotation` invalidates `["customers", org]` | `events.invalidation.test.tsx` |
| 5 | Procurement commands change consumable stock (receipt of CONSUMABLE lines → stock IN movement, migration 0030) and event finance (committed/delivered cost, migration 0037), but the feature's self-managed reload never told the TanStack cache | `useProcurementDataSource` decorator with cross-feature cache sync; fallback broad stock refresh if the order can't be re-read (receipt never fails) | `useProcurementDataSource.test.tsx` (9 tests) |

## Query-key audit result

Every query key in `src/` carries the organization id in position 1
(verified by sweep). Entity ids and filter identities (cost visibility,
staff member, event) are part of the keys where applicable. No cross-tenant
collision and no reuse between incompatible screens was found beyond the
five defects above. PR #23's `identityKey` + `queryClient.clear()` isolation
is untouched and still pinned by `tenantCache.test.ts`.

## Architecture changes

- **`src/lib/rpc.ts`** — one canonical `callRpc` helper replaces four
  duplicated per-feature copies (payments, invoices, quotes, staff, events).
- **`src/features/events/events.api.ts`** — de-minified from single-line
  compressed style into a readable module with an `eventKeys` query-key
  registry; behaviour byte-preserved (verified by the full suite).
- **`src/features/procurement/procurement.api.ts`** — moved from
  `src/lib/` into the feature that is its only consumer.
- **`src/features/procurement/orderMapping.ts`** — the cost and cost-free
  branches of `getOrder` had duplicated the line mapping, the per-line
  receive-capability derivation (authorization-relevant) and the receipt
  grouping. Now one shared implementation pinned by 11 characterization
  tests; `supabaseDataSource.ts` shrank 886 → 758 lines.
- **`useProcurementDataSource`** — composition-seam decorator so components
  stay ignorant of caching concerns and the adapter stays pure.

Deliberately NOT done: no generic repository framework, no ORM, no state
library, no router change, no mechanical splitting of long-but-cohesive
modules (`screenSummary.ts`, `consumables.model.ts` are single-purpose),
no database migration (no server-side correctness problem was found).

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | 0 warnings / 0 errors (211 files) |
| `npm test` | **51 files / 446 tests** (was 45/408 at PR #23 head; +38, none weakened) |
| `npm run build` | pass |
| `node scripts/production_smoke.mjs` | pass |
| Database CI (pgTAP/concurrency/restore/types) | CI-only (no Docker in this workspace); **no migration or SQL change in Phase 2**, so the DB job runs against identical inputs that passed on PR #23 |

Existing-test edits in Phase 2 were limited to: completing the
`ProcurementPage` mock data-source fixture with the full interface, and
wrapping it in the `QueryClientProvider` the page now genuinely requires.
**No assertion was deleted or weakened.**

## Database

- No migration added, edited or removed.
- No SQL object touched.
- All fixes are client cache-correctness; server truth was already correct.

## Remaining technical debt

1. `screenSummary.ts` (869 lines) is large but cohesive (one register of
   Arabic voice summaries); splitting it now would be file-count cosmetics.
2. The procurement feature still manages list reloads with local state
   instead of TanStack Query. Migrating `useOrdersFeed`/`useOrderDetail` to
   queries would unify caching but is a larger, riskier change; the
   cross-feature sync decorator closes the actual correctness gap.
3. `staff.api.ts` still uses an untyped client boundary because generated
   types lag migrations 0038-0040; regenerate types and remove the cast.
4. No AuthProvider-level org-switch integration test (unit-covered).
5. Database suite remains CI-only (no local Docker).
