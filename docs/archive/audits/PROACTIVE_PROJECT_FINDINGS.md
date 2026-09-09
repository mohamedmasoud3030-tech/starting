# PROACTIVE_PROJECT_FINDINGS.md — Independent Principal Auditor Report

> Discovery-only pass, 2026-08-17. **Nothing was modified** (verified: working
> tree clean; fresh `npm run build` ✓ and `npm run smoke:production` ✓ re-run;
> 496/496 tests and lint 0/0 from the immediately preceding pass; all 11 SPA
> routes return HTTP 200 on the running dev server).
>
> Findings are grouped by **root issue** (related symptoms share one entry) and
> ranked by **user/business risk**, not visual visibility. Severity scale:
> Critical / High / Medium / Low. Every entry lists evidence, impact, likely
> root cause, smallest fix, implementation risk & effort (Small/Medium/Large),
> and the exact post-fix verification.

---

## Executive summary

The system is engineering-strong underneath (exact OMR math, RLS everywhere,
idempotent ledgers, race-proof commands, atomic document numbering, well-indexed
hot queries, safe service worker, CI-green). The dominant product risk is that
**the visible app is narrower than the implemented engine**: the event
close-out journey — the product's core promise — cannot be completed from the
UI today, while the missing piece is surrounded by three under-defined
money/lifecycle rules that will surface the moment the UI catches up. The
highest business risk that is *not* code at all is the **unverified production
posture** (Dependabot alerts disabled, signup/backup settings unknown, live
deployment unreachable from this workspace).

---

## Ranked findings

### P1 — RESOLVED (2026-08-17) — Event close-out is reachable and guarded

- **Category:** product completeness / state machine. **Affected:** OWNER,
  MANAGER, SUPERVISOR; every event's history and profit close-out.
- **Evidence:**
  - `src/features/events/workspace/OverviewTab.tsx:47,54` renders exactly two
    transitions (`PREPARING`, `DISPATCHED`). A search for `p_to:` across `src/`
    finds **no other transition UI**.
  - Server `transition_event_status` (migration
    `0014_event_commercial_commands.sql:42`) explicitly permits the full chain
    `CONFIRMED→PREPARING→DISPATCHED→IN_PROGRESS→RETURNING→CLOSED`.
  - `docs/architecture/02-event-lifecycle.md` promises a checklist-controlled
    CLOSED (equipment returned, consumables reconciled), but the server checks
    only the status pair — no equipment/consumable reconciliation condition.
  - The transition accepts `SUPERVISOR`, while final warehouse reconciliation
    (`reconcile_event_warehouse`, migration 0021) is OWNER/MANAGER-only.
- **Impact:** the product's core promise — "a closed, profitable event" — has
  no usable path after dispatch. If a naive fix only adds the buttons, events
  would close with equipment still on site and profit figures presented as
  final while incomplete (the documentation already claims the opposite).
- **Root cause:** UI implementation stopped mid-state-machine; the close-out
  checklist exists only in documentation, not in the database.
- **Smallest fix (two parts):**
  1. Add the three missing transition buttons to `OverviewTab` using the
     existing `run(...)` dispatcher (server already validates each step).
     — Risk: Low · Effort: **Small**.
  2. Owner-approved migration adding a CLOSED pre-check (outstanding equipment
     = 0 AND consumables reconciled, or explicit OWNER/MANAGER override).
     — Risk: Low-Medium · Effort: **Small-Medium** (new migration + pgTAP).
- **Verification:** extend a workspace-model/component test asserting which
  transition buttons appear per status; pgTAP case "CLOSED blocked while
  equipment outstanding"; manual journey on a seeded event through to CLOSED
  with the reconciliation tabs.

### P2 — RESOLVED (2026-08-17) — Arabic machine-code translation completed

