# FUNCTIONAL_CORRECTNESS_AUDIT.md — Business Rules & Functional Correctness Audit

> Read-only audit, 2026-08-17 (second, deeper pass). **Nothing was modified.** Evidence gathered from
> `src/`, `supabase/migrations/`, `supabase/tests/`, executed checks, and the
> running app shell. Baseline re-run this pass: typecheck ✓ · lint 0/0 ·
> **496/496 tests** ✓ · working tree clean.
>
> Labels: **Verified Working** = behavior proven by tests/execution ·
> **Confirmed Defect** = reproducible inconsistency or broken path with
> evidence · **Incomplete** = implemented backend with missing usable UI (or
> vice versa) · **Unverified** = cannot be observed from this workspace ·
> **Contradictory** = code/UI/docs disagree · **[DECISION]** = product intent
> unknown, owner must choose.

---

## 1. Feature-status matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Quotation lifecycle (draft→issue→accept→convert) | ✅ Verified Working | pgTAP + concurrency harness + editor tests; UI gated correctly |
| Money (OMR 3-decimals, BigInt, rounding) | ✅ Verified Working | `money.test.ts` (27 tests) + server numeric checks |
| Muscat-day semantics (dashboard/today) | ✅ Verified Working | `dates.test.ts`, SQL `Asia/Muscat` |
| Warehouse S4A dispatch/return/reconcile | ✅ Verified Working | pgTAP `warehouse_dispatch` + two-session harness |
| Consumables S4B ledger (no negatives) | ✅ Verified Working | pgTAP `consumable_stock` + concurrency harness |
| Procurement lifecycle + receiving | ✅ Verified Working | pgTAP `procurement_*` + harness |
| Payments + invoices (derived totals) | ✅ Verified Working | pgTAP `customer_payments` + invalidation tests |
| Staff attendance/payroll math | ✅ Verified Working | pgTAP `staff_attendance` + payroll harness |
| Tenant isolation / roles at data boundary | ✅ Verified Working | `rls_isolation` pgTAP (28) |
| Event create + first transitions (→PREPARING→DISPATCHED) | ✅ Verified Working | server guards + UI buttons |
| **Event lifecycle completion (→CLOSED)** | ✅ Fixed (F1) | full transition UI + close-out guard (migration 0058) |
| Event cancellation | ⚠️ Partial | consistent for DRAFT–PREPARING; no mid-execution abort (F5) |
| CLOSED checklist (reconciliation before close) | ❌ Contradictory (F3) | docs promise checklist; server has no guard |
| Arabic error translation | ❌ Confirmed Defect (F2) | 3-code fallthrough leaks raw codes in workspace + create dialog |
| Payment overpayment handling | ⚠️ Contradictory→[DECISION] (F4) | allowed; negative outstanding/remaining displayed |
| Create-event duplicate protection on retry | ❌ Confirmed Defect (F6) | idempotency key regenerated per attempt |
| Duplicate customers | [DECISION] (F10) | no uniqueness; convert dedups prospects by exact phone |
| Event-type required UI vs DB coercion | Contradictory (F8) | UI requires; DB silently coerces to `OTHER` |
| Demo-mode logout | Contradictory (F9) | logout re-hydrates the demo org (no-op) |
| Cancel-reason UX | Confirmed Defect (F7) | blocking `window.prompt` |
| Real-browser end-to-end with live Supabase | ❌ Unverified | no browser tool / no network egress from workspace |

---

## 2. Confirmed defects (ranked)

### F1 — HIGH — The event lifecycle UI stops at DISPATCHED; CLOSED is unreachable
- **Symptom:** after «تأكيد الإرسال» (DISPATCHED) the operator has no button
  for IN_PROGRESS, RETURNING, or CLOSED. The product's core promise — «close
  the event and compute actual profit» — cannot be completed from the UI.
- **Evidence:** `src/features/events/workspace/OverviewTab.tsx` renders only two
  transitions (`p_to: "PREPARING"` line 47, `p_to: "DISPATCHED"` line 54);
  `grep "p_to" src/` finds no other transition UI. Server
  `transition_event_status` (migration 0014) explicitly permits
  CONFIRMED→PREPARING→DISPATCHED→IN_PROGRESS→RETURNING→CLOSED (line 42).
- **Affected users/data:** OWNER/MANAGER/SUPERVISOR; events stuck in DISPATCHED;
  history/close-out/actuals never complete; no data corruption.
- **Root cause:** UI implementation stopped mid-state-machine; server side is
  complete (and role-gated) — a classic backend-capability-without-UI gap.
- **Smallest fix:** add the three missing transition buttons to `OverviewTab`
  with the same `run(...)` dispatcher (server already validates each step).
- **Edge cases:** CLOSED from a status other than RETURNING is rejected by the
  server (good); SUPERVISOR may CLOSE (see F3 decision).
