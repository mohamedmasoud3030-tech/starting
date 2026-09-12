# Independent MVP & Deep-Clean Audit — Hospitality Operations (`starting`)

**Audit date:** 2026-09-12
**Audited state:** branch `arena/01a09729-starting`, base commit `5ac6cc07` (= current `main` HEAD, "fix: executive implementation — storage enabled, assistant degraded flag, health panel, auto settings, guides, day1 checklist", 2026-09-11)
**Mode:** strictly read-only. No application, configuration, schema, migration, test or dependency file was modified, created, moved or deleted. No tests, builds, typechecks, migrations or scripts were executed. The only artifact produced is this report.
**Method:** direct source inspection (352 TS/TSX files, ~49.7k lines non-test; 104 migration files, 36,131 lines SQL; 47 pgTAP files, 1,631 assertions; 113 vitest files), static client↔database contract analysis, plus read-only GitHub metadata (CI run conclusions, job steps, check-run annotations, commit list, compare API, open PRs).
**Environment constraint:** the workspace has **no `node_modules`, no Docker, no Supabase CLI and no `.env`**, so nothing could be executed. Every claim that would require execution is labelled **Needs verification**.

---

## 1. Executive Summary

- **What the application is today:** an Arabic-first (RTL), multi-tenant hospitality/event-operations SPA — React 19 + Vite 6 + TanStack Router/Query + Tailwind 4 — with **no custom backend at all**. PostgreSQL-on-Supabase *is* the application server: 104 migrations define schema, RLS, 270+ `SECURITY DEFINER` command functions and read models; the browser only calls `supabase.rpc()` / PostgREST plus one Deno edge function (the "لينا" voice assistant).
- **The code is genuinely coherent, not a pile of half-finished layers.** I statically cross-checked the client against the database: **all 82 distinct RPC names the UI calls exist in the migrations**, **all 48 relations the UI reads exist and carry `GRANT SELECT … TO authenticated`**, and only **3 real argument-shape mismatches** exist in the entire codebase (all in the face-recognition API, a feature that is deliberately inert in production). Money is handled with integer milli-OMR + `BigInt` and centralised rounding (`src/lib/money.ts`). This is a well-engineered system, and the documentation's confidence is largely deserved at the *code* level.
- **What is actually working (by inspection):** the complete commercial spine — signup → login → first-organization onboarding → customers/catalog/packages → quotation draft (autosaved) → issue → accept → convert to event → 13-tab event workspace (pricing, team, equipment, warehouse, consumables, procurement, payments, invoices, finance, attendance, payroll, history) → operational status transitions → financial close with profit-at-close → reports/dashboard/accounting/aging/statements → printable official documents. Every one of these screens is wired to a real RPC or granted read model; I found **no UI-only mock screens**.
- **The single biggest blocker is operational, not architectural: there is no connected database.** The repo contains no `.env` (correctly — `.gitignore` excludes it), and `src/lib/supabase.ts:12-19` gates *every* network call behind `isSupabaseConfigured`, with `LoginPage`/`SignupPage`/`ForgotPasswordPage` disabling their submit buttons and showing "النظام غير مهيأ بعد". **Until a Supabase project exists with all 104 migrations applied and its URL + anon key placed in `.env`, the application cannot be opened and demonstrated at all** — it renders a dead login screen. There is deliberately no demo/fallback login (removed forward-only by migration 0059).
- **The repository's own authoritative database gate is RED at `main` HEAD — confirmed from CI, not guessed.** Run `34549226774` (2026-09-11): *Frontend* job **success** (typecheck, lint, tests, build, smoke), *Database* job **failure** at step 9 "Run pgTAP tests". The CI check annotation names the exact cause: `supabase/tests/evidence_hardening.test.sql` → **"Failed 9/34 subtests"**, `ERROR: Direct deletion from storage tables is not allowed. Use the Storage API instead. CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE` at line 198. Steps 10–18 (five concurrency proofs, backup→restore proof, type generation and the **type-drift gate**) were **skipped and therefore never ran on HEAD**. Crucially, step 8 "Replay migrations from a clean database" **succeeded** — the schema itself builds clean; only the test fixture is incompatible with its environment.
- **Root cause of the red gate is one line in the last commit.** The GitHub compare API shows the only database-affecting changes between the last green run (`e3d97195`) and red HEAD are `supabase/config.toml` (+2/−2 → `[storage] enabled = true`, line 47) and new migration `0103`. Enabling the local storage service installs Supabase's `storage.protect_delete()` trigger; the pgTAP fixture at `evidence_hardening.test.sql:195-199` simulates a Storage-API deletion with a **direct `delete from storage.objects`**, which that trigger now forbids → the transaction aborts → 9 subsequent subtests fail. The last session's own gate table (`IMPLEMENTATION_REPORT.md §2`) lists typecheck/tests/build/smoke/lint but **omits the database gate entirely** — it shipped a red `main` without running it.
- **Two user-facing defects will actively disrupt a demo**, both in the newest code: (1) `SystemHealthPanel`'s "اختبار رفع ملف" self-test **can never succeed** — it uploads to `{org}/TEST/health_*.txt` while the storage INSERT policy casts path segment 2 to the `attachment_evidence_type` enum, which has no `TEST` member; the panel then tells a non-technical founder to go create a bucket that already exists. This is **step 4 of the project's own `docs/DAY1_TEST_CHECKLIST.md`**. (2) The whole "المطاعم المتعاقدة" feature **swallows every database error** (`restaurants.db.ts:48-56`): `runRpc` and `selectRows` discard `error`, so failed contract/booking writes close the dialog and "reload" the list as if they succeeded — a textbook *UI shows success while the operation failed*.
- **Is an MVP realistically close? Yes — unusually close.** Nothing needs to be built. The shortest path is: provision + connect a Supabase project, apply the 104 migrations, un-red the DB gate, fix two small defects, and run the existing day-1 script. **Realistic total: ~1.5–2.5 focused working days**, of which the code work is roughly 4–6 hours.
- **What should explicitly NOT be touched before the demo:** the procurement ports/adapters refactor, the face-recognition feature, the duplicate statement documents, the audit-trail gap on direct table writes, dark mode/PWA polish, documentation reconciliation, and any production-infrastructure work. None of these blocks a demonstration.

---

## 2. Current MVP Status

### 2.1 Working End-to-End (wiring confirmed by inspection; runtime confirmation Needs verification)

