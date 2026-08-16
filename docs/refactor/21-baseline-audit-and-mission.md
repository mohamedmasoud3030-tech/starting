# Baseline audit + multi-location / dashboard / PWA mission

## 1. Verified baseline

| Item | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/starting` |
| Stated baseline in brief | `1494cd7aa62c1d20e8384bb31d426c42b136c665` |
| Actual `origin/main` at start | `fc7887bdb3c3d9cad4fcde3ab2428b65c6991f52` |
| Relationship | `1494cd7` is a direct ancestor of `fc7887b` (one commit behind) |
| Canonical baseline used | `fc7887b` (confirmed by the repository owner) |

`fc7887b` ("refactor: modernize frontend architecture and secure demo mode") is the
squash-merge of the *previous* refactor mission: it removed
`imports/hospitality-platform-development-mission/`, decomposed AppShell /
QuotationEditor / EventWorkspace / OrdersArea / WarehousePanel / Consumables,
added the shared UI patterns, added the database audit doc, and gated
`PUBLIC_DEMO_MODE` behind `VITE_PUBLIC_DEMO_MODE`. That work is **not** redone here.

### Baseline verification (untouched `fc7887b`)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | pass (0 errors) |
| Lint | `npm run lint` | pass — 0 warnings, 0 errors, 188 files |
| Frontend tests | `npm test` | pass — **40 files, 376 tests** |
| Production build | `npm run build` | pass |
| Database (pgTAP, concurrency, restore) | CI job `database` | **not runnable in this workspace** — no Docker, no local Postgres, no root. 13 pgTAP files, planned assertions `64+12+15+94+44+35+82+16+26+30+22+19+97 = 556`. Unchanged by this work (no migration added). |

Nothing was failing on the untouched baseline.

## 2. Regression audit of the merged refactor (`1494cd7 → fc7887b`)

Checked the business-critical paths that the decomposition touched:

- **Quotation idempotency** — preserved exactly. `saveIntentRef` keeps a stable
  `{fingerprint, idempotencyKey}` and rotates the key only when the payload
  fingerprint changes; identical to the pre-refactor inline logic.
- **Money handling** — preserved. Package expansion still normalizes through
  `toOMRString(fromDbAmount(...))`; no float formatting was introduced.
  `buildPackageLines` additionally hardened a non-null assertion
  (`catalogById.get(...)!`) into an explicit `MISSING_CATALOG_ITEM` throw.
- **Authoritative logic** — no business rule moved from the database into the
  browser; every write still goes through an RPC.
- **Demo mode** — `PUBLIC_DEMO_MODE` is off unless `VITE_PUBLIC_DEMO_MODE === "true"`,
  pinned by `publicDemo.test.ts`.

**No regression found.** The merged refactor is sound. Findings below are
pre-existing defects it did not set out to address.

## 3. Evidence-backed findings addressed by this mission

### F1 — P0: cross-tenant / stale-identity client cache bleed

`logout()` and identity changes never reset the TanStack Query cache
(`grep` for `queryClient.clear|removeQueries|resetQueries` in `src/` returns
only an unrelated `Set.clear()` in the voice engine). Several cache keys are
also **not organization-scoped**:

| Key | File |
| --- | --- |
| `["event", eventId]` | `events.api.ts:18` |
| `["event-workspace", eventId, cost]` | `events.api.ts:23` |
| `["event-warehouse", eventId, canReadCost]` | `warehouse.api.ts:40` |
| `["event-consumables", eventId]` | `consumables.api.ts:236` |

Consequence: in one browser session, signing out and signing in as a user of a
different tenant (or switching organization) can **render another tenant's
cached rows**. RLS still protects the database — this is a presentation-layer
isolation defect, but it is exactly the class of bug tenant isolation must not
have, so it is treated as P0.

### F2 — multi-location is unreachable in the UI

The schema is fully multi-tenant (`organization_id` + composite FKs + RLS on
every table) and a user may hold several `organization_memberships`, but
`selectCurrentMembership()` hard-selects "first membership sorted by
organization name" and `authContext.ts` documents *"A multi-org switcher is
deferred"*. A multi-location operator therefore **cannot reach their other
locations at all**. This is the core multi-location product gap and is a pure
frontend gap — no schema change required.

### F3 — Dashboard correctness

1. **Fabricated zero.** `attendanceGapCount` renders `(gaps.data ?? []).length`
   with no loading gate, so an unresolved query displays a confident **`0`**
   ("لم يُسجَّل حضورها") next to metrics that correctly show `—`. AGENTS.md
   forbids invented statistics.
2. **Readiness vocabulary forked three ways** — `HomePage.readinessLabel`,
   `eventWorkspace.model.readinessText`, `screenSummary.readinessSentence`
   produce different Arabic for the same RPC status.
3. **Duplicated metrics.** "مناسبات اليوم", "تحتاج تدخل" and "مخزون منخفض"
   are rendered twice on one screen (metrics grid + "مركز انتباه المالك").
4. **Today's events computed twice** — once inline in `HomePage` to drive the
   readiness queries and once inside `buildOperationalDashboard`, each calling
   `new Date()` separately.
5. **Readiness errors are invisible** — the error card checks only
   `events.isError || stock.isError`.

### F4 — PWA is not operationally hardened

`public/sw.js` caches same-origin static assets only. There is **no navigation
fallback**, so a warehouse phone that loses connectivity gets the browser's
offline error page instead of the app shell. There is no offline signal in the
UI either, on a product whose primary use is on-site with poor connectivity.

## 4. Non-findings (deliberately not changed)

- **Historical migrations** — untouched. No squash, no edit, no deletion.
- **Database objects** — no live object dropped; no migration added. The
  existing audit in `docs/refactor/database-audit.md` stands.
- **Demo mode** — already correctly gated; left as-is.
- **Stack** — Vite + React + TypeScript + TanStack Router + Supabase + Postgres
  retained. No Next.js, Drizzle, Prisma, ORM, router or backend change.