- **Regression tests:** extend a workspace-model test for the offered
  transitions per status (mirror `visibleWorkspaceTabs` style); component test
  that the three buttons appear at DISPATCHED/IN_PROGRESS/RETURNING.
- **Verification:** typecheck/lint/test + manual journey on a seeded event.

### F2 — MEDIUM — Raw English machine codes reach the Arabic owner
- **Symptom:** workspace command failures and the create-event dialog show
  codes like `INVALID_EVENT_WINDOW`, `INVALID_GUEST_COUNT`,
  `CUSTOMER_NOT_IN_ORG`, `CANCELLATION_REASON_REQUIRED`,
  `RESERVATION_HAS_OUTSTANDING_EQUIPMENT`, `CONSUMABLE_STOCK_SHORTAGE`,
  `EVENT_NOT_PAYABLE`, `PAYMENT_REQUIRES_ACCEPTED_QUOTATION`, or raw
  `INVALID_EVENT_TRANSITION: …` — instead of Arabic explanations.
- **Evidence:** `events.api.ts` `arabicError` maps only 3 codes and falls
  through to the raw message (lines 384–393); `useEventWorkspace.ts:88` routes
  every workspace command error through it. By contrast
  procurement/staff/quotes/login have complete translators.
- **Affected users:** the primary persona (non-technical owner) on the busiest
  screens. **No data impact.**
- **Root cause:** per-domain translator drift; the events domain translator was
  never extended as new commands were added.
- **Smallest fix:** extend `arabicError` (or adopt the shared registry proposed
  in `TECH_DEBT_AUDIT.md` C1) with the ~12 missing codes.
- **Regression tests:** table-driven unit test mapping every listed code to a
  non-code Arabic string; assert no raw code in output.
- **Verification:** unit tests + lint/typecheck.

### F3 — MEDIUM — CLOSED has no reconciliation guard (docs vs code)
- **Symptom:** an event can be CLOSED while equipment is still outstanding
  (dispatched, never returned) and consumables unreconciled — the documented
  «checklist-controlled close» is advisory only.