| Journey | Evidence |
| --- | --- |
| Sign up → sign in → password reset | `src/features/auth/{SignupPage,LoginPage,ForgotPasswordPage}.tsx`; `AuthContext.login` (`src/app/AuthContext.tsx:143-166`); both email-confirmation modes handled (`SignupPage.tsx:41-56`) |
| First-run onboarding: create own organization and become OWNER | `AuthContext.createOrganization` → `rpc("create_organization")`; grant to `authenticated` restored by `0061_self_serve_onboarding.sql:7`; `p_display_name` has a SQL default so the single-arg call resolves (`0009_commands.sql:7`); profile row auto-created by trigger `on_auth_user_created` (`0003:84-87`) |
| Join by invitation (multi-user demo) | `AuthContext.claimInvitation` → `claim_org_invitation`; server-side email match + PENDING check; Arabic rejection mapping `AuthContext.tsx:376-395` |
| Organization switching with hard tenant cache reset | `AuthContext.tsx:222-236` + `src/app/tenantCache.ts`; org id persisted (`organizationPreference.ts`) |
| Customers CRUD + customer 360 file | `customers.api.ts` (direct writes, RLS-gated), `rpc("customer_360")`, `CustomerDetail.tsx` |
| Catalog & packages (templates) | `catalog.api.ts`, `packages.api.ts` → `save_package` (arg shape verified correct) |
| Quotation lifecycle: draft (atomic, autosaved) → pricing → issue → accept → revise → reject/expire → cancel | `quotes.api.ts` (11 mutations), `useQuotationDraft.ts`, `QuotationReview.tsx`; canonical lifecycle in `0050`–`0053`; 47-assertion pgTAP `canonical_quotation_lifecycle.test.sql` |
| Convert quotation → event, then land in the workspace | `quotes.api.ts:useConvertQuotation` → `navigate({to:"/events/$eventId"})` (`QuotationReview.tsx:115`) |
| Event workspace, 13 tabs, all with real panels | `eventWorkspace.model.ts:10-24`; every tab imported and rendered in `EventWorkspace.tsx:22-40` (Overview/Pricing/Team/Equipment/Warehouse/Consumables/Procurement/Payments/Invoices/Finance/Attendance/Payroll/History) |
| Operational status transitions + override with reason | `events.api.ts:useEventCommand` (dynamic `callRpc`, `events.api.ts:437`), `0066_event_transition_override`, `OverviewTab.tsx` |
| Warehouse dispatch/return/reconcile; consumable issue/consume/return/waste/reconcile | `warehouse.api.ts`, `consumables.api.ts`; RPC names + args verified; pgTAP `warehouse_dispatch`, `consumable_stock`, `warehouse_concurrency` |
| Procurement orders + suppliers + receiving | `procurement.api.ts` behind `supabaseDataSource.ts`; pgTAP `procurement_core`, `procurement_integration` |
| Customer payments, voids with reason, invoices + installments | `payments.api.ts`, `invoices.api.ts` (arg shapes verified); `0035`–`0037`, `0041`–`0043`, `0058`, `0086` |
| Manual attendance clock-in/out with mandatory photo evidence | `staff.api.ts:438-459` (`clock_staff_in` args match `0083`), evidence upload → private bucket → `link_evidence` verification (`attachments.api.ts:76-101`) |
| Host payroll per event, advances, settlement, period sheet | `staff.api.ts`, `HostPayrollPanel.tsx`, `PayrollPeriodSheet.tsx`; `0038`–`0040`, `0076`, `0089`, `0092` |
| Event expenses + financial close with profit-at-close, reopen | `finance.api.ts:218-244` → `close_event_financially` / `reopen_event_financially`; `EventFinancePanel.tsx:284,323`; `0067`–`0069`, `0097` |
| Accounting ledger, treasury, AR/AP/contract-asset aging, customer & supplier statements, reconciliation | `accounting.api.ts`, `AccountingPage.tsx`; `0084`–`0097`; pgTAP `ledger_foundation`, `accounting_read_models`, `stage3_aging_statements`, `financial_closeout` |
| Reports, management dashboard, integrity center, global search | `intelligence.api.ts` → `report_events`, `report_customers`, `report_packages`, `management_metrics`, `management_alerts`, `integrity_findings`, `global_search` |
| Official printable documents (10 kinds) from live system data | `src/features/documents/*` + `PrintDocumentDialog.tsx`, used from 8 screens; `0080`, `0081` |
| Delegated per-member permissions (owner overrides on role presets) | `0079`, `capabilities.api.ts` → `my_capabilities`, `AuthContext.tsx:250-283`; server is authoritative, UI only mirrors |
| PWA shell, offline banner, theme, RTL, large-touch "senior" UI | `public/sw.js` (never caches REST/Auth, lines 14-17), `src/pwa/*`, `src/lib/theme.ts`, `index.html` (`lang="ar" dir="rtl"`), self-hosted Cairo font |

### 2.2 Partially Working

| Item | What starts but does not complete | Evidence |
| --- | --- | --- |
| **Face-assisted attendance ("بصمة الحضور بالكاميرا")** | The UI, dialog, enrollment flow, local template store, DB tables and 4 RPCs all exist — but the provider registry is never populated in application code, so `resolveFaceProvider()` always returns `null` and every assisted surface degrades to manual. Separately, all three face write RPCs are called with **wrong argument names**, so if a provider were ever registered the flow would break immediately. | `face/provider.ts:57-77` (`registry.factory = null`; `__registerFaceProviderFactory` referenced only by `provider.ts` and tests); `face.api.ts:69` (`p_template_reference` vs DB `p_template_ref`), `face.api.ts:89` (extra `p_idempotency_key`), `face.api.ts:165` (`p_outcome`/`p_confidence` vs DB `p_action`/`p_confidence_label`) vs `0083:173-180, 246-249, 394-400` |
| **AI assistant "لينا"** | Fully built (chat/STT/TTS, hybrid mic, degraded badge, caller-token RLS reads). Requires an out-of-repo deployment: the edge function must be deployed and `GEMINI_API_KEY` set; otherwise every answer is deterministic/degraded. Model IDs `gemini-3.7-flash` / `gemini-3.1-flash-tts-preview` are asserted nowhere and could not be validated from here. | `supabase/functions/ai-assistant/index.ts:21-23, 54, 94-95, 270-295, 430-482`; `config.toml:69-71`; `AssistantLauncher.tsx:65-69` (`VITE_ENABLE_ASSISTANT`) |
| **Contracted restaurants & meal bookings** | Reads and writes are wired to real RPCs/views, but every server error is discarded, so failures are invisible and successes are assumed; the page also opts out of TanStack Query, so no other screen is invalidated after a write. | `restaurants.db.ts:42, 48-56, 100-179`; `ContractedRestaurantsPage.tsx:73-93, 451-473` |
| **System health diagnostics** | Read-only checks are sound; the upload self-test always fails and misattributes the cause. | `SystemHealthPanel.tsx:80-96` vs `0074:27-37, 237-246` |
| **Database verification gates** | Migration replay is green; pgTAP is red on one file; concurrency, backup/restore and type-drift gates never executed on HEAD. | CI run `34549226774` steps 8 (success), 9 (failure), 10–18 (skipped) |

### 2.3 Broken / Blocked

| Item | Nature | Evidence |
| --- | --- | --- |
| **The application cannot start meaningfully in this state** | No Supabase credentials anywhere in the workspace; all auth and data paths are gated off; login/signup buttons are disabled. | no `.env` (only `.env.example`); `src/lib/supabase.ts:4-19`; `LoginPage.tsx:124, 206`; `SignupPage.tsx` (same pattern); `ForgotPasswordPage.tsx:79` |
| **`supabase test db` fails at HEAD** | Blocks trusting/certifying the schema you are about to demo, blocks CI merge signals, and suppresses 9 downstream gates. | CI annotation on check-run `103108389674`; `supabase/tests/evidence_hardening.test.sql:195-199`; `supabase/config.toml:47` |
| **Storage self-test in Settings** | Always reports failure for a healthy system. | see 2.2 |
| **Restaurants writes report false success** | Silent failure on a money-adjacent operational screen. | see 2.2 |

### 2.4 Missing (required for an MVP demo)

1. **A provisioned Supabase project** (hosted free tier or local Docker stack) with **all 104 migrations applied** and the private `attachments` bucket present (created by `0074:210-212`).
2. **A `.env`** with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (names only are documented in `.env.example`).
3. **A demo dataset.** `supabase/seed.sql` is intentionally empty ("No demo/production seed data is committed by policy"), so every demo run starts from zero and must be typed in by hand (the DAY1 checklist does exactly this: customer → catalog item → quote → event → payment → expense → close). For a repeatable sales demo this is ~20–30 minutes of manual data entry each time.
4. **An email-confirmation decision.** With Supabase's default (confirm email = ON), signup returns no session and the flow stops at "check your inbox" (`SignupPage.tsx:52-55`). A demo needs either inbox access or confirmation switched off on the demo project.
5. **A green database gate** (or an explicit, written owner decision to demo with the known-red pgTAP file).

### 2.5 Non-Blocking (must NOT delay the MVP)

- Procurement's 3-layer ports/adapters abstraction (6,218 lines in the feature).
- Two parallel implementations of the customer statement document.
- Dead branding components (`CompanyHeader.tsx`, `CompanyNavbar.tsx`).
- No audit trail for direct table writes in 5 domains.
- `null` → `0` money rendering convention inconsistency between Dashboard and Reports.
- Client-side re-summation of payroll figures in 3 staff components.
- Documentation drift (migration counts 99/102/104, non-existent routes `/warehouse` and `/documents`, stale test counts, "four" mobile targets where three are listed, a LICENSE complaint about a LICENSE file that exists).
- Face recognition, assistant AI quality, dark mode, PWA install behaviour, accessibility polish, branch protection, observability, backups, performance.

---

## 3. Fastest Path to a Demoable MVP (Track A only)

Ordered. Each step is the minimum required to reach: **open the app → run the core journey → see a meaningful, persisted result.**

### Step 1 — Provision and connect a database (the actual blocker)
- **Objective:** make `isSupabaseConfigured` true against a real schema.
- **What needs to change:** create one Supabase project (hosted free tier is the fastest; local `supabase start` needs Docker, which is not installed in this workspace). Then `supabase link --project-ref <ref>` and `supabase db push` to apply all 104 migrations. Create `.env` from `.env.example` with the project URL + anon key. Confirm the private `attachments` bucket exists (Storage → Buckets).
- **Why necessary:** without it the app renders a disabled login screen and nothing else. There is no demo/offline data path by design (`0059`).
- **Dependencies:** owner's Supabase account. No code change. Migration replay is already proven green on HEAD by CI step 8.
- **Expected result:** `/login` becomes live; signup/login works.
- **Effort:** 1–3 h (mostly provisioning + migration push time).

