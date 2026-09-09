
## 0. أحدث ترقية ونشر حي (2026-09-09)

**الفرع:** `feat/assistant-lena` → دُمج في `main@225f10b` (بدون تعارض) ودُفع.

**ما دخل هذا الإصدار**
1. حذف ميزة «قراءة الشاشة» نهائياً (بلا بقايا)؛ نقل مساعداتها إلى `src/lib/arabic.ts` و`src/lib/dates.ts`.
2. «لينا» — مساعد صوتي أنثوي: دالة `supabase/functions/ai-assistant` بثلاثة أوضاع عبر Gemini
   (محادثة مقيدة بالسياق، تفريغ صوتي STT، نطق أنثوي TTS يتحول إلى WAV)، ظاهرة من كل الشاشات،
   مع ميكروفون هجين (متصفح ثم سحابة) ومفتاح Gemini في سرّ الدالة فقط.
3. الوضع الليلي/النهاري لكل الشاشات مع حفظ التفضيل ومتابعة وضع النظام.
4. «المطاعم المتعاقدة»: هجرة `0099` (عقود المطاعم + حجوزات وجبات الفعاليات بحالة
   PENDING/CONFIRMED/SERVED/CANCELLED وقيم مالية دقيقة)، واجهة بارزة في القائمة، وصلاحيات خادم صارمة.

**النشر الحي**
- Vercel production `jiwdah.vercel.app` = `225f10b` (READY) — مؤكد أنه يقدّم الكود الجديد.
- Supabase project `livpmxwwxsfnaceczyth`: هجرة 0099 مطبّقة (سجل المخططات = 100)،
  دالة `ai-assistant` منشورة، سرّ `GEMINI_API_KEY` مضبوط، اختبار حي (chat+speak) ناجح.
- بيانات ديمو حقيقية في «مشاريع جودة الإنطلاقة»: 3 مطاعم متعاقدة (عقدان ساريان + واحد بلا عقد)،
  3 فعاليات (زفاف قادم / غداء عمل / تكريم منجز)، حجوزات: مؤكد 650.000 / قيد التأكيد 247.500 / منجز 650.000.

**البوابات:** tsc 0 · oxlint 0/0 · vitest 623/623 (100 ملفاً) · `vite build` ناجح.
# PROJECT_STATUS.md — Verified Status, Failures, Unknowns, Next Priorities

> **Canonical status file.** Older self-audit reports (AUDIT_REPORT,
> FULL_PROJECT_AUDIT, FUNCTIONAL_CORRECTNESS_AUDIT, FINAL_INDEPENDENT_REVIEW,
> FINAL_READINESS_REPORT, FIRST_IMPRESSION_REVIEW, PROACTIVE_PROJECT_FINDINGS,
> TECH_DEBT_AUDIT) are frozen snapshots, archived under
> [`docs/archive/audits/`](docs/archive/audits/README.md) on 2026-09-09 —
> they are historical and may contradict this file.

> Re-verified **2026-09-09** by re-running every gate in this workspace.
> Labels: **Verified** = executed here · **CI-verified** = GitHub Actions
> evidence · **Unverified** = could not be checked from this environment
> (reason given) · **Owner decision** = requires the owner.

---

## 1. Baseline gates (all re-run in this workspace on 2026-09-09)

| Check | Command | Result |
| --- | --- | --- |
| Working tree | `git status --short` | branch `arena/01a08382-starting` off `main@6ec7d17` |
| Typecheck | `npm run typecheck` | **pass, 0 errors** (main was red — fixed on this branch) |
| Lint | `npm run lint` | **0 warnings / 0 errors (339 files)** — oxlint now scoped to project sources |
| Tests | `npm test` | **97 files / 669 tests — all passing** |
| Build | `npm run build` | pass; fonts self-hosted (no external font CDN) |
| Production smoke | `npm run smoke:production` | pass (SPA routes, PWA/SW, CSP, Vercel contract, chunk cap) |
| Dependency audit | `npm audit --audit-level=high` | not re-run here; executed in CI |
| DB replay (Layer A) | `scripts/native-db/verify_local.mjs` | **99 migrations ✓ + all pgTAP files ✓** on native embedded Postgres; generated types: **no drift** |
| CI on `main` | GitHub Actions | **RED** — run `34102250468` (typecheck failure). Fix committed on this branch; CI on the PR is the authoritative re-check (Layer B, Supabase stack) |

