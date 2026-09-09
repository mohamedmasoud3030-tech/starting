# TECH_DEBT_AUDIT.md — Dependency, Tooling, Code Health & Technical Debt Audit

> Read-only audit, 2026-08-17. **No package was upgraded, removed, or modified;
> no product behavior changed.** All evidence was gathered from the working
> tree, `package-lock.json`, the public npm registry, GitHub API, and static
> analysis of `src/`, `scripts/`, `supabase/`, and `.github/`.
>
> Current verified baseline: `npm audit --audit-level=high` = **0 known
> vulnerabilities** · 60 files / 496 tests passing · lint 0/0 · build + smoke
> passing · CI green on `main`.

---

## 0. Summary

The dependency posture is **clean for its generation but aging on tooling**:
no deprecated or vulnerable direct dependencies, no unsafe install scripts
beyond the standard `esbuild`/`fsevents` binaries, no peer/version conflicts
(`npm ls` clean), lockfile in sync (`npm ci --dry-run` exit 0), zero circular
imports, zero TODO/FIXME, zero test skips, and zero `@ts-ignore` suppressions.

The main maintenance risks are (a) **Vite 6 is two majors behind** (latest
8.2.1; only the latest major receives fixes), (b) **GitHub Dependabot alerts
are disabled at repository level** (confirmed via API), and (c) several
**duplicated error-translation boundaries** and oversized modules that slow
future delivery. None of these is a production emergency: the right move is a
small approved patch wave now, one coordinated tooling-major wave later, and
no "upgrade everything" campaign.

---

## 1. Evidence gathered (read-only commands)

| Check | Command / method | Observed result |
| --- | --- | --- |
| Advisory DB | `npm audit --audit-level=high` | 0 vulnerabilities |
| Installed tree | `npm ls --depth=0` | clean, exit 0, no INVALID/UNMET |
| Lockfile sync | `npm ci --dry-run` | exit 0 |
| Deprecation flags | registry query for every installed direct dep | **no deprecated versions** |
| Install scripts | lockfile `hasInstallScript` scan | only `esbuild@0.25.12` + `fsevents@2.3.3` (standard platform binaries) |
| Root scripts | `package.json` | no `install`/`postinstall` hooks |
| Dependabot | `gh api repos/…/dependabot/alerts` | **"Dependabot alerts are disabled for this repository"** |
| Latest majors | registry `dist-tags` + `time` | see §2 staleness table |
| Node compat | registry `engines` per installed major | Node 22 satisfies every installed tool |
| Circular imports | custom DFS over `src/` import graph | **0 cycles** |
| TODO/FIXME/ts-ignore/skip | grep over `src/`, `scripts/`, `supabase/`, `.github/` | **none found** |
| Dead exports | usage scan of exported helpers & ui components | all used except `SectionHeader` (1 consumer) |
| Docs drift | number scan (`335/349/554/14 files/Node 18/لم تُنمذج`) | only dated historical records remain (see C5) |

## 2. Dependency staleness (installed vs latest)

| Package (installed) | Latest | Gap | Node engine note |
| --- | --- | --- | --- |
| vite 6.4.3 | **8.2.1** | 2 majors | Vite 8 needs 20.19+/22.12+ — Node 22 OK |
| @vitejs/plugin-react 4.7.0 | 6.0.5 | 2 majors (last in 4.x: ~13 months ago) | paired with Vite majors |
| jsdom 25.0.1 | 30.0.1 | 5 majors (last in 25.x: ~23 months ago; test-only) | ≥18 |
| typescript 5.9.3 | 7.0.2 | native/Go major | ≥14.17 |
| lucide-react 0.469.0 | 1.31.0 | 1 major (breaking icon rename wave) | — |
| tailwind-merge 2.6.1 | 3.6.0 | 1 major (breaking API) | — |
| @testing-library/jest-dom 6.9.1 | 7.0.1 | 1 major | ≥14 |
| @types/node 22.20.1 | 26.2.0 | aligned to Node 26; stay at 22 while runtime is 22 | — |
| @supabase/supabase-js 2.109.0 | 2.112.3 | **within declared range** (`^2.109.0`) | latest minor requires ≥22 — pinned Node 22 OK |
| @tanstack/react-router 1.170.27 | 1.170.29 | patch | — |
| @radix-ui/react-dialog 1.1.4 | 1.1.23 | minor | — |
| prettier 3.3.3 | 3.9.6 | minor (but unwired — see D3) | — |