### Step 2 — Unblock signup for the demo
- **Objective:** an uninterrupted first-run.
- **What needs to change:** on the demo project only, Auth → Providers → Email → **disable "Confirm email"**. (Alternative: keep it on and use a real inbox you control.)
- **Why necessary:** with confirmation on, `signUp` returns no session and `SignupPage.tsx:52-55` stops the flow at "تحقق من بريدك".
- **Dependencies:** Step 1.
- **Expected result:** signup → `OnboardingPage` → create organization → app shell, in one uninterrupted pass.
- **Effort:** 5 min. *(Track B: re-enable confirmation before any real customer use.)*

### Step 3 — Un-red the database gate
- **Objective:** `supabase db reset && supabase test db` green, so the schema you demo is the schema you certified, and so CI steps 10–18 (concurrency proofs, backup/restore, type-drift) actually run.
- **What needs to change — pick ONE:**
  - **(a) Preferred, smallest:** make the fixture environment-agnostic at `supabase/tests/evidence_hardening.test.sql:193-199` — instead of `reset role; delete from storage.objects …`, neutralise the guard the way the privileged subsystem would (e.g. `alter table storage.objects disable trigger …` / `set local session_replication_role = replica;` around the simulated deletion, then restore), keeping the assertion that `complete_evidence_reclaim` stamps `reclaimed_at`.
  - **(b) Also acceptable:** revert `supabase/config.toml:47` to `enabled = false`. The bucket row is inserted by migration `0074:210-212` regardless of the storage *service*, and a hosted project always has storage enabled — but this re-creates the local↔production divergence that hid the problem in the first place, so (a) is better.
- **Why necessary:** it is the only red gate; it also unblocks 9 skipped verification steps, including the type-drift gate that protects `src/lib/database.types.ts`.
- **Dependencies:** Supabase CLI + Docker locally, or simply push the change and read CI.
- **Expected result:** Database job green; concurrency/backup/type gates executed for the first time since `e3d97195`.
- **Effort:** 1–2 h (including one full CI cycle). **This is a test-harness fix; no production data path changes.** I verified that no application code or migration ever deletes from `storage.objects` (`0078:5` documents "It never deletes storage.objects"; the only storage deletions in the repo are in this one test file), so `storage.protect_delete()` cannot break the product itself.

### Step 4 — Fix the Settings storage self-test (30–60 min, demo-critical)
- **Objective:** `docs/DAY1_TEST_CHECKLIST.md` step 4 ("اضغط 'تشغيل فحص النظام' → يجب أن يكون كله أخضر، اختبر رفع ملف") passes.
- **What needs to change:** `src/features/settings/SystemHealthPanel.tsx:86` — use a valid evidence path and an allowed MIME type, e.g. `${orgId}/EXPENSE_RECEIPT/health_check/${crypto.randomUUID()}.jpg` with a tiny `image/jpeg` blob, run by a role that holds the write gate (`OWNER`/`MANAGER`/`ACCOUNTANT` per `0074:120-121`). Optionally drop the delete afterwards (`storage.remove` is fine — it goes through the Storage API, not a direct SQL delete).
- **Why necessary:** today the check *always* fails with a raw Postgres enum-cast error and the panel then instructs the founder to create a bucket that already exists. In front of a customer this reads as "the product is broken".
- **Dependencies:** Step 1.
- **Expected result:** all five health checks green, upload test green.
- **Effort:** 30–60 min.

### Step 5 — Stop the restaurants feature from lying (1–2 h)
- **Objective:** no screen may report success for a write the database rejected.
- **What needs to change:** in `src/features/restaurants/restaurants.db.ts`, make `runRpc` (line 53) and `selectRows` (line 48) inspect `error` and throw — i.e. route them through the canonical `callRpc` in `src/lib/rpc.ts:19-25`, which already does exactly this. Then delete the `as unknown as DynamicClient` cast (line 42) and the hand-rolled `Builder`/`ThenExec` types (lines 22-40): the premise in the comment at line 13 ("The generated database.types.ts predates migration 0099") is **factually false** — `database.types.ts` already contains `event_meal_bookings` (line 1141), `supplier_contracts` (3370), `meal_booking_summaries` (4282) and `supplier_contract_summaries`. The existing `restaurantErrorMessage` mapper and all the `.catch(...)` handlers in the page then start working as designed.
- **Why necessary:** it is a confirmed silent-failure/fake-success path on a live, navigable screen (`/procurement/restaurants`), and it is the only place in the codebase where database errors are discarded.
- **Fallback if time is short:** remove the nav entry (`navConfig.ts:88-92`) for the demo. Fixing is preferred — it is a small change.
- **Dependencies:** none (pure client change; CI frontend job re-verifies).
- **Expected result:** failed contract/booking writes surface an Arabic error and keep the dialog open; reads surface errors instead of rendering empty lists.
- **Effort:** 1–2 h.

### Step 6 — Decide the assistant's demo posture (5 min or 1–2 h)
- **Objective:** never show a half-working AI on stage.
- **What needs to change:** either set `VITE_ENABLE_ASSISTANT=false` in the demo build (hides the launcher entirely — `AssistantLauncher.tsx:65-69`), **or** deploy `supabase/functions/ai-assistant`, set the `GEMINI_API_KEY` secret, and verify the two model IDs at `index.ts:22-23` are valid for that account.
- **Why necessary:** undeployed or keyless, every reply is the deterministic fallback; the UI does now label this honestly ("وضع تجريبي — ردود عامة"), which is acceptable but is not a selling point.
- **Dependencies:** Step 1 (deploy target).
- **Effort:** 5 min to hide; 1–2 h to deploy and verify. **Recommendation: hide it for the first demo.**

### Step 7 — Rehearse the existing day-1 script and capture proof (1–2 h)
- **Objective:** a repeatable 5-minute demonstration.
- **What needs to change:** nothing in code. Execute `docs/DAY1_TEST_CHECKLIST.md` steps 1–16 verbatim (signup → org → health check → customer → catalog item → quote → issue → accept → convert → team → equipment → payment → expense → transitions → financial close → reports → accounting → dashboard). Correct two stale numbers in the checklist while you are there (it says "102 هجرة"; the directory holds 104).
- **Dependencies:** Steps 1–6.
- **Expected result:** the full "طلب العميل → مناسبة منفَّذة ومغلقة وربحية" promise demonstrated end-to-end with persisted, server-computed figures, plus a screen recording.
- **Effort:** 1–2 h per rehearsal (data entry from scratch each time — see Track B for a seeding story).

**Track A total: ~1.5–2.5 working days, of which ~4–6 h is code/CI work.** No new features, no refactoring, no schema redesign, no security relaxation.

---

## 4. Deep-Clean Findings

Severity scale: **Critical / High / Medium / Low**. MVP impact: **Blocker / Important / Non-blocking / None**.

### 4.1 Architecture

**A1 — The architecture is single-pattern and consistent, with exactly two documented exceptions.**
- **Finding:** 20 of 22 feature areas follow one identical shape: `feature/*.api.ts` → `callRpc()` or typed `supabase.from()` → TanStack Query hooks with org-scoped keys → component. Business rules live only in Postgres. There are no competing state libraries, no second data layer, no abandoned framework, no half-migrated routing.
- **Evidence:** `src/lib/rpc.ts:19-25` (single RPC wrapper); org-scoped query keys everywhere (`events.api.ts:152-165`, `tenantCache.ts`); `routes.tsx` (one route tree, all app routes behind `AuthGate`); `routes.lazy.tsx` (uniform lazy loading). Exceptions: procurement (A2) and restaurants (A3).
- **Impact:** low maintenance risk for the core; new work has an obvious template.
- **MVP impact:** None. **Confidence:** Confirmed by inspection.

**A2 — Procurement carries a three-layer abstraction no other feature has.**
- **Finding:** procurement is wrapped in a ports-and-adapters stack: `contracts.ts` (238 lines of interfaces) → `supabaseDataSource.ts` (779 lines) → `procurement.api.ts` (398 lines, the actual Supabase calls) → `useProcurementDataSource.ts` → `useProcurementCacheSync.ts`, plus a separate `orderMapping.ts` (169) and `validation.ts` (270). Total 6,218 lines for the feature.
- **Evidence:** `supabaseDataSource.ts:27` (`import * as api from "./procurement.api"`); `index.ts:29-30`; `ProcurementPage.tsx:5,12`; `useEventWorkspace.ts:10,55`.
- **Impact:** two mapping/validation vocabularies for one domain; every procurement change touches 3–5 files; it is the only feature where a reader must trace an interface to find the SQL call. It does **not** break anything — the layer is used consistently and is well tested (`supabaseDataSource.test.ts` 513 lines, `useProcurementDataSource.test.tsx` 279).
- **MVP impact:** Non-blocking. **Confidence:** Confirmed by inspection.

