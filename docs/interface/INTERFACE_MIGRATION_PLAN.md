# INTERFACE_MIGRATION_PLAN.md

> Phase 8 + live-status deliverable. Ordered, small, verifiable milestones for
> migrating the interface safely. No full-UI rewrite in one change; no mixing
> broad visual cleanup with unverified business-logic changes.
>
> **Status labels:** VERIFIED COMPLETE · IMPLEMENTED BUT NOT VERIFIED ·
> BLOCKED BY OWNER OR EXTERNAL ACTION · NOT STARTED.

## Ordering (per mandate priority)
1. Unusable/broken critical journeys — **none found** (routes + critical flows
   verified green: 630 tests, 101 files; production build passes).
2. Severe mobile / RTL / keyboard / a11y failures — **none severe found**; the
   UI is RTL-first with large targets; targeted audit remains.
3. Incorrect page content & action hierarchy — see Phase 3 candidates
   (event-tab grouping, nav density, `/home` vs `/operations` framing).
4. Shared layout & component foundations (highest cross-value) — canonical
   StatusLabel, FilterBar, DetailField, PermissionState.
5. Forms & data-display standardization — shared FormActions; canonical enums.
6. Representative critical pages — Events list, Event workspace, Reports.
7. Remaining route migration.
8. Remove verified-obsolete code.
9. Low-impact polish.

## Milestone register