Already current: react 19.2.8, vitest 4.1.10, oxlint 1.78.0, tailwindcss 4.3.3,
@tailwindcss/vite 4.3.3, @tanstack/react-query 5.101.4, pg 8.23.0, testing-library
react/user-event, @types/react(-dom), @fontsource/cairo, clsx.

---

## 3. Findings

### A. Confirmed security / support risk

**S1 — GitHub Dependabot alerts are disabled at repository level; no
Renovate config either.**
- Evidence: `gh api repos/mohamedmasoud3030-tech/starting/dependabot/alerts`
  → `"Dependabot alerts are disabled for this repository."`; no
  `.github/dependabot.yml`, no `renovate.json`.
- Impact: future advisories produce **no automated PRs**; awareness depends on
  the CI `npm audit --audit-level=high` gate (added recently) which only runs
  on push/PR and only blocks high+ severity.
- Likelihood of exploit today: low (0 known advisories for the installed tree).
- Smallest remediation: enable Dependabot alerts in repository settings
  (owner action) and optionally add `.github/dependabot.yml` (npm, weekly).
- Migration risk: none (settings/config only). Test prerequisites: none.
  Rollback: disable again. **Deferring is reasonable short-term** thanks to
  the CI audit gate; do it within this quarter.

**S2 — Vite 6 is two majors behind (latest 8.2.1).**
- Evidence: installed 6.4.3 (last release in 6.x 77 days ago); Vite maintains
  only the latest major; current docs target Baseline 2026 (vite.dev).
- Impact: no further patches/security fixes for Vite 6; dev-tool exposure only
  (Vite never ships to users). Likelihood of material harm: low-moderate.
- Smallest remediation: one coordinated major wave (see roadmap Stage 2):
  `vite@8` + `@vitejs/plugin-react@6` + `jsdom@30` (+ any config changes the
  migration notes require), verified with the full existing gate set.
- Migration risk: medium (Rolldown default, plugin API/config differences) —
  do it deliberately, not alongside feature work. Rollback: revert
  `package.json`/`package-lock.json`. **Deferring is reasonable for up to ~2
  quarters.**

**S3 — @vitejs/plugin-react 4.7.0** last release in its major ~13 months ago;
move together with S2 (5.x/6.x). Low independent risk.

**S4 — jsdom 25.0.1 (test-only)** five majors behind; no runtime exposure;
fold into the Stage 2 wave or bump separately (low risk, vitest 4 already
compatible with newer jsdom).

### B. Correctness / reliability debt

**C1 — Six independent Arabic error translators duplicate one pattern.**
- Evidence: `events.api.ts:384 arabicError` (maps only 3 codes, falls through
  to the **raw backend message**), `quotes.api.ts:165 arabicQuotationError`,
  `payments.api.ts:187 paymentError`, `invoices.api.ts:214 invoiceError`,
  `procurement/errors.ts` (registry + aliases, most complete),
  `staff.api.ts:558 attendanceError`, plus `auth/authErrors.ts`.
- Impact: inconsistent user messaging; divergent raw-text leakage behavior
  across domains; each new domain re-invents the mapping.
- Smallest remediation: one shared `machineCode → Arabic` registry module with
  per-domain entries; migrate domains one at a time, keeping each domain's
  tests as the contract. Risk: touches many error surfaces — do per-domain.
  Test prerequisites: existing per-domain tests must stay green.
  **Deferring is reasonable; consolidate opportunistically.**

**C2 — No coverage measurement anywhere.**
- Evidence: no coverage provider in `package.json`/`vitest.config.ts`, no CI
  step or threshold. 496 tests exist but nothing guards against silent
  critical-path coverage loss.
- Smallest remediation: add `@vitest/coverage-v8` (dev) + a modest threshold
  on the money/quotation/invalidation core. Risk: new devDependency only.
  Deferring reasonable; do with the next test-infra touch.

**C3 — oxlint runs only `react` + `oxc` plugins (`.oxlintrc.json`): no
accessibility rules.** A11y is currently enforced by manual patterns and
behavior tests. Enabling `jsx-a11y` rules incrementally would catch drift
early (may initially produce warnings to triage). Low risk, low urgency.

