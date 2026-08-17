# OPERATIONS.md — Environments, Deployment, Monitoring, Backup & Recovery

> Reconstructed 2026-08-17 from `vercel.json`, `supabase/config.toml`, CI
> workflow, scripts, and the operations docs. Commands below were executed in
> this workspace unless marked CI-only. No secret values appear here.

---

## 1. Environments

| Environment | Purpose | State |
| --- | --- | --- |
| Local frontend | `npm run dev` on port 3000 (host 0.0.0.0) | verified |
| Local Supabase stack | `supabase start` (needs Docker + CLI; ports: API 54321, DB 54322, Studio 54323, SMTP 54324) | CI-verified; not runnable in this workspace (no Docker) |
| Native PostgreSQL harness | `scripts/native-db/run.mjs` + concurrency scripts against any local PG | verified here on PG 18.4 (supplementary layer) |
| Production | Vercel (SPA, alias `jiwdah.vercel.app`) + Supabase project `livpmxwwxsfnaceczyth` | NOT verified from this workspace (no network egress to Vercel/Supabase) |

## 2. Environment variables (names only)

| Variable | Purpose | Where |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (public, embedded in bundle) | `.env` local / Vercel env |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key (public by design) | `.env` local / Vercel env |
| `VITE_PUBLIC_DEMO_MODE` | REMOVED — the temporary public demo mode was deleted (migration 0059 + frontend removal) | — |

Rules (enforced by docs and tests): never put `service_role` or DB passwords in
`VITE_*`; the build succeeds with no env at all (login shows a "not
configured" state).

## 3. Verified command set

```bash
npm ci                 # install (Node 22 — .nvmrc/engines pinned)
npm run dev            # dev server, port 3000
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # oxlint — must stay 0 warnings / 0 errors
npm test               # Vitest — 60 files / 496 tests
npm run test:watch
npm run build          # typecheck + vite build → dist/
npm run preview        # serve dist/ locally
npm run smoke:production   # SPA/PWA/SW/CSP/Vercel/chunk-size proof
npm audit --audit-level=high  # 0 vulnerabilities (also a CI gate)
```

Database (CI-authoritative path; needs Supabase CLI + Docker):
```bash
supabase start
supabase db reset          # = npm run db:reset  (replay 56 migrations from empty)
supabase test db           # 13 pgTAP files, 559 planned assertions
supabase gen types typescript --local --schema public > src/lib/database.types.ts
```

Database (supplementary native path; plain PostgreSQL, verified here):
```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
  node scripts/native-db/run.mjs
DB_URL=… node scripts/native-db/warehouse_concurrency.mjs      # + 7 more *_concurrency.mjs
DB_URL=… npm run db:backup-restore-proof                       # local-only guard built in
```

## 4. Build & deployment contract

- `vercel.json`: SPA fallback rewrite `/(.*) → /index.html`; `no-cache` for
  `/index.html`; `immutable` for `/assets/*`; headers nosniff,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  Content-Security-Policy (scripts self; styles self+inline; connect self +
  `https://*.supabase.co`; object none; frame-ancestors none).
- CI builds and runs the smoke proof on every push/PR; artifacts uploaded,
  retention 1 day.
- Deploy order: apply migrations **before** the frontend (documented runbook:
  `supabase link --project-ref …` + `supabase db push`, or psql per new file).
- Frontend deploy: push to `main` (Vercel auto-deploy) or `npx vercel --prod`.
- Rollback frontend: Vercel dashboard → promote last good deployment.
- Rollback database: no schema rollback — restore from backup or write a
  forward-only repair migration (data is NOT restored by schema-only
  migrations).

## 5. Backups & restore

- Source control is **not** a data backup: migrations rebuild schema only.
- CI executes a real proof: `pg_dump → reset → pg_restore → verify fingerprint`
  on the local Supabase stack (script refuses non-local hosts).
- Production: enable Supabase managed backups on the chosen plan (docs
  recommend Pro for automated backups); verify schedule/retention in the
  dashboard — this is an owner/operator task and **cannot be verified from the
  repository**. Manual pre-deploy dumps documented in
  `docs/operations/backup-restore.md` (incl. the circular-FK warning for
  data-only dumps and the restore-into-separate-target procedure).

## 6. Monitoring & incident basics

- Available today: Supabase dashboard (DB health, auth logs), Vercel deployment
  dashboard, browser console errors (ErrorBoundary logs unhandled render
  errors), CI status as regression radar.
- Not present: application error tracking (Sentry or similar), uptime alerts,
  structured log shipping — listed as future work in the runbook.
- Incident checks, in order: CI red? → read failing job; schema drift? →
  regenerate types; migration failure? → do NOT edit applied migrations,
  forward-fix; data problem? → restore drill in
  `docs/operations/backup-restore.md`.

## 7. Owner-controlled settings & recurring dependencies

| Setting | Where | Verified? |
| --- | --- | --- |
| Auth signup on/off (`enable_signup`) | Supabase dashboard | **unverified** (external) |
| Email confirmations | Supabase dashboard (local config: disabled) | local config only |
| Managed backup schedule/retention | Supabase dashboard | **unverified** (external) |
| Vercel env vars & domain | Vercel dashboard | **unverified** (external) |
| Demo-mode deployments | build-time env per deployment | mechanism verified; live usage unverified |
| Supabase plan/quotas | dashboard | not verifiable from repo |

## 8. Troubleshooting quick reference

- **Login shows "النظام غير مهيأ":** `.env` missing/wrong `VITE_SUPABASE_URL`.
- **Type drift failure in CI:** never hand-edit `src/lib/database.types.ts`;
  regenerate from a clean local stack.
- **Native harness fails with missing pgTAP function:** update
  `scripts/native-db/pgtap_shims.sql` (functions were completed in commit
  `f1b53ac`).
- **Offline banner visible:** informational only; writes remain idempotent and
  the database is authoritative.
- **List warning "أول 1000 …":** PostgREST `max_rows` cap reached; pagination
  is planned (defect D21).
