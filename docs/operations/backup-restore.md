# Database Backup and Restore

> **Last updated:** 2026-08-15 | **S8 Production Hardening**

This document defines the production-usable backup and restore procedure for the
Hospitality Operations platform's PostgreSQL/Supabase database.

---

## 1. Overview

The system uses **Supabase (PostgreSQL)** as its single data authority. GitHub
source control is NOT a database backup — the migrations (`supabase/migrations/`)
contain only the schema, never the data.

| What | Backed up? | Method |
| --- | --- | --- |
| PostgreSQL data (tables, rows) | ✅ Yes | `pg_dump` / Supabase DB Backup |
| Supabase Auth (users) | ✅ Yes | Included in `pg_dump --schema-only` for schema, but auth data requires `supabase` schema backup |
| Storage (files/images) | ❌ Not used yet | N/A — no file storage implemented |
| Environment / secrets | Manual | `.env` file, Supabase project settings |
| Source code | ✅ Yes | Git (`origin/main` + feature branches) |

## 2. Database Backup

### 2.1 Automated (Supabase Pro plan)

Supabase Pro and above include **automated daily backups** with 7-day retention.

- Access: **Project Dashboard → Database → Backups**
- Contents: Full database dump including `auth` schema, `storage` schema, and
  `public` schema.
- Schedule: Daily, automatically.
- Download: Available as a `.sql` file from the dashboard.

### 2.2 Manual (`pg_dump`)

Run from any machine with `pg_dump` installed and network access to the Supabase
project:

```bash
# Full backup (all schemas, including auth)
pg_dump \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=hospitality-$(date +%Y-%m-%d).dump

# Data-only backup (public schema — can be restored into a migrated schema)
pg_dump \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --schema=public \
  --data-only \
  --exclude-table=cron.* \
  --format=custom \
  --file=hospitality-data-$(date +%Y-%m-%d).dump
```

**Connection details** are in **Project Dashboard → Project Settings → Database**.

> ⚠ **Security:** Never commit the connection string to Git. The `.env` file
> (which is `.gitignore`d) may contain the anon key only — the `postgres` role
> password must be stored in a secrets manager (1Password, Bitwarden, etc.).

### 2.3 What CI Proves

CI (`.github/workflows/ci.yml`) proves the **schema can be rebuilt from scratch**:

1. `supabase db reset` replays all migrations on a clean database.
2. `supabase test db` runs the pgTAP suite, confirming:
   - RLS policies are correctly applied.
   - Role-based access control works.
   - Cross-org isolation is enforced.
3. Type drift detection confirms generated types match the replayed schema.

What CI does **not** prove:
- That a data dump can be restored (requires a real Supabase project).
- That backup files are being created on schedule (production infrastructure).

## 3. Restore Procedure

### 3.1 Restore into a Clean Supabase Project

Prerequisites:
- A Supabase project (new or existing) with the same region (optional but
  recommended).
- The `postgres` role password.
- `pg_restore` or `psql` installed locally.

**Step 1 — Apply migrations (schema only)**

```bash
supabase db reset
```

This replays all migrations from scratch, producing an empty database with the
correct schema, RLS, functions, triggers, and views.

**Step 2 — Verify schema integrity**

```bash
supabase test db
```

All pgTAP tests must pass. If they fail, the target environment has a schema
mismatch — do not proceed with data restore.

**Step 3 — Restore the data**

```bash
# If using a custom-format dump:
pg_restore \
  --host=<TARGET_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  hospitality-<date>.dump

# If using a plain SQL dump:
psql \
  --host=<TARGET_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --file=hospitality-<date>.sql
```

> ⚠ `--disable-triggers` is **required** for `pg_restore` when restoring
> data-only into a schema that has `BEFORE INSERT` triggers (our consumable
> and warehouse ledgers have structural guards that would reject historical
> data). The triggers are re-enabled automatically by the restore.

**Step 4 — Verify restoration**

Run these checks after restore:

```sql
-- (1) Count business objects
SELECT 'organizations'     , count(*) FROM public.organizations
UNION ALL
SELECT 'customers'         , count(*) FROM public.customers
UNION ALL
SELECT 'events'            , count(*) FROM public.events
UNION ALL
SELECT 'quotations'        , count(*) FROM public.quotations
UNION ALL
SELECT 'procurement_orders', count(*) FROM public.procurement_orders
UNION ALL
SELECT 'customer_payments' , count(*) FROM public.customer_payments
UNION ALL
SELECT 'catalog_items'     , count(*) FROM public.catalog_items;

-- (2) Verify no negative stock or ledger anomalies
SELECT 'consumable_negative_balance', count(*)
  FROM public.consumable_movements
 GROUP BY stock_item_id
HAVING sum(warehouse_delta) < 0;

-- (3) Verify RLS is active on all business tables
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_type = 'BASE TABLE'
   AND table_name NOT IN ('_pgtap_results', 'pgtap_version')
 ORDER BY table_name;

-- (4) Verify auth users exist
SELECT count(*) FROM auth.users;
```

**Step 5 — Update environment**

Update the target project's `.env`:

```bash
VITE_SUPABASE_URL=https://<new-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<new-project-anon-key>
```

### 3.2 Restoration into a Local Development Environment

```bash
# 1. Start Supabase local stack
supabase start

# 2. Apply migrations
supabase db reset

# 3. Restore data (use the same pg_restore command from Step 3 above,
#    pointing to the local Supabase database at localhost:54322)
pg_restore \
  --host=127.0.0.1 \
  --port=54322 \
  --username=postgres \
  --dbname=postgres \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  hospitality-<date>.dump
```

## 4. Responsibility Matrix

| Task | Who | Automated? |
| --- | --- | --- |
| Schema migration replay | CI + developer | ✅ CI (`supabase db reset`) |
| Schema integrity (pgTAP) | CI | ✅ CI (`supabase test db`) |
| Type drift detection | CI | ✅ CI (`diff -u`) |
| Daily automated backup | Supabase platform | ✅ (Pro plan) |
| Manual backup before deploy | Deployment operator | ❌ Manual |
| Restore verification | Deployment operator | ❌ Manual (this document) |
| Secrets management | Deployment operator | ❌ Manual (1Password / Bitwarden) |

## 5. Production Launch Requirements

Before going live, the deployment operator MUST confirm:

1. **Automated daily backups are enabled** in the Supabase project dashboard
   (Pro plan or above).
2. **A manual backup has been taken and successfully restored** to a separate
   target project, with all verification checks passing.
3. **At least one team member** (not the original operator) has executed the
   restore procedure using only this document.
4. **The `postgres` role password** is stored in a shared secrets manager
   (not in email, chat, or plaintext files).
5. **Backup download and retention** policy is configured according to the
   organization's data retention requirements.