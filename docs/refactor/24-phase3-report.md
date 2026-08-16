# Phase 3 report — data-access consolidation, state consistency, production hardening

## Baseline

| Item | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/starting` |
| Canonical baseline | `aeda3be54fe07f5c3498cf9d4e571f0a18e08f7b` (squash merge of PR #24, verified as exact `origin/main` at start) |
| Baseline gates | typecheck ✓ · lint 0/0 ✓ · 447 tests / 51 files ✓ · build ✓ |
| Product model | One Organization = one independent business (tenant). No branches/locations. Organization switching = tenant switching (المنشأة / اختيار المنشأة / المنشآت المتاحة). |

## Confirmed defects (each proven, regression-tested, fixed)

### P0 — Attendance record lifecycle mapped from the wrong enum

`staff_attendance_summaries.record_status` is `staff_attendance.status`
itself — the `attendance_status` enum (`PRESENT|LATE|PARTIAL|ABSENT|VOIDED`).
It is **never** the string `'RECORDED'`. The mapper cast it to
`HostPaymentStatus` untranslated through an untyped client boundary, so every
live attendance row carried `recordStatus: "PRESENT" | …` and each
`recordStatus === "RECORDED"` consumer failed silently:

- the attendance panel's earned total was **always 0.000 OMR**;
- the void-attendance button **never rendered** (voiding attendance was
  unreachable from the UI);
- the workspace attendance voice summary reported 0 of 0 present.

Fix: `recordStatus` is now **derived** (`VOIDED` iff status `VOIDED`, else
`RECORDED`), the whole S9 read surface is typed against the generated
database types (removing the `as unknown as SupabaseClient` boundary that hid
the mismatch — the generated types now fully cover migrations 0038–0048),
`AttendanceStatus` includes `VOIDED` to match the DB enum, recording commands
take `AttendanceLiveStatus`, and the `VOIDED` badge label/tone exists.
Pinned by `staff.mapping.test.ts` (10 tests).

### P1 — Workspace commands left event finance stale

`accept_event_quotation` changes `event_finance_summaries.accepted_revenue /
expected_cost / outstanding_balance / gross_margin`, and `cancel_event` /
`transition_event_status` change its `event_status` (migration 0037), but
`useEventCommand` never invalidated `["event-finance", org, event]`. The
payments tab — and the invoice panel, which issues the invoice at
`acceptedRevenueMilli` — kept a stale figure for up to `staleTime` after
accepting a quotation. Fix + regression in `events.invalidation.test.tsx`
(test demonstrated the failure on baseline behavior before the fix).

### P1 — Pricing tab computed money with binary floats

Revenue/cost/profit were `Number(...)` float reductions rendered with
`.toFixed(3)` — float presented as financial truth (violates AGENTS.md;
1000 × 0.001 accumulates to 1.0000000000000007). All Pricing-tab amounts now
flow through `fromDbAmount → integer milli-OMR → formatOMR`; the totals are
`pricingTotals()` (pure, pinned by `pricingTotals.test.ts`, including a
1000-line accumulation proof).

### P1 — Dashboard voice summary spoke fabricated zeros

The attention voice summary was built from zeroed placeholders while its
queries were still loading, so the owner could hear a confident
"لا توجد مناسبات اليوم" for an unresolved dashboard — the exact
fabricated-zero class the visual metrics guard with `settledCount`. Now
`attentionSummaryWhenLoaded()`: `null` (voice button hidden) until the
dashboard AND the gap count settle. Pinned by 4 model tests.

### P1 — InvoicesPanel treated unresolved finance as 0

`EventWorkspace` passed `acceptedRevenueMilli = 0` while the finance query
was unresolved, so the invoices tab momentarily claimed
"لا يوجد عرض سعر معتمد قابل للفوترة". The prop is now `number | null`;
`null` renders the loading state and disables issuing.

### P1 — "Today" defaults used the UTC day, not the Muscat day

Attendance date, advance/payout dates, and invoice first-due defaulted to
`new Date().toISOString().slice(0,10)` — the UTC calendar day, which is
**yesterday** between 00:00 and 04:00 Asia/Muscat, exactly when a crew closes
out an evening event. The server already evaluates `Asia/Muscat`
(`today_attendance_gaps`), so attendance recorded with the UTC date landed on
the wrong operational day and kept the dashboard gap open. All defaults now
use the shared `todayInMuscat()` (`src/lib/dates.ts`, pinned by tests); the
procurement dialog's private duplicate was consolidated onto it.

## Architecture / ownership changes

- `staff.api.ts`: untyped client boundary removed; reads typed end-to-end via
  new `dbTypes` aliases (`StaffAttendanceSummaryRow`, `StaffAdvanceSummaryRow`,
  `HostPayoutSummaryRow`, `HostEventPayrollSummaryRow`, enum aliases). Mappers
  exported and characterization-tested (authorization-relevant lifecycle
  derivation included).
- `src/lib/dates.ts`: single owner of the operational-day rule (was duplicated
  in procurement and implicitly wrong in staff/payments).
- `src/features/events/workspace/pricingTotals.ts`: money totals extracted from
  JSX into a pure tested model.
- `attentionSummaryWhenLoaded` moved dashboard voice gating from the hook into
  the pure model where it is testable.

## New/strengthened tests (+23, none weakened; 470 total)

| Suite | Purpose |
| --- | --- |
| `staff.mapping.test.ts` (10) | P0 lifecycle derivation + exact money characterization |
| `events.invalidation.test.tsx` (+1) | workspace command → event-finance fan-out |
| `pricingTotals.test.ts` (4) | exact money totals, float-drift proof |
| `operationalDashboard.model.test.ts` (+4) | voice summary never fabricates zeros |
| `AuthContext.orgSwitch.test.tsx` (1) | integration: org switch → role/capability recompute → full cache clear → no previous-tenant rows → persisted selection (Phase 2 debt #5) |
| `dates.test.ts` (3) | Muscat-day boundary proof |

## Dead code removed (conclusively unused)

`useEventReadiness` (dashboard consumes `eventReadinessQuery` directly),
`HostPayrollTotals`, `flatNavItems`, `formatDate`. The
`get_host_payroll_summary` DB function is untouched — it remains a supported
server contract.

## Deliberately NOT changed (and why)

1. **Procurement list/detail local reload state** (Phase 2 debt #2): the
   cross-feature cache-sync decorator already closes the correctness gap
   (stock + event-finance invalidation incl. the org-wide prefix fallback).
   Migrating `useOrdersFeed`/`useOrderDetail` to TanStack Query would touch
   lifecycle/idempotency/role/visibility behavior for consistency alone —
   exactly the migration-for-consistency this phase forbids.
2. **`screenSummary.ts`** (debt #3): audited again — one cohesive register of
   Arabic voice summaries; the "unused exports" it shows are used internally.
   No responsibility defect; not split.
3. **`supabaseDataSource.ts`** (debt #4): re-inspected; mapping is already
   consolidated in `orderMapping.ts` (Phase 2), capability derivation is
   single-sourced. No remaining duplicated mapping worth moving.
4. **No database migration**: every defect traced to client mapping,
   invalidation, or display. Server truth (views/RPCs) was correct in each
   trace (`record_status` semantics, finance view derivation, Muscat-day SQL).
5. **No Dashboard redesign**: metrics/alerts traced DB→view/RPC→cache→UI;
   org scope, cancelled-exclusion, unknown-vs-zero and Muscat-day handling are
   correct after the voice-summary fix.

## Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | 0 warnings / 0 errors (217 files) |
| `npm test` | **55 files / 470 tests** pass |
| `npm run build` | pass |
| `npm run smoke:production` | pass |
| `git diff --check` | clean |
| Database CI (replay, pgTAP, concurrency, restore, types drift) | CI-only (no Docker locally); **no SQL/migration change in Phase 3**, so the job runs against inputs identical to those green on PR #24; re-verified on this PR's head by CI |

## Remaining technical debt

1. Procurement local reload state (see above — correctness closed, churn not
   justified this phase).
2. Database suite remains CI-only (no local Docker).
3. `screenSummary.ts` size (cohesive; watch, don't split).
