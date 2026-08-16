# Deployment and Production Runbook

> **Last updated:** 2026-08-15 | **S8 Production Hardening**

This document covers the infrastructure requirements, deployment procedure,
post-deployment verification, and rollback strategy for the Hospitality
Operations platform.

---

## 1. Required Infrastructure

| Component | Service | Managed by |
| --- | --- | --- |
| **Database + Auth** | Supabase (PostgreSQL) | Supabase platform |
| **Frontend hosting** | Vercel (or any static host) | Vercel / operator |
| **DNS** | Custom domain (optional) | Operator |
| **CI/CD** | GitHub Actions | GitHub |

### 1.1 Supabase Project

A Supabase project with the following configuration:

| Setting | Value |
| --- | --- |
| Plan | Pro (minimum) for automated backups |
| Region | Choose closest to Oman (e.g., `me-central-1`) |
| DB password | Strong, random, stored in secrets manager |
| Auth providers | Email/Password only (no magic link, no OAuth) |
| Auth session duration | 7 days (default) |
| Row Level Security | ✅ Enabled (set up by migrations) |

### 1.2 Frontend Hosting

The frontend is a **static SPA** (built by `vite build` into `dist/`). It can be
deployed to any static host:
- **Vercel** (recommended, with `vercel.json` included)
- **Netlify**
- **Cloudflare Pages**
- **AWS S3 + CloudFront**

Requirements:
- **SPA routing:** All paths must rewrite to `/index.html` (Vercel already
  configured in `vercel.json`).
- **HTTPS:** Required for Supabase Auth and Service Worker.
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## 2. Required Environment Variables

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL | ✅ Yes | Public (embedded in client bundle) |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → Anon Key | ✅ Yes | Public (embedded in client bundle) |

> ⚠ **Never use `VITE_*` for secrets.** Any variable prefixed with `VITE_` is
> inlined into the browser bundle at build time and visible to every client.

> ⚠ **Never use the `service_role` key** in the frontend. It bypasses RLS and
> grants full database access.

## 3. Database Migration Procedure

Migrations are applied **before** the frontend is deployed.

### 3.1 Local (development)

```bash
supabase start          # Start local Supabase
supabase db reset       # Replay all migrations from clean state
supabase test db        # Run pgTAP tests
```

### 3.2 Production

Supabase does not have a built-in "run pending migrations" command for remote
projects. Use one of these methods:

**Option A: Supabase CLI (recommended)**

```bash
# Link your local project to the remote Supabase project
supabase link --project-ref <your-project-ref>

# Push pending migrations
supabase db push
```

**Option B: Manual SQL execution**

```bash
# For each NEW migration file (not yet applied to production):
psql \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --file=supabase/migrations/<new-migration>.sql
```

### 3.3 Migration rules

- Migrations are **immutable** once applied. Never edit a committed migration.
- Always test with `supabase db reset` before deployment.
- After migration, regenerate types and commit any changes:
  ```bash
  supabase gen types typescript --local --schema public > src/lib/database.types.ts
  ```

## 4. Frontend Deployment

### 4.1 Build

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build    # output in dist/
```

The build requires NO environment variables to succeed. The app handles missing
configuration by showing a clear "not configured" state on the login page.

### 4.2 Deploy to Vercel

**Automatic (GitHub integration):**

1. Push to `main` (or merge a PR).
2. Vercel automatically builds and deploys (if connected to the GitHub repo).

**Manual:**

```bash
# Install Vercel CLI
npx vercel

# Deploy to production
npx vercel --prod
```

### 4.3 Deploy to a generic static host

```bash
# Build
npm run build