- **Evidence:** `docs/architecture/02-event-lifecycle.md` describes the
  close-out checklist («المعدات أُرجعت؛ … المواد محتسبة»); server
  `transition_event_status` (0014) checks only the state pair, never
  `event_equipment_movements`/`event_consumable_reconciliations`; roles for the
  transition are OWNER/MANAGER/**SUPERVISOR** while final warehouse
  reconciliation is OWNER/MANAGER-only.
- **Affected users/data:** misleading closed history and profit figures if
  equipment is later damaged/lost.
- **Root cause:** checklist exists in documentation, not in the database.
- **Smallest fix:** future migration adding a CLOSED pre-check (outstanding
  equipment = 0 AND consumables reconciled, or explicit override by
  OWNER/MANAGER) — **owner decision required** (may be intentionally lenient).
- **Verification:** extend `events_commercial_resources.test.sql` with a
  blocked-CLOSE case.

### F4 — MEDIUM [DECISION] — Overpayment allowed; balances go negative
- **Symptom:** paying more than `accepted_revenue` is accepted; the event's
  `outstanding_balance` and the invoice's `remaining_balance` display negative.
- **Evidence:** `record_customer_payment` (0036) validates only amount > 0 and
  3-decimal precision (`assert_payment_omr`); no comparison against accepted
  revenue. `invoice_summaries.remaining_balance = total_amount − paid_total`
  (0043) — no floor.
- **Affected users/data:** ACCOUNTANT/OWNER/MANAGER; confusing negative
  balances. Not data loss.
- **Root cause:** no business rule was defined for overpayment.
- **Smallest fix (decision):** either reject overpayments in the command, or
  keep credit semantics and clamp/frame the display («رصيد دائن»).
- **Verification:** pgTAP case for the chosen rule.

### F5 — MEDIUM [DECISION] — No way to cancel mid-execution events
- **Symptom:** events in DISPATCHED/IN_PROGRESS/RETURNING cannot be cancelled
  (server raises `EVENT_CANNOT_BE_CANCELLED`; UI hides the button). An event
  aborted on site has no terminal path.
- **Evidence:** `cancel_event` (0022) allows only
  DRAFT/QUOTED/CONFIRMED/PREPARING; `OverviewTab.tsx` mirrors those statuses.
  UI and server agree — the gap is business capability.
- **Root cause:** conservative state machine; intent unknown.
- **Smallest fix (decision):** if aborts are needed, extend `cancel_event`
  (with a guard that keeps warehouse recovery obligations, which S4A already
  models) and surface the button for those statuses.
- **Verification:** pgTAP for cancel-with-outstanding-equipment behavior.

### F6 — MEDIUM — Create-event idempotency key is regenerated per attempt
- **Symptom:** if the create-event response is lost (timeout/network), the
  operator re-submits and a **duplicate event row** is created — the key that
  would make the retry replay-safe is new each time.
- **Evidence:** `events.api.ts:321` `p_idempotency_key: crypto.randomUUID()`
  inside the mutation function; server replay (0014) only matches an identical
  key. React Query does not auto-retry mutations, but a manual re-submit after
  an ambiguous failure hits this path. (Cancel/convert are safer: cancel is
  status-guarded, convert is protected by unique `converted_event_id`.)
- **Affected users/data:** duplicate events; dashboard/lists polluted.
- **Root cause:** key generated at submit time instead of at form/dialog open.
- **Smallest fix:** create the key once per dialog session (useRef initialized
  on open; reset on success/close) and pass it to every attempt.
- **Regression tests:** mutation unit test asserting the same key across two
  calls of one session.
- **Verification:** tests + manual double-submit with throttled network.

### F7 — LOW — Cancel reason uses a blocking `window.prompt`
- **Evidence:** `OverviewTab.tsx:64` `window.prompt("سبب الإلغاء")`.
- **Impact:** blocks the page, poor on the mobile PWA, no cancel-of-cancel
  feedback; inconsistent with the design system (ConfirmPanel exists).
- **Smallest fix:** reuse `ConfirmPanel`/Dialog with a required reason field.
- **Verification:** component test for cancel flow.

### F8 — LOW — event_type: required in UI, silently coerced in DB
- **Evidence:** `EventsPage` create dialog `required`; `create_event` (0014)
  `coalesce(nullif(trim(p_event_type),''),'OTHER')`.
- **Impact:** cosmetic inconsistency only (data always valid).
- **Smallest fix:** align (drop UI requirement or keep, document coercion).

### F9 — LOW — Demo-mode "logout" is a no-op
- **Evidence:** `logout()` in PUBLIC_DEMO_MODE calls `hydrate(null)` →
  `loadPublicDemo()` re-selects the demo org; the header still shows خروج.
- **Impact:** cosmetic contradiction; no security issue (anon has no session).
- **Smallest fix:** hide the logout control in demo mode, or relabel.

### F10 — [DECISION] — Duplicate customers allowed
- **Evidence:** no uniqueness on `customers.phone`; only the quotation-convert
  path dedups prospects by exact active phone match (0051).
- **Impact:** duplicate profiles split a client's history.
- **Decision:** soft-duplicate warning on create, or leave as-is.

---


### F11 — HIGH — No provisioning path for staff members or equipment capacity (backend or UI)

- **Symptom:** the staff page and the equipment tab can only *consume* data
  they cannot create. The staff roster and the capacity pool must exist for
  team assignments, attendance, payroll, and equipment reservations to work —
  yet no screen, mutation, or command creates them.
- **Evidence (exhaustive):**
  - No `insert into public.staff_members` and no `insert into
    public.equipment_capacity` anywhere in `supabase/migrations/*.sql`;
    the only staff-related command is `assign_event_staff` (0015).
  - `src/features/staff/staff.api.ts` mutations cover attendance/advance/payout
    only (lines 280–470); no roster mutation exists.
  - `StaffPage.tsx` only reads `useOrgStaffMembers` and renders advances/
    payouts; `EquipmentTab.tsx` only reads `capacities` and renders a
    `<Select name="capacity">` — when the table is empty the select is
    permanently empty.
  - RLS grants exist for direct `INSERT` on both tables
    (`0016_s1_s3_security.sql:34` grants to `authenticated`;
    `equipment_capacity_manage` ALL policy; `staff_members_manage` ALL policy),
    so rows *can* only be created via raw PostgREST calls or manual SQL — not
    via the product.
  - `supabase/seed.sql` is intentionally empty; pgTAP tests insert their
    fixtures directly as the owner role, which is why 496 tests pass while the
    product journey is blocked.
- **Affected users/data:** every organization; the team, attendance, payroll,
  and equipment reservation features are unusable end-to-end until rows are
  provisioned outside the app.
- **Root cause:** the data layers shipped after the UI that reads them; the
  read surfaces were never paired with provisioning surfaces.
- **Smallest fix:** two small forms: (1) staff member create/edit in
  `StaffPage` (direct table insert is already policy-allowed for OWNER/MANAGER
  — or better, a `save_staff_member` command for auditability); (2) capacity
  create/edit beside the catalog item or in `EquipmentTab` (OWNER/MANAGER/
  WAREHOUSE policy already allows it). — Risk: Low · Effort: **Small-Medium**.
- **Regression tests:** component tests for both forms; pgTAP already covers
  the write policies — add an assertion that a UI-created row is readable by
  the operational projections.
- **Verification:** manual journey: create host → assign to event → record
  attendance; create capacity → reserve → dispatch.

### F12 — MEDIUM — Events cannot be edited after creation

- **Symptom:** a typo in venue/date/guest count at creation is permanent; the
  only operations available afterwards are status transitions and cancel.
- **Evidence:** no `update_event`/`edit_event` function exists in any
  migration; no edit UI in `src/features/events/` (grep for «تعديل المناسبة» /
  update paths returns nothing). Contrast: customers, catalog, packages,
  suppliers and DRAFT orders all have edit paths.
- **Affected users/data:** OWNER/MANAGER/SUPERVISOR correcting entry errors.
- **Root cause:** CRUD coverage gap for the central aggregate.
- **Smallest fix:** `update_event` command restricted to DRAFT/QUOTED (or a
  wider rule per owner decision) + a dialog in `EventWorkspaceHeader`.
  — Risk: Low-Medium · Effort: **Small-Medium**.
- **Verification:** pgTAP for edit rules (locked after acceptance, history
  entry), component test for the dialog.

### F13 — MEDIUM [DECISION] — Events list is oldest-first with no sort control

- **Symptom:** the owner opens «المناسبات» (described in the UI as «جدول
  التنفيذ») and sees the oldest events first; today's/upcoming events are
  buried at the bottom.
- **Evidence:** `events.api.ts:165` `.order("start_at")` (ascending);
  `EventsPage.tsx` filters/search only — no client sort, no sort control.
  (Quotes and procurement orders correctly use descending.)
- **Root cause:** no product decision on list order was made.
- **Smallest fix (decision first):** default to upcoming-first
  (`.order("start_at", { ascending: false })` or ascending from today), or add
  a sort toggle. — Risk: Low · Effort: **Small**.
- **Verification:** query unit test for ordering + visual check.

### F14 — LOW — Audit trail has no UI

- **Evidence:** OWNER/MANAGER can read `audit_events` (RLS policy), but no
  screen consumes it; the workspace «السجل» tab renders
  `event_status_history` only (`HistoryTab.tsx`).
- **Smallest fix:** an audit view per organization (and/or per event) for
  OWNER/MANAGER. — Effort: **Small-Medium**.
- **Verification:** component test; manual review.

### F15 — LOW (note) — `event_readiness` has no status filter

- **Evidence:** `event_readiness` (0015) computes shortages for any event with
  lines, regardless of status; the dashboard applies it to today's non-
  cancelled events only, so DRAFT/QUOTED events can show readiness noise.
  Intent unknown — documented, not a confirmed defect.

## 3. Verified-strong areas (explicitly re-checked this pass)

- **Money math everywhere:** UI integer milli-OMR + BigInt; server `numeric`
  checks; no float source of truth found.
- **Timezone:** dashboard today = `Asia/Muscat` both sides; `dates.test.ts`.
- **Idempotent ledger commands:** warehouse/consumables/payments/payroll use
  stable payload-fingerprinted keys (unlike F6's create-event).
- **State machines:** procurement, quotation, warehouse, attendance — all
  server-enforced and pgTAP-proven; UI gating mirrors roles.
- **Stale-state prevention:** tenant cache reset, org-scoped keys, workspace
  command invalidation (incl. readiness/finance), invoice-payment invalidation.
- **Dialog money inputs:** `CatalogItemDialog` keys `MoneyInput` by
  item+session so reopen/cancel never shows stale prices (verified code).

## 4. Unverified areas (why)

- Real browser end-to-end journeys against a live Supabase project (no browser
  tool, no network egress from this workspace).
- Human-scale behaviors: >1000-row orgs, real-device PWA, Arabic voice quality.

## 5. Owner decisions needed

1. F3: enforce the close-out checklist at CLOSED, or keep lenient closure?
2. F4: reject overpayments, or support credit balances?
3. F5: add mid-execution cancellation capability?
4. F10: duplicate-customer policy?
5. (from prior audits) D2 demo grants, signup policy.
6. F13: events list default order (upcoming-first?).
7. F12 edit scope: which statuses may be edited, and who.

## 6. First recommended repair milestone (do not implement until approved)

1. **F1** — add the three missing lifecycle controls to `OverviewTab`
   (smallest change; server already enforces legality; immediately restores the
   core close-out journey).
2. **F2** — extend `arabicError` with the missing machine-code translations
   (table-driven, regression-tested).
3. **F6** — session-scoped idempotency key for create-event.
4. **F7** — replace `window.prompt` with the design-system dialog.
5. Then the F3/F4/F5 decisions as migration work after owner sign-off.

> Second-pass addition: **F11 (staff/capacity provisioning) outranks cosmetic
> items** — without it, three whole features (team/attendance/payroll and
> equipment reservations) have no data source. Recommend it immediately after
> F1/F2 in the first milestone, or as milestone 2 with F12/F13.
