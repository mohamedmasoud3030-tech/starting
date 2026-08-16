# Mission report — multi-location, dashboard correctness, IA, UX, PWA

## Baseline

| Item | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/starting` (verified via `git remote -v`) |
| Baseline in original brief | `1494cd7aa62c1d20e8384bb31d426c42b136c665` |
| Actual `origin/main` | `fc7887bdb3c3d9cad4fcde3ab2428b65c6991f52` (1494cd7 is its direct ancestor) |
| Canonical baseline used | **`fc7887b`** — confirmed by the owner |
| Branch | `feat/multi-location-architecture-dashboard-pwa` |
| Commits | 6, logically isolated |

`fc7887b` is the squash-merge of the previous refactor mission. It was audited,
not redone.

## Baseline verification (untouched `fc7887b`)

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | 0 warnings, 0 errors (188 files) |
| `npm test` | **40 files, 376 tests, all passing** |
| `npm run build` | pass |
| Database (pgTAP/concurrency/restore) | **not runnable here** — no Docker/Postgres/root. CI-only. |

Nothing was failing on the untouched baseline.

## Regression audit of the merged refactor

Verified against `1494cd7`:

- **Quotation idempotency** — stable fingerprint/key rotation preserved exactly.
- **Money** — package expansion still normalizes via `toOMRString(fromDbAmount(...))`;
  no float path introduced. `buildPackageLines` hardened a `!` assertion into an
  explicit `MISSING_CATALOG_ITEM` throw.
- **Authoritative logic** — nothing moved from the database into the browser.
- **Demo mode** — correctly env-gated, off by default, pinned by tests.

**No regression found.** Everything below is a pre-existing defect.

## What changed

### 1. P0 — tenant cache isolation (`8447fba`)

`logout()`/identity change never cleared the query cache, and four keys were not
org-scoped (`event`, `event-workspace`, `event-warehouse`, `event-consumables`).
Two identities in one tab could share cache entries, so a sign-out/sign-in as a
different tenant could **render the previous tenant's rows**. RLS always
prevented *fetching* them — this was a presentation-layer defect, fixed with two
redundant mechanisms: org-scoped keys, plus `queryClient.clear()` on
`identityKey(userId, orgId)` change. `clear()` not `invalidate()`, because
invalidation keeps stale data mounted while refetching.

### 2. Multi-location (`49b4972`)

The schema was always multi-tenant, but the frontend hard-selected "first
membership by name" and documented the switcher as deferred — a multi-location
operator could not reach their other locations at all. Added
`switchOrganization`, a validated preference, and a header switcher that renders
**only** for users with 2+ memberships. `selectCurrentMembership` honours a
selection only when it matches a real ACTIVE membership, so a tampered
preference cannot widen access.

### 3. Dashboard correctness (`7884caa`)

- **Fabricated zero removed**: `attendanceGapCount` had no loading gate and
  rendered a confident `0` while its neighbours showed `—`. All counts are now
  `PendingCount` (`number | null`); only a settled zero renders `0`.
- Readiness/attendance query failures are now surfaced, not silent.
- "Today" is computed once per render instead of from two separate `new Date()`
  calls that could disagree across midnight.
- Three metrics were rendered **twice** on one screen; now one metrics band,
  with attendance gaps folded into the alert list.
- Readiness vocabulary unified into `readiness.model.ts` (label + tone). Spoken
  and workspace registers deliberately left alone.
- Extracted `useOperationalDashboard`; added shared `StatCard`.

### 4. PWA hardening (`20517bf`)

No navigation fallback existed, so an offline reload showed the browser error
page despite every asset being cached. Navigations are now network-first with a
cached app-shell fallback. Non-GET and all cross-origin (Supabase) traffic is
never intercepted, so **no stale operational number is ever served as fact**.
Added versioned caches, one-shot reload on `controllerchange`, and an offline
banner. The smoke proof now asserts these invariants.

### 5. Information architecture (`f74a02b`)

A WAREHOUSE user saw all 12 workspace tabs, 3 of which led only to a
"not available for your role" panel. Tabs are now derived from the same
`eventPermissions` that gate the panels; panel guards kept as defence in depth.
Also fixed the mobile bar hardcoded to `grid-cols-4` with 3 targets.

### 6. Database audit (`663d225`)

Swept every `create table`: `organization_id` present on all business tables
(only `organizations`, the tenant root, lacks it). `is_org_member` /
`has_org_role` authorize per organization id, so multi-location needed **no
schema change**. Demo grants cannot follow a switch into a real tenant.

## Verification (final, on `663d225`)

| Check | Baseline | Final |
| --- | --- | --- |
| Typecheck | pass | **pass** |
| Lint | 0/0 (188 files) | **0/0 (201 files)** |
| Tests | 40 files / 376 | **45 files / 408** (+32, none weakened) |
| Build | pass | **pass** |
| Production smoke | pass | **pass** (+3 new PWA assertions) |
| Working tree | clean | **clean** |

Test-file edits were limited to adding `switchOrganization` to two existing
mocks and one import line. **No assertion was deleted or weakened.**

## Database

- **No migration added.** No historical migration edited, squashed or deleted.
- No live database object dropped.
- pgTAP: 13 files, 556 planned assertions — unchanged, CI-only (no Docker here).

## Remaining technical debt

1. **Database suite unverified locally** — needs Docker/Supabase CLI; CI covers it.
2. `events.api.ts` remains minified-style single-line code; untouched deliberately
   (high-risk, unrelated to this mission).
3. No org-switch integration test at `AuthProvider` level (unit-covered instead).
4. `useOperationalDashboard` uses a `dataUpdatedAt` join as a memo dep — correct
   but slightly subtle.
5. Offline is read-only; no write queue (deliberate — idempotency is per-command).

## Stack confirmation

Vite + React 19 + TypeScript + TanStack Router/Query + Supabase + PostgreSQL,
unchanged. **No Next.js, no Drizzle, no Prisma, no ORM, no router swap, no
backend replacement, no new schema.** Arabic-first RTL preserved throughout.
