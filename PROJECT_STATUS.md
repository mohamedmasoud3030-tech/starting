# PROJECT_STATUS.md — Verified Status, Failures, Unknowns, Next Priorities

> **Historical snapshot:** the measurements and branch state below were captured on
> 2026-08-17. Do not use them as current repository truth. Recompute current
> branch/PR/test/migration state from GitHub, the codebase, CI, and the latest
> verified README before making implementation decisions.

> Re-verified 2026-08-17 by re-running every gate in this workspace. Labels:
> **Verified** = executed here · **CI-verified** = GitHub Actions evidence ·
> **Unverified** = could not be checked from this environment (reason given) ·
> **Owner decision** = requires the owner.

---

## 1. Baseline gates (all re-run in this workspace)

| Check | Command | Result |
| --- | --- | --- |
| Working tree | `git status --short` | clean; 8 commits on `arena/01a00fa3-starting` above `main@375b31d` |
| Typecheck | `npm run typecheck` | pass, 0 errors |
| Lint | `npm run lint` | 0 warnings / 0 errors (227 files) |
| Tests | `npm test` | **68 files / 531 tests — all passing** |
| Build | `npm run build` | pass; fonts self-hosted (15 woff2 in dist); no external font CDN |
| Production smoke | `npm run smoke:production` | pass (SPA routes, PWA/SW, CSP, Vercel contract, chunk cap) |
| Dependency audit | `npm audit --audit-level=high` | 0 vulnerabilities |
| Runtime routes | `curl` on dev server (port 3000) | all 14 routes HTTP 200; manifest/sw 200 |
| DB replay | `scripts/native-db/run.mjs` on clean PG | **61 migrations ✓ + 16 pgTAP files ✓ (590 planned assertions)** |
| Concurrency | 8 `*_concurrency.mjs` harnesses | all PASSED, exit 0 |
| CI on `main` | GitHub Actions | all recent runs green (frontend + database jobs incl. backup/restore proof and type-drift gate) |

## 2. What is verified working

- **Product core:** events lifecycle + workspace, quotation lifecycle
  (draft→issue→accept→convert), catalog/packages, customers, warehouse
  dispatch/return/reconciliation, consumable ledger, procurement lifecycle,
  payments + event economics, invoices, staff attendance/payroll, operational
  dashboard, WhatsApp share links, owner voice summaries, PWA offline shell.
- **Security:** RLS on all 36 business tables; cost-data separation at the
  data boundary; command idempotency; append-only ledgers; audit isolation;
  `create_organization` revoked from browser roles (migration 0056); CSP +
  security headers; no secrets in the bundle.
- **Reliability:** unsaved-draft guard for quotations; error boundary;
  logout control; list-truncation warnings; Muscat-day correctness; exact OMR
  math.
- **Quality gates:** full frontend + database CI matrix described in
  `ARCHITECTURE.md §7`.

## 3. Implemented but not verifiable from this workspace

| Item | Reason |
| --- | --- |
| Live production at `jiwdah.vercel.app` and the production Supabase project | no network egress to Vercel/Supabase from this environment; no browser tool |
| Effect of CSP headers on the live deployment | headers verified in `vercel.json` + smoke, but not observed over the wire |
| `enable_signup`, managed backups, plan/quotas in production | dashboard-only settings |
| Real-device PWA install/offline and Arabic voice quality | tests use mocks; no devices available |
| Human UAT checklists (`docs/operations/uat-*.md`) | no evidence of execution; requires humans + real project |

## 4. Open defects & known debt (details + evidence in PROJECT_DEFECTS.md)

| ID | Severity | Item | State |
| --- | --- | --- | --- |
| D2 | Medium (security-sensitive) | Public demo-mode grants installed in the schema | ✅ FIXED — migration 0059 removed the role, grants and helpers |
| D21 | Medium | Real list pagination (cap warnings are in place) | Open — product decision on UX pattern |
| D22 | Low→Medium | Quote draft autosave (blocking guard is in place) | Open |
| D17 | Low | Event date/time entry uses device timezone | Deferred — product decision |
| D19 | Low | N+1 readiness fan-out on the dashboard | Deferred — fine at current scale |
| D18 | Low | Unused local services enabled in `supabase/config.toml` | Deferred |
| D20 | Low | No retention policy for `audit_events` | Deferred |

## 5. Unknowns that need owner decisions (see also PRODUCT_SPEC §7)

1. Self-service signup policy (`enable_signup`) and who may create
   organizations.
2. Whether the public demo period has ended (affects D2 removal).
3. Production project provisioning: backups schedule, plan, domains, UAT
   execution.

## 6. Next priorities (safest first)

1. Human review of the 8 repair commits → push `arena/01a00fa3-starting` → open
   a PR against `main` (CI will run the full matrix).
2. D21 pagination for the events list (agreed pattern first).
3. D22 quote autosave.
4. Owner decisions: D2 removal migration, signup policy, production
   provisioning checklist.

## 7. Release verdict

The codebase is engineering-strong and its gates are green; it is **not yet
launched operationally** — the live-environment items in §3 remain
owner/operator tasks, and §4 decisions must be made before a real production
claim.