**A3 — Restaurants is a fourth data-access pattern, and an unsafe one.**
- **Finding:** `restaurants.db.ts` invents a hand-rolled untyped client (`DynamicClient`, `Builder`, `ThenExec`), bypasses the generated `Database` types, discards all errors, and the page uses `useState`/`useEffect` + a `reload` counter instead of TanStack Query — so no cache invalidation reaches any other screen after a meal booking or contract changes.
- **Evidence:** `restaurants.db.ts:13` (false premise), `:22-42` (cast), `:48-56` (errors discarded), `ContractedRestaurantsPage.tsx:73-93` (manual effect + `reload`); zero `useQuery`/`useMutation`/`invalidateQueries` occurrences in the page.
- **Impact:** silent failures (see D1), stale cross-screen caches, no type safety on table/column/RPC names, and a pattern a future contributor may copy.
- **MVP impact:** Important (Track A Step 5 fixes the error-swallowing cheaply). **Confidence:** Confirmed by inspection.

**A4 — Five domains write straight to tables, contradicting the codebase's own stated rule.**
- **Finding:** `src/lib/rpc.ts:7-9` asserts "Every business write in this application is a server-authoritative SECURITY DEFINER command reached through `supabase.rpc`." That is false for customers, catalog, staff members, equipment capacity and event logistics edits.
- **Evidence:** `customers.api.ts:96-106` (`.update`/`.insert`), `catalog.api.ts:241, 266, 291`, `staff.api.ts:1047-1053`, `warehouse.api.ts:252-258`, `events.api.ts:509-524` (event UPDATE via the `0057` RLS policy).
- **Impact:** these writes are still authorized (RLS `WITH CHECK` policies) and still validated by column constraints, so **there is no security hole**; but they bypass `record_audit` (`0007:34`, called from 181 sites inside commands and revoked from client roles at `0007:53-54`) and bypass the idempotency register (`0049`). Master-data edits and event-date edits therefore leave **no audit history**, which contradicts `AGENTS.md` ("عمليات المخزن يجب أن تكون قابلة للتدقيق") and the product's audit posture.
- **MVP impact:** Non-blocking. **Confidence:** Confirmed by inspection.

**A5 — Client-supplied context is trusted for the assistant's permission narrative.**
- **Finding:** the edge function injects the *client's own* claim about its capabilities into the model prompt.
- **Evidence:** `supabase/functions/ai-assistant/index.ts:122` (`capabilities?: { canReadCost?, canReadPayroll?, canManageCommercial? }` inside the request `context`) and `:153` (`قدراته: تكلفة=${context.capabilities?.canReadCost …}`).
- **Impact:** no data leak — all live figures are fetched with the **caller's** JWT through RLS-gated views (`index.ts:270-295`, `buildLiveSnapshot`), and `management_metrics` nulls financial columns server-side. But a tampered client can make the assistant *assert* permissions the user does not have, and can inject arbitrary prompt text. Trust boundary is presentation-level only.
- **MVP impact:** None (assistant is recommended off for the first demo). **Confidence:** Confirmed by inspection; exploit impact Needs verification.

### 4.2 Dead Code

**DC1 — Two branding components are imported by nothing.**
- **Finding/Evidence:** `src/components/branding/CompanyHeader.tsx` (34 lines) and `src/components/branding/CompanyNavbar.tsx` (50 lines). An import-graph analysis over all 352 source files (resolving `@/` and relative specifiers, including `index.ts` barrels) found zero importers — not even tests. The live shell uses `AppShell.tsx` + `DesktopSidebar.tsx` + `MobileNav.tsx` instead.
- **Impact:** 84 lines of misleading "branding system" that suggests a second header/navbar implementation exists.
- **MVP impact:** None. **Confidence:** Confirmed by inspection (high — both files are unreferenced from every entry point).

**DC2 — The entire face-recognition stack is unreachable in production.**
- **Finding:** ~1,900 lines of client code (`face.api.ts` 623, `FaceAttendanceDialog.tsx`, `FaceEnrollmentPanel.tsx`, `localTemplates.ts`, `provider.ts`), one 460-line migration (`0083`) with 4 tables/RPCs, and pgTAP coverage — all gated behind a provider factory that application code never sets.
- **Evidence:** `provider.ts:57-60` (`const registry = { factory: null }`), `:63-67` (`__registerFaceProviderFactory` — referenced only in `provider.ts` and `provider.test.ts`; verified by grep across `src/`), `:74-77` (`resolveFaceProvider()` returns `null` when no factory). `provider.ts:11-16` states this is a deliberate "HONESTY POLICY … production bundles ship NO engine".
- **Impact:** not a bug — a documented, honestly-degrading stub. But it *is* dead weight presented to readers as a feature: `docs/FEATURE_READINESS_REPORT.md` lists "بصمة الحضور بالكاميرا" as feature #12 with 92% readiness. The manual attendance path is first-class and fully wired, so no workflow is lost.
- **MVP impact:** Non-blocking. **Confidence:** Confirmed by inspection.

**DC3 — Migrations 0100/0101 are permanent dead schema history.**
- **Finding:** a staff leaves/absence register was created (`0100`, 98 lines: table, RLS, policies, trigger, grants), constraint-fixed (`0101`), then dropped (`0102`) — all within three hours on 2026-09-11. No client code ever referenced `staff_leaves` (grep across `src/`: zero hits), and `database.types.ts` correctly contains no `staff_leaves`.
- **Evidence:** `0100_hr_directory_and_leaves.sql:43-98`, `0101_hr_leaves_decision_shape_fix.sql`, `0102_drop_staff_leaves.sql` (rationale: "hosts are not employees"). Part A of `0100` (HR directory columns on `staff_members`) **is** live and used (`StaffMemberDialog.tsx:65-115, 259-312`, `StaffProfilePage.tsx:153-240`).
- **Impact:** ~120 lines of permanently un-runnable migration history; harmless (`0102` drops cleanly — no views depended on the table, so no CASCADE was needed).
- **MVP impact:** None. **Confidence:** Confirmed by inspection.

**DC4 — No other unreferenced source files.** The same import-graph sweep found **zero** additional unimported non-test files; no leftovers of the removed public-demo mode (`VITE_PUBLIC_DEMO_MODE`), the removed OwnerVoice feature, or the removed screen-reader feature exist anywhere in `src/`, `public/`, `index.html` or `vercel.json`.
- **Confidence:** Confirmed by inspection.

### 4.3 Duplication

**DU1 — Two different "كشف حساب عميل" documents, both live, deriving balances differently.**
- **Finding:** `src/features/documents/CustomerStatement.tsx` (114 lines) computes a running balance **client-side** by summing rows (`running += amount` / `-= amount`) and takes the final outstanding from `customer_360`; `src/features/documents/AccountingCustomerStatement.tsx` (144 lines) takes `running_outstanding` **from the journal** off the last row and renders gross/net/VAT allocation detail.
- **Evidence:** `CustomerStatement.tsx:12-19, 36-42`; `AccountingCustomerStatement.tsx:5-12, 29-31`. Both reachable: the first from `CustomerDetail.tsx` + `documents.api.ts`, the second from `accounting/CustomerStatementSection.tsx`.
- **Impact:** the same official document title can be printed from two screens with two different balance derivations. If the journal and the row-sum ever disagree (allocations, VAT, voided documents), the office hands a customer two different statements. Which is canonical is documented in comments ("§20 Stage-3 … distinct from the 0080 commercial statement") but not enforced in the product.
- **MVP impact:** Non-blocking (both are internally consistent; the accounting one is the newer, journal-backed one and is the better canonical candidate). **Confidence:** Strongly indicated; actual numeric divergence **Needs verification** with data.

**DU2 — Three RPC invocation wrappers.**
- **Finding:** canonical `callRpc` (throws on error — `src/lib/rpc.ts:19-25`), inline `db.rpc(...)` + `if (error) throw error` (most `*.api.ts`), and `runRpc` (discards errors — `restaurants.db.ts:53-56`).
- **Impact:** the third variant is the direct cause of finding D1. The first two are equivalent in behaviour; only the third is dangerous.
- **MVP impact:** Important (fixed by Track A Step 5). **Confidence:** Confirmed by inspection.

**DU3 — Duplicated presentation helpers by design.**
- **Finding:** four separate `presentation.ts` files (`accounting` 72, `payments` 21, `procurement` 96, `restaurants` 86 lines) each with their own status labels/date formatters, while `src/lib/arabic.ts`, `src/lib/dates.ts` and `src/lib/money.ts` hold the shared ones.
- **Impact:** low — they are per-domain label maps, not competing business rules; money formatting is *not* duplicated (everything routes through `formatOMR`). Cosmetic drift risk only.
- **MVP impact:** None. **Confidence:** Confirmed by inspection.

