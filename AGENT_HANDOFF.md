# AGENT_HANDOFF.md — Context for the Next AI Agent

> Factual handoff, generated 2026-08-17 from the repository and executed
> checks. Read `AGENTS.md` first — its rules are non-negotiable.

## Repo state

- Repo: `mohamedmasoud3030-tech/starting`; branch `arena/01a00fa3-starting`;
  8 commits ahead of `main@375b31d` ("Phase 3 …"). Working tree clean.
- Last 8 commits are a stabilization series (logout control, error boundary,
  pgTAP shims, `create_organization` revoke [migration 0056], list-truncation
  warnings, quote-draft guard, procurement role gating, a11y wiring, Arabic
  login errors, self-hosted Cairo font, CSP, CI audit gate, Node pinning,
  docs). An open PR (#26) exists on a different branch and is unrelated.

## What the project is

Arabic-first RTL hospitality operations web app for Omani event-service
offices. Event-centric: quotation → confirmation → execution → close-out with
profit. React 19 + Vite + TanStack Router/Query SPA on Vercel; **no custom
backend** — all business logic lives in Supabase PostgreSQL (RLS +
SECURITY DEFINER RPCs). OMR money is `numeric(12,3)` (browser math in integer
milli-OMR); operational timezone is `Asia/Muscat`.

## Fast verification commands

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run smoke:production
```
Expected: 0/0 lint, 60 files / 496 tests, smoke passes.

Database verification (supplementary native path; authoritative is CI's
Supabase stack):
```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres node scripts/native-db/run.mjs
```
Replays 61 migrations + 16 pgTAP files (590 planned assertions). A scratch
PostgreSQL 18.4 launcher lives **outside the repo** at `/home/user/pg-harness`
(`node start-pg.mjs`, port 5433, user/password `postgres`). This workspace has
no Docker, no Supabase CLI, and no network egress beyond npm/GitHub.

## Hard rules (violations get rejected)

- Migrations are immutable; new changes = new numbered migration; chain must
  replay from empty (`supabase db reset` in CI).
- Never hand-edit `src/lib/database.types.ts` (CI type-drift gate). App types:
  `src/lib/dbTypes.ts`.
- No demo login path, no hardcoded credentials, no float money math, no client
  DELETE on master data, RLS always, role checks are server-side, audit writes
  internal-only, keep lint at 0 warnings.
- Public demo mode was removed entirely (migration 0059); AGENTS.md forbids demo paths.

## Where things live

- Routes: `src/routes.tsx`; features: `src/features/*`; UI kit:
  `src/components/ui/`; auth: `src/app/AuthContext.tsx`, `authRoles.ts`,
  `tenantCache.ts`; money/time: `src/lib/money.ts`, `dates.ts`.
- Schema: `supabase/migrations/` (61 files), tests `supabase/tests/` (16 files),
  seed intentionally empty.
- Docs: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `OPERATIONS.md`,
  `PROJECT_STATUS.md`, `PROJECT_DEFECTS.md`, `README.md`, `AGENTS.md`,
  `docs/architecture/*`, `docs/operations/*`.

## Known traps

- Procurement surfaces are cost-role-only (nav flag, workspace tab gate, page
  guard); keep them consistent.
- Quote editor has an unsaved-edit blocker (`useBlocker`); don't break the
  dirty-flag lifecycle in `useQuotationDraft.ts`.
- List queries use `count: "exact"` and `TruncationNotice` warnings (1000-row
  PostgREST cap); pagination (D21) and autosave (D22) are the planned next
  product work.
- `Field` wires `aria-describedby` through `fieldContext.ts`; keep the
  single-component-per-file fast-refresh convention (oxlint warns otherwise).

## Needs owner approval (do not do without it)

- Any production Supabase/Vercel action, removal migration for the demo-mode
  grants (defect D2), signup policy changes, data deletion, paid plans,
  public deployment, or architectural replacement.

## Unverified areas

Live Vercel/Supabase production behavior, production settings (signup,
backups, plan), real-device PWA/voice, and human UAT — see `PROJECT_STATUS.md`
§3 for reasons.
