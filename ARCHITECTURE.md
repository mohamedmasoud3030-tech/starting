# ARCHITECTURE.md — System Architecture

> Reconstructed 2026-08-17 from the repository, the replayed database, and
> executed checks. Text diagrams use ASCII. "Verified" means observed in this
> workspace or in the project's CI evidence.

---

## 1. Runtime topology

```
┌────────────────────────── Browser (Arabic RTL SPA) ─────────────────────────┐
│ React 19 + TS (strict) · Vite 6 · TanStack Router (14 routes, lazy)        │
│ TanStack Query (server state) · Tailwind CSS v4 + hand-built ui/ kit       │
│ Money: integer milli-OMR (BigInt) · Time: Asia/Muscat · PWA (sw.js v2)     │
└───────────────┬───────────────────────────────────────┬────────────────────┘
                │ HTTPS REST (PostgREST)                │ HTTPS Auth/Realtime
                ▼                                       ▼
┌──────────────────────────── Supabase (managed) ─────────────────────────────┐
│ Auth (email/password, JWT)      PostgreSQL 15                               │
│ PostgREST /api                 ┌─────────────────────────────────────────┐ │
│                                │ public schema: 36 tables, 31 views,      │ │
│                                │ 143 business functions, 50 RLS policies, │ │
│                                │ 40 triggers, 132 indexes                 │ │
│                                │ app_private: internal helpers (revoked)  │ │
│                                │ ALL business logic lives here (RPCs)     │ │
│                                └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                │ static hosting
┌───────────────▼─────────────────────────────────────────────────────────────┐
│ Vercel (SPA dist/, vercel.json: SPA rewrite, cache policy, security headers)│
└─────────────────────────────────────────────────────────────────────────────┘
```

There is **no custom application server**. The database is the single source of
truth; every business rule is enforced there. The frontend is a static SPA.

## 2. Frontend architecture

- Entry: `src/main.tsx` — ErrorBoundary → QueryClientProvider → AuthProvider →
  RouterProvider; registers the service worker; imports self-hosted Cairo font
  weights (`@fontsource/cairo`). **[V]**
- Routing: `src/routes.tsx` (14 routes) + `src/routes.lazy.tsx` (route-level
  code splitting); Vite `manualChunks` splits React/TanStack/Supabase/Radix/
  icons vendors; production smoke enforces largest chunk ≤ 500 KiB (actual
  largest ≈ 208 KiB). **[V]**
- Server state: one `QueryClient` (staleTime 30 s, retry 1, no refocus
  refetch). Query keys are organization-scoped; identity change clears the
  entire cache (`tenantCache.ts`) as a second isolation layer. **[V]**
- UI kit: `src/components/ui/` (Button, Input, Select, Textarea, Field, Dialog
  [Radix], MoneyInput, Badge, Card, Empty/Error/Loading states, StatCard,
  TruncationNotice, …). Field errors are announced via `aria-describedby`
  through a field context. AppShell has a skip link, desktop sidebar, mobile
  drawer + bottom bar, offline banner, org switcher (multi-membership users
  only), logout control. **[V]**
- Features: `src/features/{auth,home,events,quotes,catalog,packages,customers,
  warehouse,consumables,procurement,payments,staff,ownerVoice}`; each feature
  owns its `.api.ts` data layer and tests.

## 3. Data-flow contracts

### Reads
```
Screen → useQuery(org-scoped key) → PostgREST SELECT on table/view
      → RLS policy scopes rows to ACTIVE membership in ACTIVE organization
      → cost-bearing read models filter by can_read_cost(...)
      → operational projections (catalog_items_operational, …) never expose cost
```
Views are mostly `security_invoker` backed by `_view_*` SECURITY DEFINER
functions (quotation family), or plain scoped views. **[V]**

### Writes (all of them)
```
UI → supabase.rpc(command, {p_org_id, …, idempotency_key})
   → SECURITY DEFINER function (search_path pinned)
   → checks: role via has_org_role(p_org_id) · org ACTIVE · lifecycle state
   → row locks in stable order (event → reservation → capacity; …)
   → idempotency: command_idempotency(org, scope, key) + SHA-256 payload
   → insert + record_audit (internal-only) → returns result
```
Direct client table writes exist only for the small CRUD surfaces whose RLS
policies carry role checks (customers, catalog, packages, staff members, org
membership/org update). All financial/ledger writes are RPC-only. **[V]**

## 4. Trust boundaries and security posture