- **Category:** UX/error handling. **Affected:** the primary persona.
- **Evidence:** `src/features/events/events.api.ts:384-393` `arabicError`
  translates only 3 codes (`STAFF_CONFLICT`, `EQUIPMENT_SHORTAGE`,
  `EVENT_PRICING_LOCKED`) and returns the raw message otherwise;
  `src/features/events/useEventWorkspace.ts:88` routes **every** workspace
  command failure through it; `src/features/events/EventsPage.tsx` uses the
  same translator for the create dialog. Uncovered codes confirmed in the
  server: `INVALID_EVENT_WINDOW`, `INVALID_GUEST_COUNT`, `CUSTOMER_NOT_IN_ORG`,
  `CANCELLATION_REASON_REQUIRED`, `EVENT_CANNOT_BE_CANCELLED`,
  `RESERVATION_HAS_OUTSTANDING_EQUIPMENT`, `CONSUMABLE_STOCK_SHORTAGE`,
  `EVENT_NOT_PAYABLE`, `PAYMENT_REQUIRES_ACCEPTED_QUOTATION`, and the free-text
  `INVALID_EVENT_TRANSITION: % -> %`. (Procurement, staff, quotes and login
  have complete Arabic translators — the events domain was never extended.)
- **Impact:** the non-technical owner sees English codes instead of guidance on
  the screens used most; erodes trust and increases support load. No data
  impact.
- **Root cause:** per-domain translator drift; events translator not extended
  as commands were added.
- **Smallest fix:** extend `arabicError` to a table-driven map covering the
  listed codes (or adopt the shared registry proposed in
  `TECH_DEBT_AUDIT.md` C1). — Risk: Low · Effort: **Small**.
- **Verification:** table-driven unit test: each code maps to a non-code Arabic
  string; assert no output contains a known machine code; lint/typecheck.

### P3 — RESOLVED (2026-08-17) — overpayment rejected above accepted revenue (migration 0058)

- **Category:** money/business rule. **Affected:** OWNER, MANAGER, ACCOUNTANT;
  customer financial records.
- **Evidence:** `record_customer_payment`
  (`supabase/migrations/0036_customer_payments_commands.sql`) validates only
  amount > 0 and 3-decimal precision (`assert_payment_omr`); there is **no
  comparison against accepted revenue**. `invoice_summaries.remaining_balance`
  (`0043_invoices_security_read_models.sql`) is computed as
  `total_amount − paid_total` with no floor.
- **Impact:** a customer who overpays (or a mistyped amount) produces a
  negative "المتبقي" — an accounting-visible contradiction. No data loss.
- **Root cause:** the overpayment rule was never defined — not an implementation
  slip.
- **Smallest fix (decision first):** reject overpayment in the command, or keep
  credit semantics and relabel the display («رصيد دائن»). — Risk: Low ·
  Effort: **Small** (command guard or view change + pgTAP case).
- **Verification:** pgTAP case for the chosen rule; UI check of the label.

### P4 — RESOLVED (2026-08-17) — session-stable idempotency key

- **Category:** correctness/duplicate data. **Affected:** OWNER/MANAGER/
  SUPERVISOR creating events.
- **Evidence:** `src/features/events/events.api.ts:321`
  `p_idempotency_key: crypto.randomUUID()` runs inside the mutation body, so a
  re-submit after an ambiguous failure (timeout/lost response) sends a **new**
  key; the server replay (migration 0014) only matches an identical key, so a
  second event row is created. (Contrast: quotation convert is protected by a
  unique `converted_event_id`; cancel is status-guarded.)
- **Impact:** duplicate events in list/dashboard after a retry; cleanup burden.
- **Root cause:** key lifetime tied to the request instead of the form session.
- **Smallest fix:** generate the key once per dialog session (`useRef`
  initialized on open, reset on success/close) and reuse it for every attempt.
  — Risk: Low · Effort: **Small**.
- **Verification:** mutation unit test asserting the same key across two calls
  of one session; manual double-submit with throttled network shows one event.

