# Database Backup and Restore

> **Last updated:** 2026-08-16 | **S8 Production Hardening**

This runbook defines the backup/restore contract for the Hospitality Operations
PostgreSQL/Supabase database. Source control is not a data backup: migrations
reconstruct schema and behavior, not production rows.

## 1. Backup scope

| Data | Method | Repository proof |
| --- | --- | --- |
| `public` business data | `pg_dump` / managed Supabase backup | Automated local dump/restore proof |
| Supabase Auth | Managed backup or explicit `auth` schema backup | Schema dependencies replayed; live auth data requires production backup |
| Storage objects | Not currently used by the product | N/A |
| Source code/migrations | Git | CI replay from clean database |
| Production secrets | External secrets manager | Never committed |

## 2. Automated S8 restore proof

CI runs a real data round-trip after pgTAP and concurrency checks:

```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run db:backup-restore-proof
```

`scripts/native-db/backup_restore_proof.mjs`:

1. refuses to run unless the database host is `127.0.0.1` or `localhost`;
2. replays the full migrated schema;
3. inserts a deterministic organization/customer fixture;
4. fingerprints the fixture;
5. creates a custom-format public-schema data dump with `pg_dump`;
6. resets the database and proves the fixture disappeared;
7. restores with normal `pg_restore` privileges;
8. verifies the exact fingerprint and relational/Oman/OMR invariants;
9. resets the local database again in `finally`.

The proof intentionally does **not** pass `--disable-triggers`. Supabase's
`postgres` role is not a true PostgreSQL superuser and cannot disable system
referential-integrity triggers. A CI proof that requires superuser-only behavior
would not represent the target platform correctly.

This proves the repository's deterministic business fixture and current
public-schema archive survive a real backup/restore round trip. It does **not**
prove that a live project's managed backup schedule, retention, or every possible
production data graph has been restored. Those remain live launch gates.

## 3. Production backup

### 3.1 Managed backup

For the selected production Supabase project, enable a plan/backup configuration
that satisfies the business retention requirement. Verify the schedule and
retention in the Supabase dashboard before launch. Do not infer this from CI.

### 3.2 Manual pre-deploy backup

Use the production database connection from the operator's secrets manager:

```bash
pg_dump \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=hospitality-$(date +%Y-%m-%d).dump
```

For a public-schema data-only diagnostic/recovery artifact:

```bash
pg_dump \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --schema=public \
  --data-only \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=hospitality-public-data-$(date +%Y-%m-%d).dump
```

A data-only dump may warn about circular foreign keys such as relationships
between event and quotation records. That warning must not be ignored for a real
production recovery plan. For full disaster recovery, prefer the Supabase-managed
backup/recovery path or a full native backup that has been proven on an isolated
target with the same privilege model.

Never put the database password, service-role key, or production connection
string in Git, chat, a `VITE_*` variable, or a browser-accessible file.

## 4. Restore into a separate target

A production disaster-recovery drill must use a separate target project/database,
not the live source.

### Step 1 — choose the recovery mechanism

Use the same mechanism intended for production recovery:

- **Managed Supabase backup/recovery:** preferred for full project/database
  recovery, especially when managed schemas such as `auth` are involved.
- **Native full dump:** acceptable only after it has been tested on an isolated
  target with the same PostgreSQL/Supabase privilege constraints.
- **Public-schema data-only dump:** useful for controlled recovery cases, but must
  not be assumed to handle arbitrary circular data graphs without a proven plan.

Do not design a runbook around `pg_restore --disable-triggers` against Supabase's
normal `postgres` role. It can fail when PostgreSQL attempts to disable system FK
triggers because that operation requires true superuser privileges.

### Step 2 — establish the target schema when using data-only recovery

Replay the exact migration set on the isolated target and run the database test
suite. A schema mismatch is a stop condition.

### Step 3 — restore using the proven command for that artifact

For a data-only archive that has already been validated as dependency-safe on the
same target shape:

```bash
pg_restore \
  --host=<TARGET_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --data-only \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  hospitality-public-data-<date>.dump
```

If this fails because real production rows form circular FK dependencies, stop.
Do not weaken constraints or improvise on the live database. Use the managed/full
recovery procedure that was proven on the isolated target.

If the recovery artifact contains managed schemas such as `auth`, follow the
Supabase recovery procedure for that backup type rather than treating it as a
public-schema-only dump.

### Step 4 — verify restored data

At minimum verify object counts, business relationships, financial/stock
invariants, auth access, and tenant isolation. Example checks:

```sql
select 'organizations', count(*) from public.organizations
union all
select 'customers', count(*) from public.customers
union all
select 'events', count(*) from public.events
union all
select 'quotations', count(*) from public.quotations
union all
select 'procurement_orders', count(*) from public.procurement_orders
union all
select 'customer_payments', count(*) from public.customer_payments;
```

Then run the applicable integrity queries and the normal application smoke/UAT
against the restored target. Do not approve a restore from row counts alone.

## 5. Local drill

The supported repository-level drill is automated; prefer it over manual local
steps:

```bash
supabase start
npm run db:backup-restore-proof
supabase stop
```

The script intentionally destroys and recreates the **local** database. Its
localhost guard is a safety boundary and must not be removed to make a remote
command convenient.

## 6. Responsibilities

| Task | Automated? | Owner |
| --- | --- | --- |
| Clean migration replay | Yes | CI |
| pgTAP/RLS evidence | Yes | CI |
| Concurrency proofs | Yes | CI |
| Local data dump/restore round-trip | Yes | CI |
| Generated-type drift | Yes | CI |
| Managed production backup schedule | No | Production operator/platform |
| Real staging/production restore drill | No | Production operator |
| Backup retention approval | No | Business/production owner |
| Secrets custody | No | Production operator |

## 7. Live launch gates

Before production launch, confirm all of the following with evidence:

- [ ] Dedicated Hospitality Supabase project selected.
- [ ] Managed backup schedule and retention enabled/verified.
- [ ] Manual pre-launch backup taken.
- [ ] The chosen production recovery mechanism is restored to a **separate** target successfully.
- [ ] Restored target passes data-integrity, auth, tenant-isolation, and app smoke checks.
- [ ] Database password and privileged keys are held in a secrets manager.
- [ ] A named operator understands and can execute the restore procedure.

Repository CI being green is necessary but is not evidence that these live
infrastructure gates have been completed.