**DU4 — Duplicate status/audit documentation.**
- **Finding:** nine overlapping status documents at the repo root (`README`, `PROJECT_STATUS`, `PROJECT_DEFECTS` 45 KB, `IMPLEMENTATION_REPORT`, `PROJECT_OVERVIEW`, `AGENT_HANDOFF`, `FEATURE_READINESS_REPORT`, `OPERATIONS_GUIDE_SIMPLE` ×2 formats, plus 8 archived self-audits in `docs/archive/audits/`) that contradict each other on basic facts — see O1/O2 below.
- **Impact:** a reader cannot tell which document is true; the two most recent ones both claim "all gates green" while CI is red.
- **MVP impact:** Non-blocking, but it is the reason this audit had to re-derive everything from CI metadata. **Confidence:** Confirmed by inspection.

### 4.4 Data Integrity & Business Logic

**D1 — CONFIRMED silent failure / fake success on the restaurants screen (money-adjacent).**
- **Finding:** all six write commands and all three reads discard the Supabase `error` object. A server rejection (`NOT_AUTHORIZED`, duplicate contract number, inactive contract, date/validation error, idempotency conflict) resolves the promise normally.
- **Evidence:** `restaurants.db.ts:48-56`:
  ```ts
  async function selectRows<T>(...): Promise<T[]> { const { data } = await build(query(table)); return (data ?? []) as T[]; }
  async function runRpc<T>(fn, params): Promise<T> { const { data } = await client.rpc(fn, params); return data as T; }
  ```
  Callers assume success: `ContractedRestaurantsPage.tsx:162-176` (`runBusy` closes every dialog and bumps `reload` on resolve; the `catch` is the *only* error path), `:407, 421, 451, 460, 470, 829`. The Arabic error mapper `presentation.ts:75-86` can therefore never fire for a database error.
- **Impact:** a meal booking for an event can silently not exist on the day of the event; a contract can silently not be created while the operator believes it was. Reads failing (e.g. a revoked grant, a dropped view) render as "no restaurants / no bookings" rather than an error.
- **MVP impact:** **Important** (Track A Step 5). **Confidence:** Confirmed by inspection. Runtime reproduction Needs verification.

