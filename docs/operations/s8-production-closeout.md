# S8 — Production Hardening Closeout

> **Status:** Engineering closeout complete when the S8 CI gates are green.
> **Important:** this document does **not** claim that a live Hospitality production
> environment has been provisioned or that human acceptance has been completed.

## 1. What S8 closes

S8 converts production-readiness from documentation-only guidance into executable
acceptance proofs. The application remains a single Arabic-first web/PWA backed by
Supabase/PostgreSQL, with OMR money at three decimal places and Oman timezone
semantics.

The S8 engineering boundary is:

1. reproducible frontend build and production-preview smoke verification;
2. route-level code splitting with an explicit maximum-chunk gate;
3. database migration replay + pgTAP + concurrency evidence;
4. an actual local `pg_dump → reset → pg_restore → verify` drill;
5. deployment cache/security headers and SPA routing contract;
6. clear separation between automated engineering evidence and live launch tasks.

## 2. Frontend production proof

The CI frontend job runs:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:production
git diff --check
```

`scripts/production_smoke.mjs` starts the built `dist/` output using Vite's
production preview server and verifies:

- SPA HTML is served for `/`, `/login`, `/home`, `/events`, `/quotes`,
  `/procurement`, `/consumables`, `/catalog`, `/packages`, `/customers`, and
  `/staff`;
- `manifest.webmanifest` is Arabic, RTL, and starts at `/home`;
- `sw.js` is present and keeps its static-destination cache guard;
- Supabase Auth/REST endpoints are not explicitly included in the Service Worker
  cache contract;
- route-level code splitting emits multiple JavaScript chunks;
- the largest emitted JavaScript chunk is at most **500 KiB**;
- `vercel.json` retains the SPA fallback and required deployment security headers.

The smoke script puts a timeout on every HTTP probe and starts the Vite binary
itself so CI cannot remain stuck behind an orphaned npm child process.

## 3. Database production proof

The authoritative database CI job runs the complete clean-database chain:

1. start local Supabase;
2. replay all migrations with `supabase db reset`;
3. execute the full pgTAP suite;
4. execute the warehouse two-session concurrency proof;
5. execute the consumable catalog/profile concurrency proof;
6. execute the customer-payment concurrency proof;
7. execute the staff-payroll concurrency proof;
8. execute the backup/restore proof;
9. regenerate TypeScript database types and fail on byte drift.

### 3.1 Backup/restore drill

`scripts/native-db/backup_restore_proof.mjs` is intentionally destructive and is
therefore hard-guarded to **localhost only**. It refuses any DB host other than
`127.0.0.1` or `localhost`.

The proof:

1. resets to a clean migrated database;
2. inserts a deterministic organization + customer fixture;
3. calculates a stable content fingerprint;
4. takes a custom-format, data-only public-schema backup with `pg_dump`;
5. resets the database again and verifies the fixture is gone;
6. restores the dump with `pg_restore --disable-triggers`;
7. compares the pre/post fingerprint;
8. verifies customer→organization referential integrity and Oman/OMR invariants;
9. resets the local database again in `finally` so later gates start clean.

This proves that the repository's actual PostgreSQL data shape survives a real
dump/restore cycle. It does **not** prove that Supabase-managed production backups
are enabled or retained; that requires a real production project.

## 4. Deployment contract

`vercel.json` now defines:

- Vite build and `dist/` output;
- SPA fallback to `/index.html`;
- `index.html`: `no-cache, no-store, must-revalidate`;
- hashed `/assets/*`: one-year immutable cache;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`.

No secret is introduced into the repository. Browser `VITE_*` variables remain
public configuration only; `service_role` must never be exposed to the client.

## 5. UAT status

The existing UAT checklist remains the human/operator acceptance source. Automated
coverage is supplied by Vitest, pgTAP, concurrency harnesses, and the production
smoke proof. S9 additionally has automated evidence for:

- staff attendance record/void/corrected repost behavior;
- assignment/event/staff coherence and duplicate-live-slot prevention;
- host earnings, global advances, event-linked and global payouts;
- payroll concurrency and idempotency;
- invoice authority from the accepted quotation;
- invoice create/void idempotency and live-invoice uniqueness;
- cancelled installment-plan read semantics;
- owner attention/read-model behavior.

Human-only checks must not be relabeled as automated. Device/browser appearance,
real login UX, WhatsApp handoff, and operator usability still require a real
operator against the chosen staging/production environment.

## 6. Live launch gates — deliberately not claimed complete

Repository engineering closeout is not the same as going live. Before production
launch, all of the following must be true:

- [ ] A dedicated **Hospitality** Supabase project is selected/provisioned.
- [ ] A dedicated **Hospitality** Vercel project (or equivalent static host) is
      selected/provisioned.
- [ ] Production `VITE_SUPABASE_URL` and publishable/anon key are configured only
      in the hosting environment.
- [ ] Pending migrations are applied to staging/production using the documented
      forward-only process.
- [ ] Managed production backups are enabled and their retention is verified.
- [ ] A real production/staging dump is restored to a separate target and checked.
- [ ] Human UAT is executed on the deployed URL with the required roles/devices.
- [ ] No demo users or seed business data exist in production.
- [ ] A rollback owner and last-known-good frontend deployment are identified.

At S8 closeout time, the connected account exposes Supabase projects for other
products and Vercel projects for other products, but no Hospitality-specific live
project is identified. S8 therefore stops at the correct boundary instead of
modifying an unrelated production system.

## 7. Acceptance rule

S8 engineering closeout is accepted only when the branch/PR CI is fully green,
including the new production smoke and backup/restore drill. Any live launch claim
requires separate evidence for the gates in section 6.