| Boundary | Mechanism (verified) |
| --- | --- |
| Tenant isolation | RLS on all 36 business tables; composite FKs prevent cross-org references structurally |
| Cost-data separation | `cost_price`/`internal_notes` only via cost-role reads; operational projections strip them; valued read models add `WHERE can_read_cost` |
| Client-supplied org id | Never trusted; `is_org_member`/`has_org_role` resolve from `auth.uid()`; commands re-derive |
| Command replay | Canonical `command_idempotency` register; internal-only (not readable by clients) |
| Audit | `audit_events` append-only, read by OWNER/MANAGER only, written by `record_audit` (client-inaccessible) |
| Destructive deletion | No client DELETE policies on master data; ACTIVE/INACTIVE; append-only ledgers with structural guards |
| Bootstrap function | `create_organization` revoked from browser roles (migration 0056) |
| Demo mode | REMOVED (migration 0059): no anonymous elevated grants exist; AGENTS.md forbids demo login paths |
| Browser hygiene | No `dangerouslySetInnerHTML`; no `any` in production code; error translators never render raw backend text (quotes/procurement/staff/login domains) |
| HTTP headers (Vercel) | CSP (scripts self, connect self + `https://*.supabase.co`, frame-ancestors none, object none), nosniff, X-Frame-Options DENY, strict-origin referrer |
| Secrets | Only public anon key in bundle; service_role never used client-side |

## 5. Money and time semantics

- OMR `numeric(12,3)` persisted; in-browser integer milli-OMR via
  `src/lib/money.ts`; BigInt products; half-away-from-zero rounding; UI input
  enforces the persisted domain. **[V — money.test.ts]**
- `Asia/Muscat` operational timezone in SQL and UI (`todayInMuscat`, server
  functions). **[V — dates.test.ts]**

## 6. PWA architecture

`public/manifest.webmanifest` (lang ar, dir rtl, start_url `/home`, standalone,
192/512 icons, two shortcuts) and `public/sw.js` (v2):

- `install`: pre-cache app shell (rejects redirected responses) + skipWaiting.
- `activate`: delete unknown caches + claim clients.
- `fetch`: navigations network-first with cached-shell fallback (offline open);
  static script/style/font/image cache-first; **never** intercepts non-GET,
  cross-origin (Supabase), or same-origin fetch/XHR traffic.
- Registration reloads the page once on `controllerchange` (fresh build).
- Behavior is exercised by 11 tests running the real handlers
  (`serviceWorker.behavior.test.ts`); the production smoke asserts the guard
  strings. **[V]**

## 7. Testing and CI/CD

```
CI (.github/workflows/ci.yml) on every push/PR:
├─ frontend: npm ci → npm audit (high) → typecheck → oxlint → vitest
│            → vite build → production smoke → artifact → git diff --check
└─ database: Supabase CLI 2.114.0 → supabase start → db reset (56 migrations)
             → supabase test db (13 pgTAP files, 559 planned assertions)
             → 5 concurrency proofs → backup→reset→restore proof
             → gen types → FAIL if committed src/lib/database.types.ts drifts
```

- Frontend: Vitest + Testing Library + jsdom — 60 files, 496 tests. **[V]**
- Native supplementary harness: `scripts/native-db/run.mjs` replays migrations
  and the official pgTAP files against any plain PostgreSQL via minimal shims
  (pg 18.4 verified here; CI's authoritative layer is the Supabase stack).
- Concurrency harnesses (two real sessions): warehouse, consumables,
  consumable-catalog, payments, quotation, staff-payroll, procurement,
  procurement-lifecycle — all PASSED. **[V]**
- Production smoke: SPA routing for all public paths, PWA manifest/icons/SW
  contracts, code-split cap, Vercel headers contract (incl. CSP), no external
  font CDN. **[V]**

## 8. Deployment and operations

Static `dist/` on Vercel (`vercel.json`: all routes → `/index.html`; `no-cache`
for `index.html`; immutable for hashed assets; security headers; alias
`jiwdah.vercel.app`). Database on Supabase (PG 15); migrations applied before
frontend deploys and are immutable. Backups: Supabase-managed schedule (owner
task) + documented `pg_dump`/`pg_restore` runbook with a CI-executed
backup→reset→restore→verify proof. Details: `OPERATIONS.md`. **[V]**

## 9. Known architectural debt (registered in PROJECT_DEFECTS.md)

- No pagination (cap warnings only) — D21; quote autosave — D22.
- N+1 readiness fan-out per today's event — D19 (accepted for current scale).
- Demo-mode grants still installed in schema — D2 (owner decision).
- No error telemetry (Sentry etc.); no E2E browser suite (no Playwright);
  real-device PWA/voice untested.