### P5 — RESOLVED (2026-08-17) — mid-execution cancellation enabled (migration 0058)

- **Category:** product completeness. **Affected:** operators on site.
- **Evidence:** `cancel_event` (`0022_warehouse_security_and_read_models.sql`)
  allows only DRAFT/QUOTED/CONFIRMED/PREPARING and raises
  `EVENT_CANNOT_BE_CANCELLED` otherwise; `OverviewTab.tsx` mirrors the same
  statuses. UI and server agree — the capability itself is missing.
- **Impact:** an event aborted mid-execution has no terminal state; it lingers
  in DISPATCHED/IN_PROGRESS forever (compounded by P1).
- **Root cause:** conservative state machine; intent never defined.
- **Smallest fix (decision first):** extend `cancel_event` to execution
  statuses while preserving the S4A rule that outstanding equipment stays
  accountable, and surface the button. — Risk: Medium (lifecycle change) ·
  Effort: **Medium**.
- **Verification:** pgTAP for cancel-with-outstanding-equipment; UI journey.

### P6 — MEDIUM (security-sensitive) [OWNER DECISION] — Public demo grants live in the production schema

- **Category:** security posture. **Affected:** any organization whose name
  matches the demo name exactly.
- **Evidence:** migrations `20260816083938_public_demo_full_access.sql` and
  `20260816085022_public_demo_admin_role_grants.sql` make `anon` inherit
  `public_demo_admin` (verified on a replayed database:
  `anon ∈ public_demo_admin`) with table/function grants whose only scope
  guard is `app_private.is_public_demo_request()` — exact organization **name**
  `شركة الريان للضيافة - Demo` + active. `organizations.name` has no uniqueness
  constraint. Mitigations in place: the browser flag `VITE_PUBLIC_DEMO_MODE`
  defaults off, and `create_organization` is now revoked from browser roles
  (migration 0056), which blocks anonymous visitors from *creating* such an
  org — but a pre-existing org with that name in production would be fully
  writable by anyone with the public anon key.
- **Impact:** conditional, depends on production data; potential
  unauthorized write access to one tenant if the name exists.
- **Smallest fix (decision first):** when the demo period ends, an
  owner-approved migration removing the grants (reversible by design), or keep
  them but pin the scope to a fixed UUID as well as the name.
- **Verification:** after removal, pgTAP asserts anon has no EXECUTE/table
  grants; re-run RLS suite.

### P7 — MEDIUM (operations) — Production posture is unverified and partially unwatched

- **Category:** operations/security tooling. **Affected:** the business.
- **Evidence:** (a) GitHub API returns *"Dependabot alerts are disabled for
  this repository"*; enabling via API from this workspace failed (owner action
  only). (b) `enable_signup` / backup schedule / plan tier of the production
  Supabase project are dashboard-only settings — not verifiable from the repo.
  (c) The live deployment (`jiwdah.vercel.app`) and production project are
  unreachable from this workspace (no network egress), so the deployed bundle
  and production settings have never been observed during this engagement.
  Mitigation present: CI runs `npm audit --audit-level=high` (0 advisories
  today).
- **Impact:** silent decay window for dependency advisories; unknown signup
  posture; unverified recovery path.
- **Smallest fix:** owner enables Dependabot alerts (Settings → Code security);
  one documented operator checklist run (signup, backups, demo flag off,
  session settings). — Effort: **Small** (settings), no code.
- **Verification:** dependabot PRs appear on next advisory; operator checklist
  signed off.

### P8 — MEDIUM (confidence) — No browser-level E2E tests and no error telemetry

- **Category:** testing/monitoring. **Affected:** release confidence.
- **Evidence:** no Playwright/Cypress anywhere; CI tests = jsdom unit/component
  tests + static smoke proofs only. `ErrorBoundary` logs to `console.error`
  with no collector; no Sentry/analytics (deliberate per privacy docs, but
  server-error visibility is then dashboard-only).