**D2 — CONFIRMED false-negative diagnostic that misdirects the operator.**
- **Finding:** the Settings health panel's upload test uploads to a path whose second segment is not a valid evidence type, so the RLS `WITH CHECK` cast fails and the upload always errors; the panel then advises creating the bucket manually.
- **Evidence:** `SystemHealthPanel.tsx:85-86` (`new Blob(["test"], {type:"text/plain"})`, `${orgId}/TEST/health_${Date.now()}.txt`) vs `0074:237-246` (`attachments_insert_org_role` … `((storage.foldername(name))[2])::public.attachment_evidence_type`) and the enum's nine members at `0074:27-37` (no `TEST`). Secondary: `text/plain` is not an allowed evidence MIME (`attachments.api.ts:18-23`, `0074:link_evidence`). Also `SystemHealthPanel.tsx:36` reports the organization check as unconditionally `"ok"` — it cannot fail, so it is not a check.
- **Impact:** during day-1 setup or a live demo the product announces that storage is broken when it is healthy, and sends a non-technical founder into the Supabase dashboard. If the path were valid, the test would also leave an ORPHAN blob that `reclaim_evidence` later reports.
- **MVP impact:** **Important** (Track A Step 4 — it is step 4 of the project's own demo checklist). **Confidence:** Confirmed by inspection; the exact error string Needs verification.

**D3 — Money representation and arithmetic are sound.**
- **Finding:** all in-memory money is integer milli-OMR; multiplication uses `BigInt`; rounding is half-away-from-zero to 3 decimals in one place; the persisted domain `numeric(12,3)` is enforced client-side too; DB transport is exact decimal text with a guarded `number` path.
- **Evidence:** `src/lib/money.ts` (`parseOMR`, `toOMRString`, `fromDbAmount:135-145`, `toDbNumeric:158-166` with a round-trip self-check, `multiplyOMR:186-208` with `BigInt`), covered by `money.test.ts` (167 lines).
- **Impact:** no float-drift class of bug in the financial core.
- **MVP impact:** None. **Confidence:** Confirmed by inspection.

**D4 — Two money surfaces disagree about what `null` means.**
- **Finding:** commit `e3d97195` introduced `moneyOrNull()` on the management dashboard precisely to stop fabricating "0.000 ر.ع." from a NULL that means "not readable" — but `ReportsPage` still passes report columns straight through `fromDbAmount`, which maps `null → 0`.
- **Evidence:** `intelligence.api.ts:14-25` (the new `moneyOrNull` + rationale comment) vs `money.ts:140` (`if (value == null) return 0;`) and `ReportsPage.tsx:96-100, 132-133, 168-170` (`formatOMR(fromDbAmount(e.revenue))` etc.).
- **Impact:** limited in practice — `report_events`/`report_customers`/`report_packages` gate *whole rows* on `can_read_cost` (`0072:287`) and the underlying `event_finance_summaries` columns are `coalesce(…,0)`-built (`0037:65-75`), so a NULL is unlikely. But the convention is now inconsistent, and any future NULL-able money column on Reports will render as a fabricated zero.
- **MVP impact:** Non-blocking. **Confidence:** pattern divergence Confirmed; actual wrong figure Needs verification.

**D5 — Payroll/attendance totals are re-summed in the browser in three places.**
- **Finding:** host due amounts, earned wages and allocation totals are aggregated client-side from row arrays rather than read from the server aggregates that also exist (`get_host_payroll_summary`, `staff_ledger_history`, `_view_host_payout_summaries`).
- **Evidence:** `StaffPage.tsx:153-159`, `AttendancePanel.tsx:122`, `HostFinanceSection.tsx:66`; also `procurement/supabaseDataSource.ts:750-764`.
- **Impact:** arithmetic is exact (integer milli-OMR), so no rounding risk; the risk is *two sources of truth* — if the server aggregate and the client sum use different eligibility rules (voided punches, settled advances), the same screen family can show different totals for the same period.
- **MVP impact:** Non-blocking. **Confidence:** Strongly indicated; divergence Needs verification with data.

**D6 — Positive: no double-counting or destructive-update patterns found in the financial core.**
- **Finding:** payments/invoices/expenses/payouts are append-only ledger-style with void-with-reason rather than delete; overpayment, cancellation and closeout rules are server-enforced; idempotency keys are consolidated server-side; closing writes a profit-at-close snapshot.
- **Evidence:** `0035`–`0037`, `0041`–`0043`, `0045`–`0047`, `0058`, `0067`–`0069`, `0084`–`0097`; `0049_command_idempotency_consolidation`; client `VoidReasonPanel.tsx`, `finance.api.ts:218-244`, `EventFinancePanel.tsx:284`; pgTAP `financial_closeout`, `financial_closures`, `operational_posting_hardening`, `customer_payment_posting`, `payroll_posting`, `supplier_ap_posting`, `vat_gross_deposit_reconciliation` (all reported "ok" in the HEAD CI log tail).
- **MVP impact:** None. **Confidence:** Confirmed by inspection that the guards exist and are exercised by assertions; their runtime behaviour on HEAD is **Needs verification** only because steps 10–18 (the concurrency proofs) were skipped.

**D7 — Timezone correctness (defect D17) is genuinely fixed, with one narrow residual.**
- **Finding:** both event date entry points pin Muscat wall-clock before storing.
- **Evidence:** `EventsPage.tsx:88-89` and `EditEventDialog.tsx:49-50` both call `muscatWallClockToIso(...)`, which produces a `+04:00`-anchored instant (`dates.ts:63-75`); display everywhere uses `timeZone: "Asia/Muscat"`.
- **Residual:** the fallback `?? String(form.get("start"))` passes a raw wall-clock string to `new Date(...)` (device-timezone interpretation) if the helper returns `null`. The helper accepts only `YYYY-MM-DDTHH:mm`, and the inputs have no `step` attribute, so this needs a browser/autofill that emits seconds to trigger.
- **MVP impact:** None. **Confidence:** Confirmed by inspection (fix); residual path Strongly indicated, low likelihood.

### 4.5 Security

**S1 — No exposed secrets; no debug/bypass auth path.**
- **Evidence:** a regex sweep for JWT-shaped strings, `sk-`/`AIza`-style keys, `service_role`, connection strings and inline passwords across `src/`, `supabase/`, `scripts/`, `.github/`, `vercel.json`, `index.html` found only local-development Postgres URLs in `scripts/native-db/*.mjs` (`postgres://postgres@127.0.0.1:5433`) and one hardcoded local password in `scripts/native-db/verify_local.mjs:31` — dev-harness only, never shipped. The client reads exactly three env vars (`supabase.ts:4-5`, `AssistantLauncher.tsx:69`). `GEMINI_API_KEY` is read only inside the edge function (`index.ts:54`). The public-demo login path is gone (S3).
- **MVP impact:** None. **Confidence:** Confirmed by inspection.

**S2 — Tenant isolation and authorization are enforced in the database, not the UI.**
- **Evidence:** `enable row level security` on 65 relations; **zero** `disable row level security` statements; **zero** RLS policies addressed `to anon` or `to public` (verified by scanning every `create policy`); 91 policies total; composite unique constraints `(organization_id, id)` used for cross-tenant FK protection; cost data separated at the data boundary (`can_read_cost`, `_view_*` hardening in `0048:91-113`, which converts views to `security_invoker` over `SECURITY DEFINER` functions and revokes direct grants); capability checks server-side via `has_permission` (`0079`); client `Can.tsx`/`navConfig.visibleNavGroups` are explicitly presentation-only (`AuthContext.tsx:243-249`, `navConfig.ts:150-155`).
- **MVP impact:** None. **Confidence:** Confirmed by inspection; runtime isolation **Needs verification** (pgTAP `rls_isolation.test.sql` reported "ok" at HEAD, which is good evidence).

**S3 — The dangerous public-demo grant experiment was removed cleanly and forward-only.**
- **Finding:** `0054` gave `anon` OWNER-equivalent access scoped only by an organization **name string** (`'شركة الريان للضيافة - Demo'`, `0054:34, 52`), patched `auth.uid()` out of every public function, and granted execute on ~100 functions; `0055` moved it behind an inherited `public_demo_admin` role; `0059` reversed all of it.
- **Evidence:** `0059` restores `is_org_member`/`has_org_role` to membership-only definitions, revokes them from `public, anon`, runs a symmetric `pg_get_functiondef`-based restore of `auth.uid()` across every public function, then `drop owned by public_demo_admin; drop role …; drop schema if exists app_private cascade;`. `0055`'s `$reads$`/`$crud$`/`$rpc$` loops had already revoked the direct `anon` grants and re-granted them to `public_demo_admin`, so `DROP OWNED BY` removes them completely. `public_demo_removal.test.sql` exists and reported "ok" at HEAD.
- **Impact:** in the *schema as committed*, no residual anonymous privilege. **Residual risk:** this is only true for a database that has actually applied `0059`+. `PROJECT_STATUS.md §4 (D2)` and `PROJECT_DEFECTS.md D2` both record that applying it to the live project is **NEEDS_OWNER** and that production parity has never been checked from any session. Since `organizations.name` has no uniqueness constraint, a live database still carrying `0054`/`0055` would let an unauthenticated caller act as OWNER of any organization that happens to carry that exact demo name.
- **MVP impact:** None for a freshly provisioned demo project (all 104 migrations apply). **Potentially Critical for the existing production project** — see S4. **Confidence:** schema removal Confirmed by inspection; production state **Needs verification**.

**S4 — Production database parity is unknown, and the docs contradict themselves about it.**
- **Finding:** `PROJECT_STATUS.md §0` asserts a live deployment (`jiwdah.vercel.app` at `225f10b`, Supabase project `livpmxwwxsfnaceczyth`, migration 0099 applied, `GEMINI_API_KEY` set, real demo data present). `§3` of the same file states the live production environment "cannot be verified from this workspace" and that "whether production has all 99 migrations applied — never checked from any working session". `IMPLEMENTATION_REPORT.md §3` lists "تطبيق migration 0103 على إنتاج Supabase" as still outstanding.
- **Impact:** if that project exists and is reachable, it is at migration 0099 or 0100–0102 — i.e. **without `0103`**, so a newly created organization there gets **no `organization_settings` row** and document numbering prefixes may be NULL on the first quotation/invoice (exactly the problem `0103` was written to fix). It also may or may not carry `0059`.
- **MVP impact:** **Blocker only if you intend to demo on that existing project.** It is *not* a blocker for Track A, which provisions a fresh project with all 104 migrations. **Confidence:** documentation contradiction Confirmed; the live project's actual state **Needs verification** (no network egress or credentials from this workspace).

**S5 — Permissive CORS on the edge function.** `supabase/functions/ai-assistant/index.ts:27-31` sets `Access-Control-Allow-Origin: *` with `authorization` in allowed headers. Mitigated by `verify_jwt = true` (`config.toml:69-71`) and by the fact that a user's Supabase token is not readable from another origin. **MVP impact:** None. **Confidence:** Confirmed by inspection; low risk.

**S6 — Attachment/evidence design is strong.** Private bucket, no public read grant, no client DELETE policy (removal only via the audited `reclaim_evidence` command), signed URLs only, path-shape and MIME validation server-side in `link_evidence`, upload-then-verify so a lost upload can never appear as verified evidence, and evidence-type-specific role gates (`0074:103-124`). **Confidence:** Confirmed by inspection.

**S7 — Branch protection could not be confirmed.** `GET /repos/.../branches/main/protection` returns `403 Resource not accessible by integration` for this sandbox token; `PROJECT_STATUS.md §5.4` states it is **not** enabled. Combined with the observed history (most commits pushed straight to `main`, 20 of the last 40 CI runs red, HEAD red), `main` is effectively unprotected. **Confidence:** Needs verification (owner action).

### 4.6 Test & Validation Gaps

**T1 — The three broken face RPC contracts have no test.**
- **Evidence:** `src/features/staff/face/` contains only `provider.test.ts` (108 lines) and `localTemplates.test.ts` (106). There is **no `face.api.test.ts`**, so nothing asserts the argument names sent to `enroll_staff_face`, `revoke_staff_face` or `record_face_match_attempt`. `command_center_and_face.test.sql` covers the *database* side and reported "ok" — which is why the mismatch survived: both sides are green in isolation and no test crosses the boundary.
- **Impact:** a contract bug of exactly the kind that only integration testing catches.
- **Confidence:** Confirmed by inspection.

**T2 — The restaurants error path is structurally untestable as written.**
- **Evidence:** `ContractedRestaurantsPage.test.tsx:29-40` mocks the whole `./restaurants.db` module (`createContract: vi.fn()`, …). No test anywhere exercises `runRpc` with a non-null `error`, and `restaurants.db.ts` itself has no test file.
- **Impact:** the swallow-everything behaviour is invisible to the suite; the page test passes while the production path silently fails.
- **Confidence:** Confirmed by inspection.

**T3 — No test for the newest user-facing diagnostic.** `SystemHealthPanel.tsx` (152 lines, added in the red commit) has no test file; `SettingsPage.test.tsx` predates it. **Confidence:** Confirmed by inspection.

**T4 — Uneven page-level coverage.** `IntegrityCenter.tsx` has no test file although its siblings `SearchPage`, `ReportsPage` and `ManagementDashboard` each have 146–274-line ones. `AccountingPage` is covered (205 lines) but the accounting sections (`AgingSection`, `CustomerStatementSection`, `SupplierStatementSection`) are only covered indirectly. **Confidence:** Confirmed by inspection.

**T5 — Nine database gates did not run on HEAD.** Steps 10–18 skipped: warehouse, consumable-catalog, customer-payment, quotation and staff-payroll **concurrency proofs**, the **backup→reset→restore→verify** proof, type generation and the **committed-types drift gate**. So on the exact commit you would demo: race-condition behaviour, restorability and `database.types.ts` fidelity are all **unverified**. (Static inspection is reassuring on types: `database.types.ts` contains the `0100` HR columns and no `staff_leaves`, i.e. it was regenerated after both.) **Confidence:** Confirmed by CI metadata.

**T6 — Coverage that does exist is substantial.** 113 vitest files / ~726 test cases (frontend job green at HEAD), 47 pgTAP files / 1,631 assertions, and 46 of 47 pgTAP files reported "ok" in the visible portion of the HEAD log. The gap is not "no tests" — it is **missing boundary/integration tests** (T1, T2) and **unexecuted gates** (T5).

### 4.7 Other Significant Technical Risks

**R1 — Documentation states the opposite of reality in several places (misleading, and it caused this red `main`).** See O1–O5 in §6. The concrete consequence: `IMPLEMENTATION_REPORT.md` declares "READY TO SELL" and lists a gate table that **omits the database gate**, so the last session shipped without running it.

**R2 — Single-point dependency on one hosting pair.** Vercel (`vercel.json` alias `jiwdah.vercel.app`) + one Supabase project. `vercel.json` CSP allows `connect-src 'self' https://*.supabase.co` only — correct and tight, but it means any second Supabase project (e.g. a staging one) requires a CSP change or the app will fail closed at runtime. **MVP impact:** None for the demo (one project). **Confidence:** Confirmed by inspection.

**R3 — No demo seed data by policy.** `supabase/seed.sql` is deliberately empty. Every demo requires ~20–30 minutes of manual data entry, which increases the chance of an on-stage mistake. A committed *demo-only* seed would conflict with `AGENTS.md` ("No fake production data"), so the safer Track-A-compatible option is a private, out-of-repo script or a saved project snapshot. **MVP impact:** Non-blocking. **Confidence:** Confirmed by inspection.

**R4 — List truncation at 1000 rows remains on procurement.** Pagination was implemented for events/customers/catalog (`src/lib/pagination.ts`, `PaginationBar`, `listCap.ts`); procurement intentionally keeps an explicit cap warning (`PROJECT_DEFECTS.md D3/D21`, `supabase/config.toml:14` `max_rows = 1000`). At demo volume this is invisible. **MVP impact:** None. **Confidence:** Confirmed by inspection.

**R5 — Workspace complexity concentrated in a few very large files.** `staff.api.ts` (1,153 lines), `ContractedRestaurantsPage.tsx` (839), `supabaseDataSource.ts` (779), `face.api.ts` (623), `AssistantLauncher.tsx` (620), `HomePage.tsx` (527), `QuotationReview.tsx` (499). Each is coherent, but they are the highest-risk files to edit under time pressure. **MVP impact:** None. **Confidence:** Confirmed by inspection.

---

## 5. Full Long-Term Roadmap (Track B — production & product health)

Nothing below is required for the MVP. Sequenced by risk-reduction per unit of effort.

### Phase 1 — Critical Stability (1–2 weeks, priority P0)
| Item | Detail | Effort |
| --- | --- | --- |
| Make the DB gate un-skippable | Add `if: always()`-style reporting or a required-status rule so a red pgTAP step can never again hide steps 10–18; make the frontend and database jobs both required for merge | 2–4 h |
| Enable branch protection on `main` | Require the full CI matrix + PR review; stop direct bot pushes (owner action, `PROJECT_STATUS.md §5.4`) | 30 min + policy |
| Production parity runbook executed once | Apply all 104 migrations to the live project (or retire it), verify `0059` and `0103` are present, verify the `attachments` bucket, verify `enable_signup`, backups, plan/quotas (`OPERATIONS.md §10`) | 0.5–1 day |
| Single source of truth for status | Collapse `PROJECT_STATUS` / `IMPLEMENTATION_REPORT` / `FEATURE_READINESS_REPORT` / `PROJECT_OVERVIEW` into one file with a "how to re-verify" header; delete or clearly date-stamp the rest | 0.5 day |
| Decide the face-recognition feature | Either implement a real provider behind `__registerFaceProviderFactory` **and fix the three RPC contracts** (T1/DC2), or delete ~1,900 client lines + retire `0083` surfaces and stop advertising it | 0.5 day (delete) / 2–3 weeks (implement) |

### Phase 2 — Architecture & Maintainability (2–4 weeks, P1)
- **Collapse the restaurants data layer** into the canonical pattern: `callRpc` + typed client + TanStack Query with cross-screen invalidation (extends Track A Step 5). *2–3 days.*
- **Flatten procurement**: keep `contracts.ts` only if a second data source is genuinely planned; otherwise fold `supabaseDataSource.ts` into `procurement.api.ts` and drop `useProcurementCacheSync`. *3–5 days, do it behind the existing 513+279-line test suite.*
- **One canonical customer statement**: make the journal-backed `AccountingCustomerStatement` the only implementation, or rename the two so their difference is obvious to the operator; add a reconciliation assertion between the journal and the row-sum. *1–2 days.*
- **Close the audit-trail gap (A4)**: either convert customers/catalog/staff/capacity/event-edit writes into `SECURITY DEFINER` commands that call `record_audit`, or add table-level audit triggers. Then correct the false claim in `src/lib/rpc.ts:7-9`. *3–5 days.*
- **Unify the money `null` convention (D4)**: export one `moneyOrNull` from `src/lib/money.ts` and apply it on every money-rendering surface; lint against bare `fromDbAmount(row.x)` in components. *1 day.*
- **Move client-side payroll aggregation to the server (D5)**. *1–2 days.*
- Delete `CompanyHeader.tsx` / `CompanyNavbar.tsx` (DC1). *15 min.*

### Phase 3 — Security & Reliability (2–3 weeks, P1)
- Re-enable email confirmation and define the signup policy (`PROJECT_STATUS.md §5.1`).
- Derive the assistant's capability statement server-side instead of from the request body (A5); tighten the edge-function CORS to the deployed origin (S5).
- Threat-model pass on the `_view_*` `SECURITY DEFINER` surface (`0048`) and on `has_permission` delegation (`0079`) — confirm no definer function can be coerced into cross-tenant reads; formalise as pgTAP.
- Managed backups + a *rehearsed* restore on the production project (the repo already has `db:backup-restore-proof`; run it against production-shaped data).
- Add rate limiting / abuse consideration for public auth endpoints; document incident response.

### Phase 4 — Testing & Observability (3–4 weeks, P2)
- **Boundary contract tests**: a generated or hand-written suite that asserts every client RPC call's argument names against the live schema (this audit did it statically in ~80 lines of Python; productionise it as a CI gate). This single gate would have caught D1-class and T1 bugs.
- Tests for `SystemHealthPanel`, `IntegrityCenter`, `restaurants.db` error paths, accounting sections (T2–T4).
- Client error telemetry (currently errors are shown in Arabic and otherwise vanish) + server-side slow-query/error logging; a minimal health endpoint check in CI against the deployed app.
- Human UAT with the 50+ owner persona (`docs/operations/uat-*.md` — never executed per `PROJECT_STATUS.md §3`).

### Phase 5 — Performance & Scalability (2–3 weeks, P2)
- Re-measure the dashboard readiness fan-out (`D19`, now batched by `0060`/`0082`) and the N+1 patterns in `useWorkspaceData` under realistic volume.
- Decide procurement pagination (`R4`); index review on the ledger/audit tables; `max_rows` policy review.
- Bundle/chunk review (build already enforces a chunk cap in the smoke script).

### Phase 6 — Product Expansion (ongoing, P3)
- Real AI provider + evaluation harness for "لينا" (including verifying the model IDs at `index.ts:22-23`).
- Customer-facing quotation acceptance link (today acceptance is an internal action — there is no public route, by design since `0059`).
- Time-window equipment reservations (`AGENTS.md` flags this as a future requirement the current model must not preclude).
- Multi-branch/multi-warehouse, reporting exports, notifications.

---

## 6. Suspicious / Abnormal Findings

Reported only. **Nothing was acted on, reverted, deleted or remediated.**

**O1 — Documentation asserts the opposite of the verified state.**
- **Evidence:** `README.md` "الحالة الحالية": "✅ `npm test` — 669 اختباراً في 97 ملفاً كلها ناجحة", "99 ترحيلاً", "كل ملفات pgTAP تُعاد وتُنفَّذ"; `docs/FEATURE_READINESS_REPORT.md:5`: "كل بوابات التحقق حالياً خضراء: 742 اختباراً (113 ملفات)"; `IMPLEMENTATION_REPORT.md`: "الحالة بعد التنفيذ: READY TO SELL", gate table with no database row. Actual: **104** migration files, **113** test files (so the README's 97/669 is stale), and the database gate is **red** at HEAD (CI run `34549226774`).
- **Why unusual:** three different, mutually inconsistent counts of the same facts in current documents, and two "all green" claims contradicted by CI on the very commit that made them.
- **Confidence:** Confirmed. **Follow-up:** make status claims machine-generated from CI, or delete them.

**O2 — `PROJECT_STATUS.md` contradicts itself inside one file, and complains about a file that exists.**
- **Evidence:** `§0` (dated 2026-09-09) reports a completed live production deploy with real demo data; `§3` of the same file lists the live deployment as unverifiable and `§7` concludes "not yet launched operationally". `§5.5` says "the repo is public but has no LICENSE file" — `LICENSE` (867 bytes) is present at the repo root and was added by commit `6d851184`.
- **Why unusual:** the canonical status file simultaneously claims and disclaims launch, and its own defect list is out of date about the repository it describes.
- **Confidence:** Confirmed. **Follow-up:** decide whether a live project exists; if yes, run the parity runbook and record the result; if no, delete `§0`.

**O3 — Eight different commit identities pushed directly to `main`, most without a PR.**
- **Evidence:** last ~45 commits show authors `Arena Audit Bot`, `Arena Agent`, `Arena.ai Agent`, `arena-ai-coding-agent[bot]`, `Jiwdah Agent`, `Dev`, `M7mdlab`, `mohamedmasoud3030-tech`, `external-ux-review`. Direct pushes to `main` include `5ac6cc07`, `e3d97195`, `012801c4`, `80be7a77`, `34b737c2`, `851fefb6`, `52286366`, `de864e8d`, `2e781151`, `0b345937`, `0c372c43`, `947b1b5f`, `83b777ed`, `5c889b01`, `3b1a6fa1`, `f76e8758`, `853b36b2`, `d11ecf2b`, `5a78e5fc`, `d5810de4`, `225f10bb`, `13cca45b`, `69a33322`, `8f147bdb`, `0af8e0b9`, `902ad42a`.
- **Why unusual:** a generic `Dev` identity and several differently-named agent identities committing to a protected-by-nothing `main` makes attribution and accountability unclear; it also explains how a red gate reached `main`.
- **Confidence:** Confirmed (metadata). Not evidence of malice — consistent with multiple AI-assisted sessions. **Follow-up:** standardise one bot identity + PR-only merges (Phase 1).

**O4 — 20 of the last 40 CI runs failed; 17 failures in a single day.**
- **Evidence:** `gh run list` conclusions: 2026-09-09 → 17 failed pushes + 9 successful pushes + 4 successful PRs; 2026-09-07 → 1 failure; 2026-09-11 → 1 failure (HEAD). Successes cluster on 2026-09-05/06/09/10.
- **Why unusual:** a sustained red `main` across a working day indicates commits landing without running the gates, i.e. the verification discipline the documentation claims is not enforced mechanically.
- **Confidence:** Confirmed. **Follow-up:** branch protection (Phase 1).

**O5 — A feature was built, documented, extended and reverted in six commits over three hours.**
- **Evidence:** `0b345937 feat(staff): HR upgrade — full member files + leave register` → `2e781151 chore(staff)` → `de864e8d docs(db): document HR/staff leaves contract + pgTAP register proofs` → `52286366 fix(staff): re-ground the surface` → `851fefb6 docs(db)+feat(leaves)` → `34b737c2 revert(staff): remove the leaves/absence register`. All six ran red CI. Migrations `0100` (12:00), `0101` (13:00), `0102` (15:00) on 2026-09-11.
- **Why unusual:** documentation and pgTAP proofs were written for a model that was then declared non-existent ("hosts are not employees"), and the immutable-migration policy means the dead schema stays in history forever.
- **Confidence:** Confirmed. **Follow-up:** none needed beyond noting the churn cost; the domain decision itself is documented and reasonable.

**O6 — Duplicate implementation of the same UX change by two identities.**
- **Evidence:** `decec101` (author `external-ux-review`) "fix(ux): legibility, motion-a11y, skeleton loading & RTL hygiene on owner surfaces" and `7c86e855` (author `M7mdlab`) "fix(ux): owner-surface legibility, motion-a11y, skeleton loading & RTL hygiene (#54)" — same day, same subject, one via PR #54.
- **Why unusual:** suggests parallel agents doing the same work, or a re-attribution of the same change.
- **Confidence:** Strongly indicated (commit subjects; full patch comparison not performed). **Follow-up:** confirm no double-applied changes in the UX layer.

**O7 — An open PR that adds a binary archive to the repository root.**
- **Evidence:** PR **#53** "Add files via upload" by `mohamedmasoud3030-tech`, opened 2026-09-09, still OPEN, single commit `e4673173`, single file **`app-uiux-audit.zip`** (+0/−0, binary), empty description, source branch `mohamedmasoud3030-tech-patch-1`.
- **Why unusual:** a ZIP uploaded through the GitHub web UI, unrelated to the application's purpose, sitting unmerged at the repo root; binary archives are opaque to review and to the 128 MB/10k-file artifact budget.
- **Confidence:** Confirmed (metadata). Contents unknown — **not downloaded or opened**. **Follow-up (owner):** inspect out-of-band; do not merge; close or move the artifact to external storage.

**O8 — A commit whose only purpose was to trigger a deployment.**
- **Evidence:** `902ad42a chore(deploy): trigger production redeploy with configured Supabase environment`.
- **Why unusual:** empty/no-op deploy triggers usually mean credentials or environment configuration were being manipulated outside the repository — worth confirming which project the deploy targeted.
- **Confidence:** Confirmed (metadata); intent Needs verification. **Follow-up:** reconcile with S4/O2.

**O9 — Local history is truncated.** The workspace clone is shallow (`git log --all` returns exactly 1 commit; `.git/shallow` present), so all history findings above come from the GitHub API rather than the local repository. **Confidence:** Confirmed. **Follow-up:** none — noted so the reader knows the evidence path.

---

## FINAL CONCLUSION

**1. Is the application currently a usable MVP?**
**No — but only because it is not connected to a database, not because it is unfinished.** In its present working state the app renders a login screen with disabled buttons ("النظام غير مهيأ بعد"): there is no `.env`, no Supabase project reference, and no fallback auth path. Behind that gate sits a genuinely complete, internally consistent product whose entire commercial spine — quote → event → operations → payment → close → profit → accounting/reports/documents — is wired to real, granted, argument-compatible server commands. I found no mock screens, no disconnected UI, and only three contract mismatches in the whole codebase (all inside a feature that is deliberately inert).

**2. What are the exact blockers?**
Four, and only four:
1. **No provisioned/connected database** — no Supabase project with the 104 migrations applied and no `.env` (`src/lib/supabase.ts:12-19`, `LoginPage.tsx:124,206`). *This is the real blocker.*
2. **The repository's own database gate is red at HEAD** — `supabase/tests/evidence_hardening.test.sql` fails 9/34 subtests because `[storage] enabled = true` (`config.toml:47`) installed `storage.protect_delete()` and the fixture at lines 195-199 performs a direct `delete from storage.objects`; consequently CI steps 10–18 (five concurrency proofs, backup/restore, type-drift) never ran on the commit you would demo. Migration replay itself is green.
3. **The Settings storage self-test always fails** (`SystemHealthPanel.tsx:85-86` vs `0074:27-37, 237-246`) — step 4 of the project's own day-1 demo checklist will report a healthy system as broken and misdirect the operator.
4. **The restaurants feature reports false success** (`restaurants.db.ts:48-56`) — any server rejection is silently swallowed while dialogs close and lists "reload".

Plus one conditional blocker: **if you intend to demo on the pre-existing production project** referenced in `PROJECT_STATUS.md §0`, its migration level is unknown and it may lack `0103` (→ NULL document-numbering prefixes on the first quotation) and, in the worst case, still carry the pre-`0059` demo grants. Provisioning a fresh project sidesteps this entirely.

**3. What is the shortest realistic path to a demoable MVP?**
Track A, §3, in order: **(1)** provision one Supabase project and push all 104 migrations, write `.env`, confirm the `attachments` bucket → **(2)** disable email confirmation on that demo project → **(3)** fix the pgTAP fixture (or revert the storage flag) so the DB gate and the nine skipped gates run → **(4)** fix the health-panel upload path → **(5)** make `restaurants.db.ts` throw on error and drop the untyped client cast → **(6)** set `VITE_ENABLE_ASSISTANT=false` → **(7)** rehearse `docs/DAY1_TEST_CHECKLIST.md` steps 1–16 and record it.
**~1.5–2.5 working days total; ~4–6 hours of actual code/CI work.** Nothing needs to be designed or built.

**4. What should explicitly NOT be worked on before the MVP?**
The procurement abstraction collapse; the face-recognition decision; the duplicate customer-statement consolidation; the audit-trail gap on direct table writes; the money `null` convention; client-side payroll aggregation; dead branding components; documentation reconciliation; dark mode, PWA, accessibility and typography polish; observability; performance; branch protection; production infrastructure. Every one of these is real, and **not one of them prevents a demonstration.**

**5. What belongs only to the post-MVP production roadmap?**
All of Track B (§5): enforced green gates + branch protection + production parity (Phase 1); architecture consolidation and audit-trail closure (Phase 2); auth/assistant hardening, backups and rehearsed restore (Phase 3); boundary contract tests, telemetry and human UAT (Phase 4); performance and scale (Phase 5); assistant AI, customer-facing acceptance, time-window reservations, multi-branch (Phase 6).

**Verdict in one line:** this is a substantially complete product sitting behind an unprovisioned database and one red test file — the distance to a demonstrable MVP is measured in hours of setup and two small client fixes, not in features.