## 2. What is verified working

- **Product core:** events lifecycle + workspace, quotation lifecycle
  (draft→issue→accept→convert, autosave), catalog/packages, customers,
  warehouse dispatch/return/reconciliation, consumable ledger, procurement
  lifecycle, payments + event economics, invoices, staff attendance/payroll,
  operational dashboard, WhatsApp share links, owner voice summaries, PWA
  offline shell.
- **Lists (D21, fixed this branch):** real 0-based pagination for events,
  customers, and catalog — shared `src/lib/pagination.ts` helpers +
  `PaginationBar` (Arabic-first, large touch targets) + deterministic
  `order by id` tiebreakers; page resets on organization switch.
- **Audit retention (D20, fixed this branch):** `purge_old_audit_events`
  (migration 0098) — OWNER-only, per-organization, 24-month default cutoff,
  self-audited; policy documented in `OPERATIONS.md §5.1`.
- **Security:** RLS on all business tables; cost-data separation at the data
  boundary; command idempotency; append-only ledgers; audit isolation;
  `create_organization` revoked from browser roles (migration 0056);
  public-demo grants removed from schema (migration 0059); CSP + security
  headers; no secrets in the bundle.
- **Reliability:** unsaved-draft guard for quotations; error boundary;
  logout control; Muscat-day correctness (events, quotes, attendance);
  exact OMR math.

## 3. Implemented but not verifiable from this workspace

| Item | Reason |
| --- | --- |
| Live production at `jiwdah.vercel.app` and the production Supabase project | no network egress or credentials from this environment |
| Whether production has all 99 migrations applied | never checked from any working session — parity runbook in `OPERATIONS.md §10` |
| Effect of CSP headers on the live deployment | headers verified in `vercel.json` + smoke, but not observed over the wire |
| `enable_signup`, managed backups, plan/quotas in production | dashboard-only settings |
| Real-device PWA install/offline and Arabic voice quality | tests use mocks; no devices available |
| Human UAT checklists (`docs/operations/uat-*.md`) | no evidence of execution; requires humans + real project |

## 4. Open defects & known debt (evidence in PROJECT_DEFECTS.md)

| ID | Severity | Item | State |
| --- | --- | --- | --- |
| D2 | Medium (security-sensitive) | Public demo-mode grants | **Schema FIXED** (migration 0059) · applying to production = NEEDS_OWNER |
| D3/D21 | Medium | List pagination | **FIXED** for events/customers/catalog · procurement keeps the explicit cap warning (product decision) |
| D20 | Low | Audit-log retention | **FIXED** (migration 0098 + documented 24-month policy) |
| D18 | Low | Unused local services enabled in `supabase/config.toml` | Deferred |
| D19 | Low | N+1 readiness fan-out on the dashboard | Deferred — fine at current scale |

## 5. Unknowns that need owner decisions (see also PRODUCT_SPEC §7)

1. Self-service signup policy (`enable_signup`) and who may create
   organizations.
2. Whether the public demo period has ended → authorize applying migration
   0059 (and later 0098) to the production database.
3. Production project provisioning: backups schedule, plan, domains, UAT
   execution.
4. **Branch protection** on `main` (require the CI matrix) — not enabled;
   the automation token has no admin access, so this is an owner action.
5. **LICENSE** — the repo is public but has no LICENSE file (README says
   "جميع الحقوق محفوظة"). Owner must choose: add an explicit proprietary
   LICENSE, pick an open-source license, or make the repo private.

## 6. Next priorities (safest first)

1. Owner review of this branch → merge PR (CI runs the full matrix incl.
   Supabase-stack DB replay, pgTAP, concurrency, type-drift gate).
2. Enable branch protection on `main` (see §5.4).
3. Run the production-parity checkbook (`OPERATIONS.md §10`) with real
   credentials.
4. Human UAT with the 50+ owner persona before any launch claim.
5. Decide procurement-list pagination pattern (only remaining D21 surface).

## 7. Release verdict

The codebase's local gates are green after this branch's fixes; it is **not
yet launched operationally** — production parity, branch protection,
licensing, and human UAT (§3, §5) remain owner/operator tasks, and a red
commit on `main` proves the published "all gates green" claim must not be
repeated without a fresh CI run.