# Upload the dist/ directory to your static host
rsync -avz dist/ user@host:/var/www/hospitality/
```

Ensure the host is configured to:
- Serve `index.html` for all paths (SPA fallback).
- Set cache headers for static assets (`Cache-Control: public, max-age=31536000,
  immutable` for hashed files in `dist/assets/`).
- Set `Cache-Control: no-cache` for `index.html`.

### 4.4 PWA Requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| HTTPS | ✅ Required | Service Worker requires HTTPS (or localhost) |
| Manifest | ✅ `/manifest.webmanifest` | Already in `public/` |
| Service Worker | ✅ `/sw.js` | Caches only static assets (script, style, font, image) |
| Service Worker update | ⚠️ Browser-managed | SW checks for updates on navigation; `skipWaiting()` on install activates the new SW immediately |

## 5. Post-Deployment Smoke Verification

After each deployment, verify:

### 5.1 Frontend

1. ✅ Open the app URL — login page loads without console errors.
2. ✅ Login with a test user — redirects to `/home`.
3. ✅ The operational dashboard loads (or shows "No events today").
4. ✅ Navigate to each main page: Catalog, Packages, Customers, Events, Quotes,
    Consumables, Procurement.
5. ✅ Open the PWA manifest: `curl -s <URL>/manifest.webmanifest | jq .`
6. ✅ Verify Service Worker is active: Browser DevTools → Application → Service
    Workers.
7. ✅ Verify no tenant data is cached: Browser DevTools → Application → Cache
    Storage → `hospitality-static-v1` — only script/style/font/image entries.

### 5.2 Database

1. ✅ `supabase test db` passes on the production database (or a staging replica).
2. ✅ Run the integrity checks from [backup-restore.md](backup-restore.md#step-4--verify-restoration).
3. ✅ Verify RLS is active: `SELECT count(*) FROM public.events;` (as an
    unauthenticated user should fail or return 0).

### 5.3 PWA / Service Worker

1. ✅ Service Worker registered: check `navigator.serviceWorker.controller` in
    browser console.
2. ✅ Static assets cached: open DevTools → Network, reload — scripts/styles
    should serve `(from ServiceWorker)`.
3. ✅ No authenticated pages or API responses cached.

## 6. Rollback Considerations

### 6.1 Frontend Rollback

- **Vercel:** Use the Vercel dashboard → Deployments → find the last known
  good deployment → "Promote to Production".
- **Generic:** Re-deploy the previous `dist/` from the last known good build.

### 6.2 Database Rollback

PostgreSQL **does not support schema rollback**. Instead:

1. **Restore from backup:**
   - Follow [backup-restore.md](backup-restore.md#3-restore-procedure).
   - This is the only way to undo a destructive migration.

2. **Forward-only repair:**
   - Create a new migration that reverses the schema change.
   - ⚠ This does NOT restore lost data — only reverts the schema.

3. **Prevention:**
   - Always test migrations on a staging database first.
   - Take a manual backup before applying migrations to production:
     ```bash
     pg_dump --format=custom --no-owner --file=pre-deploy-$(date +%Y-%m-%d).dump \
       --host=<SUPABASE_DB_HOST> --username=postgres --dbname=postgres
     ```

## 7. Monitoring and Alerts

| What | How |
| --- | --- |
| App health | Vercel status dashboard / Uptime monitor |
| Database health | Supabase Dashboard → Database → Health |
| Auth failures | Supabase Dashboard → Auth → Logs |
| Error tracking | Browser console + (future: Sentry or similar) |

## 8. Security Checklist for Deployment

- [ ] All `VITE_*` env vars are set on the hosting platform (never in code or
      committed `.env`).
- [ ] `VITE_PUBLIC_DEMO_MODE` is **unset** (or `false`) on every production
      deployment. It is a temporary per-deployment opt-in that grants
      anonymous OWNER-equivalent capability (RLS-scoped to the named demo
      organization) and bypasses login; it must only be set on the dedicated
      demo deployment and removed when the demo ends.
- [ ] `service_role` key is NOT stored in any `VITE_*` variable or web-accessible
      location.
- [ ] The Supabase project has **Row Level Security** enabled (verify in
      Dashboard → Database → Policies).
- [ ] **No demo accounts** exist in the production database.
- [ ] **No hardcoded credentials** exist in the codebase.
- [ ] The Service Worker in `public/sw.js` is the production version (not a
      development version with broad caching).
- [ ] Automated daily backups are confirmed running.
- [ ] The deployment operator has executed the restore procedure and verified it.

## 9. Application Architecture Assumptions

| Assumption | Verified? | Notes |
| --- | --- | --- |
| HTTPS | ✅ Required | Supabase Auth requires HTTPS. Vercel provides it by default. |
| SPA routing | ✅ Configured | `vercel.json` rewrites all paths to `/index.html`. |
| Service Worker scope | ✅ `/` | PWA scope is the entire app. |
| Timezone | `Asia/Muscat` | All event date/time logic uses Oman timezone. |
| Currency | OMR | All money values are Omani Rial, 3 decimal places. |
| Language | Arabic (ar) | RTL-first, Arabic UI. |