- **Impact:** journeys like P1 could regress silently; production render errors
  are invisible until a user reports them.
- **Smallest fix:** one E2E smoke suite (sign-in → dashboard → event create)
  against a CI-spawned Supabase stack; optional lightweight error collector
  (privacy-reviewed). — Effort: **Medium**.
- **Verification:** E2E job green in CI.

### P9 — LOW — PWA icons appear to be minimal placeholders

- **Category:** brand/PWA installability. **Affected:** installing users.
- **Evidence:** `public/pwa-512.png` is 1.4 KB, `pwa-192.png` 0.6 KB,
  `apple-touch-icon.png` 0.5 KB — sizes consistent with flat single-glyph
  placeholders rather than a designed brand icon. (This workspace has no image
  preview, so visual confirmation is pending.) Manifest references and sizes
  are technically correct (smoke-tested).
- **Impact:** unprofessional install screen; low functional impact.
- **Root cause:** placeholder assets shipped from the foundation phase.
- **Smallest fix:** commission/design branded icons at 192/512/180.
  — Effort: **Small** (asset only).
- **Verification:** visual review + Chrome installability/Lighthouse PWA check.

### P10 — RESOLVED (2026-08-17) — `.env.production` untracked and gitignored

- **Category:** hygiene/secrets discipline. **Affected:** repository safety.
- **Evidence:** `git ls-files` includes `.env.production`, which contains the
  production Supabase URL and the publishable anon key. Publishable keys are
  by design public, so this is **not a secret leak** — the risk is cultural:
  a future editor may append real secrets to a tracked env file, and the
  production project identity is publicized.
- **Smallest fix:** stop tracking `.env.production` (keep `.env.example` as the
  template), set production values in Vercel env only.
  — Effort: **Small** (owner can do it in one commit).
- **Verification:** `git ls-files | grep .env` returns only `.env.example`.

### P11 — RESOLVED (2026-08-17) — ConfirmPanel-based void/edit dialogs everywhere

- **Evidence:** `OverviewTab.tsx:64` `window.prompt("سبب الإلغاء")`.
- **Impact:** page-blocking dialog, poor on the mobile PWA; design system has
  `ConfirmPanel`/`Dialog` for exactly this.
- **Smallest fix:** use the design-system dialog with a required reason input.
  — Effort: **Small**.
- **Verification:** component test for the cancel flow.

### P12 — RESOLVED (2026-08-17) — events load-more pagination + debounced quote autosave (customers/catalog keep cap warnings)

- Already registered as defects D21 (pagination; cap warnings in place) and
  D22 (autosave; blocking guard in place). Included here for completeness —
  not new findings.

---

## Verified-strong areas (independently re-checked this pass)

- **Money:** integer milli-OMR + BigInt in UI; `numeric(12,3)` + checks in DB;
  no float authority found.
- **Tenant isolation:** RLS 36/36 tables; composite FKs; cost separation at the
  data boundary; `create_organization` revoked from browser roles.
- **Concurrency:** stable lock ordering + BEFORE-INSERT guards + payload-
  fingerprinted idempotency (warehouse/consumables/payments/payroll/quotations);
  8 two-session harnesses PASSED.
- **Document numbering:** `next_document_number` is atomic
  (INSERT … ON CONFLICT DO UPDATE RETURNING) and revoked from clients.
- **Indexes:** hot paths covered (`events_org_start_idx`, ledger FK indexes,
  staff/invoice/procurement indexes; 132 total).
- **PWA:** SW caches only same-origin static assets; never intercepts
  Supabase/non-GET; offline shell; self-hosted fonts (no external CDN).
- **Headers:** CSP + nosniff + DENY + referrer policy in `vercel.json` (smoke-
  enforced).
- **Dependencies:** 0 known advisories; no deprecated packages; install scripts
  limited to standard binaries; lockfile in sync.