**C4 — Money-parse regex re-implemented outside `money.ts`:** `omrToSpoken`
in `screenSummary.ts` parses OMR decimals with its own regex (narration-only,
pinned by tests, never a numeric authority). A duplicated financial-parsing
boundary — unify when either file is touched.

**C5 — Dated historical CI counts remain in old closeout reports**
(`docs/architecture/18-r10-closeout.md`: "349 tests", "14 files / 554").
These are dated evidence records of past runs, not live status; current docs
are correct. Either annotate them as historical or leave. Cosmetic.

### C. Delivery-speed debt

**D1 — Oversized hand-written modules:** `ownerVoice/screenSummary.ts` 869
lines, `procurement/supabaseDataSource.ts` 758, `staff/staff.api.ts` 581,
`consumables/consumables.model.ts` 559. They are coherent and tested; split
only when a feature touches them. No current defect.

**D2 — `SectionHeader` has a single consumer** (`procurement/OrdersArea.tsx`).
Near-dead shared component: adopt it more widely or fold it into the consumer.
Cosmetic.

**D3 — `prettier` devDependency is unwired:** no `.prettierrc`, no `format`
script, no CI step; the Supabase type generator uses its own bundled prettier
(`docs/ci/README.md`). Verify editor usage before removing, or wire
`format`/`format:check` scripts. Cosmetic, but confusing for new contributors.

**D4 — No `format` command and no a11y lint** (see C3) — minor contributor
onboarding friction.

### D. Performance / cost debt

**P1 — `supabase-vendor` chunk ≈ 208 KiB (54 KiB gzip) is the largest bundle
chunk** (full `@supabase/supabase-js` for auth + PostgREST). Acceptable today;
the smoke gate already caps chunk size at 500 KiB. Do **not** swap SDKs for
size — high risk, low value.