### M-01 — Arabic-first status localization & canonical event-status source (done)
**Type:** data-display standardization (ordering #4/#5) + fixes a real
content leak (UI-1/UI-2/UI-3).
**Owner-visible outcome:** no raw English lifecycle/reservation status reaches
the Arabic operator; event status wording is identical everywhere; one source
of truth for event-status labels/tones.
**Acceptance criteria:**
- `/reports` event status renders Arabic, not the enum.
- Equipment reservation status renders as an Arabic badge.
- Events list/home/calendar/workspace all read one canonical map; duplicate
  maps removed.
- Gates: typecheck 0 · lint 0 errors · full tests pass (630) · production build.
**Capture:** raw `{e.status}` in ReportsPage, raw `{r.status}` in EquipmentTab,
and 3 drifting event-status maps.
**Shared-first:** canonical map added in `@/lib/arabic`; workspace model
re-exports it; EventsPage uses it.
**Preserve:** no data/permission/route change.
**Tests:** added `src/lib/arabic.test.ts` (coverage + single-source).
**Verify:** ✅ typecheck, lint(0 err), full suite 630/630, `vite build` ok.
**Status:** VERIFIED COMPLETE.

### M-02 — Canonical quotation-status source + fix the last raw leak (done)
**Type:** data-display standardization (ordering #5).
**Owner-visible outcome:** quotation status renders in one consistent Arabic
wording (list, review, and event pricing tab) with no raw enum anywhere; the
three previously parallel quotation-status maps collapse to one source.
**What was done:**
- Added canonical `QUOTATION_STATUS_ARABIC` + `QUOTATION_STATUS_TONES` to
  `@/lib/arabic.ts` (with a shared `BadgeTone` type; `EventStatusTone` kept as
  a deprecated alias for compile compatibility).
- `QuotesPage` dropped its local `STATUS_LABELS`/`STATUS_TONES`.
- `QuotationReview` dropped its local `statusLabel` + `statusTone()`.
- `PricingTab` (event workspace) now shows an Arabic quotation-status Badge
  instead of the raw `q.status` (the last confirmed UI leak).
**Verification:** typecheck 0 · oxlint 0 · full suite **632/632** · `vite build`
ok. No data/permission/route change.
**Status:** VERIFIED COMPLETE.

### M-02b — Survey of remaining enums (assessment; mostly already localized)
Survey of every remaining lifecycle enum (invoice/installment, payment method,
procurement order, supplier, supplier contract, restaurant contract, meal type,
staff type, attendance, membership) found that each already has a working local
Arabic map used correctly at its call sites (e.g. `staff/labels.ts`,
`procurement/presentation.ts`, `payments/presentation.ts`,
`restaurants/presentation.ts`). No raw leaks remain beyond the ones already
fixed in M-01/M-02. **Recommended next step (NOT STARTED):** promote these
local maps into `@/lib` single-source maps for DRY consistency only — no
correctness defect drives it, so it is lower priority than M-03/M-04.

### M-03 — Shared PermissionState primitive (first shared foundation — done)
**Type:** shared foundations (ordering #4).
**What was done (M-03a, VERIFIED COMPLETE):** the gated pages each hand-rolled
a "permission denied" block (QuotesPage amber pill; ProcurementPage neutral
card). Added `src/components/ui/PermissionState.tsx` — a single presentational
block (title + optional description, amber "restricted" tone) and migrated both
pages to it, preserving the exact Arabic texts the page tests assert on
(ProcurementPage keeps "المشتريات والموردون متاحة للصلاحيات المالية فقط.").
Added `PermissionState.test.tsx` (3 tests). UX only — the DB stays authoritative.
**Remaining M-03 items (NOT STARTED):** shared `FilterBar` and `DetailField`
are documented but deliberately **not** extracted — the current per-page
duplication is small and the existing thin-primitive composition (per AGENTS.md
"no premature abstraction") is the better call. `FormActions` submit-lock is
already handled by per-dialog disable+idempotency; no change needed.
**Verification:** typecheck 0 · oxlint 0 · ProcurementPage + PermissionState
tests pass · full suite · build.
**Status:** M-03a VERIFIED COMPLETE · M-03b NOT STARTED (intentional).

### M-06 — Doc drift correction (done)
Corrected `PRODUCT_SPEC.md` §3.3/§4 to the true route set (incl. `/signup`,
`/forgot-password`, `/customers/$customerId`, `/procurement/restaurants`,
`/staff/$staffId`, `/calendar`, `/operations`, `/dashboard`, `/reports`,
`/accounting`, `/integrity`, `/search`, `/settings`) and to the true **13**
workspace tabs (added المالية) plus the grouped presentation. Doc-only.
**Status:** VERIFIED COMPLETE.

### M-04 — Event workspace tab grouping (navigation & hierarchy — done)
**Type:** content/action hierarchy (ordering #3); touches product center.
**Owner-visible outcome:** the 13-peer-tab wall is now a labeled, scannable
selector — **ملخص** pinned first, then buckets **التشغيل والتحضير** (التسعير،
الفريق، المعدات، المخزن، المواد، المشتريات، الحضور)، **المالية** (المدفوعات،
الفواتير، الأجور، المالية) and **السجل** (السجل). Purely presentational.
**What was done (M-04, VERIFIED COMPLETE):**
- Added `WORKSPACE_TAB_GROUPS` + `groupWorkspaceTabs()` to
  `eventWorkspace.model.ts` (pure, role-aware: empty buckets are dropped so no
  empty header renders). No tab is renamed or re-gated; `WORKSPACE_TABS`,
  `resolveActiveTab`, deep links `?tab=…`, role gating and panels all unchanged.
- Rewrote `WorkspaceTabs` to render the pinned summary + labeled buckets,
  preserving `role=tab`/`aria-selected`, active-tab scroll-into-view and
  `onChange(tab)`; wraps responsively (no horizontal overflow on desktop or
  mobile).
- Added 4 grouping unit tests.
- **Live-data verification (real demo org):** logged in; opened a real event
  workspace ("حفل زفاف"); confirmed the 3 buckets + pinned ملخص render, all 13
  tabs present, no horizontal overflow at 1440px and 390px, and the deep link
  `?tab=المدفوعات` still activates the correct tab. Screenshots in
  `/home/user/shots/event_workspace_grouped_{desktop,mobile}.png`.
**Verification:** typecheck 0 · oxlint 0 · model tests 24 · full suite · build.
**Status:** VERIFIED COMPLETE.

### M-05 — Navigation/information-architecture pass (sidebar simplification — done)
**Type:** hierarchy (ordering #3). Pure presentation; routes, permissions and
server gating unchanged.
**Owner-visible outcome:** a simpler, less confusing sidebar for the 50+
owner persona — no more "لوحة المتابعة / لوحة الإدارة / لوحة التشغيل" naming
clash, a single prominent daily landing at the top, and supply-chain pages
grouped under one "المخزون والتوريد" section.
**What was done (M-05a, VERIFIED COMPLETE):**
- `src/components/layout/navConfig.ts` restructured labels/grouping only:
  - `اليوم` → `/home` "لوحة اليوم" (sole landing group, top).
  - المناسبات: /events "المناسبات", /calendar, /operations "جدول التشغيل".
  - المبيعات والعملاء unchanged targets.
  - المخزون والتوريد merges catalog, consumables + procurement + restaurants.
  - الفريق unchanged. الإدارة والتحليل now hosts /dashboard + /reports +
    /accounting + /integrity + /search. النظام unchanged.
  - Every `to` and every capability flag (`commercial/financial/payroll`) kept
    identical — active-state detection, mobile primaries and role filtering
    all preserved.
- Added `navConfig.test.ts` (7 tests): every expected target declared once,
  mobile primaries reachable, and role filtering correct for owner / warehouse
  / accountant / manager / payroll readers.
**Not yet done (M-05b, NOT STARTED):** deeper `/home` vs `/operations` framing
reconciliation (a larger, behavior-visible decision).
**Verification:** typecheck 0 · oxlint 0 · nav+AppShell tests pass · full suite
639/639 · `vite build` ok. No data/permission/route change.
**Status:** M-05a VERIFIED COMPLETE · M-05b NOT STARTED.

### M-07 — Status-consistency audit of remaining panels
**Type:** ordering #9. Systematic audit; fix only confirmed defects, keep all
tests green.
**Done (M-07a, VERIFIED COMPLETE):**
- Event command center documents summary rendered raw quotation_status as a
  fallback and used a wrong invoice branch (`PAID`, which does not exist in
  the invoice enum) so a CANCELLED invoice read as "صادرة". Fixed with
  canonical `QUOTATION_STATUS_ARABIC` + new `INVOICE_STATUS_ARABIC`
  (ISSUED/CANCELLED).
- Invoice installment schedule used a 2-way ternary that rendered a CANCELLED
  installment as "مستحق". Fixed with canonical `INSTALLMENT_STATUS_ARABIC`
  + `INSTALLMENT_STATUS_TONES` (PENDING/PAID/CANCELLED).
- Event workspace header badge overrode the canonical event tones (everything
  brand except cancelled); aligned to `EVENT_STATUS_TONES` for hue-meaning
  consistency.
- Added canonical maps + coverage tests in `@/lib/arabic` (invoice,
  installment) for the single-source status vocabulary.
**Remaining M-07b:** deep RTL/keyboard/zoom + data-table semantics audit — see
below, now done.
**M-07b (VERIFIED COMPLETE):** accessibility/data-table semantics audit across
the interactive reporting tables — added `scope="col"` to every column header
in `ReportsPage`, `accounting/{AgingSection, CustomerStatementSection,
SupplierStatementSection}` and the `StaffProfilePage` roster table so screen
readers associate headers correctly; restored `role="tablist"` on the workspace
tab selector (M-04 rewrite had left bare `role="tab"` buttons). Audit of the
remaining panels (workspace tabs, `/operations` board, calendar, accounting,
documents) found no further raw-status leaks or confirmed defects. Full suite
green + build.
**Status:** M-07a + M-07b VERIFIED COMPLETE.

### M-05b — /home vs /operations rebalancing (assessed, NOT applied)
Assessment: `/home` (daily landing with readiness/attention/collection) and
`/operations` (schedule board grouped today/tomorrow/not-ready/dispatch/return)
share the readiness model but serve distinct owners. No confirmed defect found
in `/operations` (all statuses render Arabic via the readiness model). Reducing
either page's content would remove a working capability without product
evidence, which the preservation rule forbids. The ambiguity was already
largely resolved in M-05a by clear labels (اليوم/لوحة اليوم vs جدول التشغيل).
**Decision:** no speculative content removal. Deferring any deeper merge until
an owner product decision with live UAT.
**Status:** NOT STARTED (owner decision; intentionally not forced).

### Face biometric — owner-confirmed assisted model (VERIFIED, tests added)
Owner decision (via live Q&A): the product's "بصمة الوجه" is the **assisted
manager-confirm** model — camera frame + provider suggestion, then an explicit
manager confirmation writes attendance — **not** an unattended auto-recognition
gate. Camera used is the device's own (mobile `capture="user"`), as the owner
confirmed ("من كاميرا الهاتف الذي تُفتح منه").

Feature audit result:
- **Assisted flow complete end-to-end:** `FaceAttendanceDialog` (capture →
  candidate → manager confirm → `FACE_ASSISTED`, or explicit manual roster pick
  → evidence → `MANUAL`); `AttendanceClock` phone punch; enrollment/revoke on
  the staff profile. Provider state shows honestly ("تعرّف غير متاح / غير
  مُنشر") and degrades to the fully-working manual roster — no fabricated
  confidence anywhere (`provider.ts` honesty policy).
- **Back-end complete:** migration `0083_assisted_face_attendance.sql` defines
  `enroll_staff_face`, `revoke_staff_face`, `get_staff_face_enrollment`,
  `event_attendance_candidates`, `record_face_match_attempt`,
  `consume_face_match_attempt`, and `clock_staff_in/out` accepting
  `attendance_method` = `MANUAL | FACE_ASSISTED`. No auto engine is required by
  this model; one is only wired if a deployment later chooses unattended
  matching (a separate owner/external decision).
- **Test coverage gap closed:** added `face/localTemplates.test.ts` (10 tests:
  device template store, per-provider/model gating, clear/absent/corrupt) and
  `face/provider.test.ts` (7 tests: production `resolve`→null, registry gating,
  engine-failure degradation, confidence ONLY from a registered provider).
  These match the `provider.ts`/`localTemplates.ts` doc references that had no
  backing test file. Gates: typecheck 0 · oxlint 0 · new tests 17/17.
**Status:** VERIFIED COMPLETE under the owner-confirmed assisted model.

## Cross-cutting rules applied to every milestone
- Inspect Git status first; preserve unrelated work; never reset/clean.
- Keep data, permissions, routes, integrations and unaffected behavior intact;
  server remains authoritative.
- Shared foundations before page-by-page duplication.
- Run typecheck, lint, tests, build after each milestone; inspect the diff.
- Update this document's status after each milestone.