- **Quality gates:** 496/496 tests · lint 0/0 · typecheck · build · production
  smoke · CI green on `main` with a type-drift gate.

## Quick wins (separate list — none outranks a security/data item)

1. P2 — complete the Arabic machine-code translator (events domain).
2. P4 — session-scoped idempotency key for create-event.
3. P1a — add the three lifecycle buttons (server already enforces legality).
4. P11 — replace `window.prompt` with the design-system dialog.
5. P10 — untrack `.env.production` (owner commit).

## Unverified areas (and why)

- Live Vercel deployment and production Supabase project: no network egress
  from this workspace, no browser automation.
- Production dashboard settings (signup, backups, plan, session duration).
- Real-device PWA install/offline and Arabic voice quality (mocked tests only).
- PWA icon visual quality (no image preview in this workspace).
- Human UAT checklists: no execution evidence.

---

## قرارات المالك — Arabic decision summary

### ١. أهم خمس مشكلات خفية
1. **إغلاق المناسبة مستحيل من الواجهة** (تتوقف الأزرار عند «تأكيد الإرسال» رغم أن الخادم يدعم كل الخطوات حتى CLOSED) — وعد المنتج الأساسي «مناسبة مغلقة وربحية» غير قابل للتحقيق اليوم من الشاشة.
2. **لا حارس للإغلاق:** أول ما يُضاف زر الإغلاق، قد تُغلق مناسبة بمعدات ما زالت في الخارج وأرباح تظهر «نهائية» وهي ناقصة — الوثائق تعد بقائمة تحقق لا وجود لها في قاعدة البيانات.
3. **الرصيد السالب:** الدفع الزائد مقبول فيظهر «المتبقي» بالسالب للعميل — قاعدة عمل غير معرَّفة أبداً.
4. **رسائل إنجليزية خام** (مثل `INVALID_EVENT_WINDOW`) تظهر للمالك على أهم الشاشات، بينما بقية المجالات مترجمة كاملة.
5. **وضع العرض العام ما زال مثبتاً في مخطط الإنتاج** (قدرات OWNER للزوار المجهولين على أي منظمة تحمل الاسم التجريبي حرفياً) + **التقادم التشغيلي**: تنبيهات Dependabot معطلة وإعدادات الإنتاج غير مؤكدة.

### ٢. أسرع ثلاث مكاسب آمنة
(1) إكمال ترجمة أكواد الأخطاء في مجال المناسبات. (2) مفتاح idempotency ثابت لكل جلسة إنشاء مناسبة (يمنع التكرار). (3) إضافة أزرار دورة الحياة الناقصة (الخادم يحميها أصلاً). — الثلاثة تعديلات واجهة صغيرة قابلة للعكس مع اختبارات انحدار.

### ٣. أول مرحلة إصلاح مقترحة (بانتظار تفويضك)
«استعادة رحلة الإغلاق»: P1a (الأزرار الثلاثة) + P2 (الترجمة) + P4 (مفتاح idempotency) + P11 (حوار سبب الإلغاء) — كلها صغيرة، موثقة الاختبار، ولا تلمس قاعدة البيانات.

### ٤. أفعال تتطلب موافقتك
قرار قاعدة الإغلاق مع التسوية (P1b) · قاعدة الدفع الزائد (P3) · إلغاء المناسبات قيد التنفيذ (P5) · إزالة منح العرض العام من الإنتاج (P6) · إزالة تتبع `.env.production` (P10) · تفعيل Dependabot (P7) · أي لمس للإنتاج أو الترحيلات أو البيانات.

### ٥. ما لم أستطع التحقق منه
الموقع المنشور ومشروع Supabase الإنتاجي وإعدادات لوحدهما، سلوك PWA والصوت على أجهزة حقيقية، جودة الأيقونات بصرياً، وتنفيذ بنود UAT البشرية.