**P2 — Readiness N+1 fan-out on the dashboard** (one `event_readiness` query
per today's event) — already registered as defect D19; fine at current scale.

**P3 — Dev-only disk footprint:** `node_modules` ≈ 263 MB (lucide-react 36 MB
dev-only, tree-shaken to ~18 KiB in the bundle; oxlint/tailwind binaries).
No action.

### E. Cosmetic cleanup with little current value

SectionHeader adoption (D2), unwired prettier (D3), historical-doc annotation
(C5). Do not prioritize these over functional work.

---

## 4. Debt register (ranked by Risk Reduction × User Value ÷ Effort)

| ID | Finding | Cat. | RR | UV | Effort | Priority | Defer OK? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Dependabot alerts disabled + no automation | security | 4 | 2 | 1 | **High** | short-term only |
| S2 | Vite 6 two majors behind | security/support | 3 | 1 | 3 | Medium-High | ≤ 2 quarters |
| C2 | No coverage measurement/threshold | reliability | 2 | 1 | 2 | Medium | yes |
| S4 | jsdom 25 → current (test-only) | support | 2 | 1 | 1 | Medium | yes (with S2) |
| C1 | 6 duplicate error translators | correctness | 2 | 2 | 3 | Medium | yes |
| S3 | plugin-react 4 → 6 | support | 2 | 1 | 2 | Medium | with S2 |
| C3 | No a11y lint rules | correctness | 1 | 2 | 2 | Low-Medium | yes |
| C4 | Money regex duplicated in voice layer | correctness | 1 | 1 | 1 | Low | yes |
| D1 | Oversized modules (4 files) | delivery | 0 | 1 | 3 | Low | yes |
| D3 | Unwired prettier dep | delivery | 0 | 1 | 1 | Low | yes |
| D2 | Near-dead SectionHeader | cosmetic | 0 | 0 | 1 | Low | yes |
| C5 | Historical-doc numbers | cosmetic | 0 | 1 | 1 | Low | yes |
| P1 | Large supabase chunk | performance | 0 | 1 | 4 | Low | yes (no action) |
| P2 | Readiness N+1 (D19) | performance | 0 | 1 | 2 | Low | yes |
| P3 | 263 MB dev node_modules | cosmetic | 0 | 0 | 1 | — | yes |

## 5. Packages to update NOW (after approval — safe patch/minor wave)

> **EXECUTED 2026-08-17 (commit `234dd6c`)**: the three in-range bumps below
> were applied (lockfile-only change; `package.json` ranges unchanged) and the
> full gate set re-run green: `npm ci` 0 vulns · typecheck 0 · lint 0/0 ·
> **496/496 tests** · build ✓ (supabase-vendor chunk 208.2→213.8 kB, still far
> under the 500 KiB smoke gate) · `npm run smoke:production` ✓ ·
> `npm audit --audit-level=high` 0. Rollback = revert commit `234dd6c`.

| Package | From → To | Result |
| --- | --- | --- |
| @supabase/supabase-js | 2.109.0 → 2.112.3 | ✅ done (engines ≥22 satisfied; CI pins 22) |
| @tanstack/react-router | 1.170.27 → 1.170.29 | ✅ done |
| @radix-ui/react-dialog | 1.1.4 → 1.1.23 | ✅ done |
| prettier (if kept) | 3.3.3 → 3.9.6 | ⏸ deferred — D3 decision (keep vs remove) stays open; no wiring added to avoid repo-wide churn |

**S1 update:** an attempt to enable Dependabot alerts via the GitHub API from
this workspace returned `404/Not Found` (settings not writable with the
sandbox token). Enablement remains an **owner action** (repository
Settings → Code security → Dependabot alerts), optionally followed by a
`.github/dependabot.yml` for weekly npm version-update PRs.

Verification for this wave: `npm ci && npm run typecheck && npm run lint &&
npm test && npm run build && npm run smoke:production`. Rollback: revert the
lockfile change (single commit).

## 6. Packages to POSTPONE (majors — do not rush)

- `vite` 8, `@vitejs/plugin-react` 6, `jsdom` 30 → **one coordinated tooling
  wave** (Stage 2), never piecemeal with feature work.
- `typescript` 7 (native) → wait for ecosystem maturity; TS 5.9 is stable.
- `lucide-react` 1.x → icon rename/removal wave; verify visual impact first.
- `tailwind-merge` 3.x → breaking class-grouping changes; low value.
- `@testing-library/jest-dom` 7, `@types/node` 26 → align only when the
  runtime moves off Node 22.

## 7. Unused items to VERIFY before removal (not confirmed dead)

| Item | Evidence | Verification step |
| --- | --- | --- |
| `prettier` (devDep) | no config/script/CI reference; generator uses bundled prettier | grep editors' configs + ask team; then wire `format` scripts **or** remove |
| `SectionHeader` (ui) | single consumer `OrdersArea.tsx` | adopt in ≥1 more screen or fold into consumer, then remove from kit |
| (checked and confirmed USED) clsx, tailwind-merge, @fontsource/cairo, pg, all testing-library packages, lucide-react, radix, router/query | usage scan | — |

No dead exports found beyond the above; no TODO/FIXME; no skipped/disabled
tests; no type suppressions; no circular imports; no duplicate live DB objects
(repeated `create or replace` are sequential hardening edits — prior audit).

## 8. Staged maintenance roadmap

- **Stage 0 — Owner approvals (no code):** enable Dependabot alerts (+
  optional `dependabot.yml` weekly npm); decide prettier keep/remove; decide
  the tooling-wave quarter.
- **Stage 1 — Safe patch wave:** the four "update now" bumps in one commit
  after the Stage 0 approvals; full gates; merge separately from features.
- **Stage 2 — Tooling major wave (planned quarter, with buffer):** Vite 8 +
  plugin-react 6 + jsdom 30; follow migration notes; full gates + manual
  `npm run preview` check; revert plan = revert the single commit.
- **Stage 3 — Code health (opportunistic, per-domain):** shared error
  translator (C1), coverage threshold (C2), incremental a11y lint rules (C3),
  split oversized modules when touched (D1), unify voice money parsing (C4).
- **Stage 4 — Product debt (already registered):** D21 pagination, D22 quote
  autosave, and the other open items in `PROJECT_DEFECTS.md`.

## 9. What was deliberately NOT recommended

- No "upgrade everything": majors carry breaking changes with little current
  user value.
- No framework/SDK swaps (no lighter Supabase client, no router change): high
  risk, no measurable benefit.
- No style-consistency campaign: the codebase is already consistent
  (lint 0/0, single patterns per layer).
- No removal of working, tested code (e.g., sized-but-coherent modules).
