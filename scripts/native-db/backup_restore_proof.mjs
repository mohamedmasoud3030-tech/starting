import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbUrl = process.env.DB_URL;
if (!dbUrl) {
  throw new Error("DB_URL is required for the backup/restore proof");
}

const parsed = new URL(dbUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)) {
  throw new Error(
    `Refusing to run destructive backup/restore proof against non-local database host: ${parsed.hostname}`,
  );
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const tempDir = mkdtempSync(join(tmpdir(), "hospitality-restore-proof-"));
const dumpPath = join(tempDir, "public-data.dump");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: process.env,
  });
}

function psql(sql) {
  return run(
    "psql",
    [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql],
    { capture: true },
  ).trim();
}

function resetDatabase() {
  run("supabase", ["db", "reset"]);
}

function fingerprint() {
  return psql(`
    select md5(
      jsonb_build_object(
        'organization', (
          select to_jsonb(o)
          from public.organizations o
          where o.id = '${ORG_ID}'::uuid
        ),
        'customer', (
          select to_jsonb(c)
          from public.customers c
          where c.id = '${CUSTOMER_ID}'::uuid
        )
      )::text
    );
  `);
}

try {
  console.log("[restore-proof] Resetting to a clean migrated database...");
  resetDatabase();

  console.log("[restore-proof] Creating deterministic business fixture...");
  psql(`
    insert into public.organizations (
      id, name, display_name, default_currency, timezone, is_active
    ) values (
      '${ORG_ID}'::uuid,
      'S8 Restore Proof',
      'S8 Restore Proof',
      'OMR',
      'Asia/Muscat',
      true
    );

    insert into public.customers (
      id, organization_id, name, phone, whatsapp, customer_type, notes, is_active
    ) values (
      '${CUSTOMER_ID}'::uuid,
      '${ORG_ID}'::uuid,
      'Restore Proof Customer',
      '91234567',
      '91234567',
      'INDIVIDUAL',
      'Deterministic S8 backup/restore proof fixture',
      true
    );
  `);

  const before = fingerprint();
  if (!before) {
    throw new Error("Could not fingerprint the pre-backup fixture");
  }

  console.log("[restore-proof] Taking a custom-format public-schema data backup...");
  run("pg_dump", [
    "--dbname",
    dbUrl,
    "--schema=public",
    "--data-only",
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    dumpPath,
  ]);

  console.log("[restore-proof] Resetting database to prove the backup is the only data source...");
  resetDatabase();

  const afterReset = psql(`
    select count(*)
    from public.organizations
    where id = '${ORG_ID}'::uuid;
  `);
  if (afterReset !== "0") {
    throw new Error("Fixture survived reset; restore proof would be invalid");
  }

  console.log("[restore-proof] Restoring the backup through pg_restore...");
  run("pg_restore", [
    "--dbname",
    dbUrl,
    "--data-only",
    "--disable-triggers",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    dumpPath,
  ]);

  const after = fingerprint();
  if (before !== after) {
    throw new Error(`Backup/restore fingerprint mismatch: before=${before}, after=${after}`);
  }

  const relationalCheck = psql(`
    select count(*)
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where c.id = '${CUSTOMER_ID}'::uuid
      and o.id = '${ORG_ID}'::uuid
      and o.default_currency = 'OMR'
      and o.timezone = 'Asia/Muscat';
  `);
  if (relationalCheck !== "1") {
    throw new Error("Restored fixture failed referential/invariant verification");
  }

  console.log(`[restore-proof] Fingerprint preserved: ${after}`);
  console.log("[restore-proof] Backup -> reset -> restore -> verify passed.");
} finally {
  console.log("[restore-proof] Returning local database to a clean migrated state...");
  resetDatabase();
  rmSync(tempDir, { recursive: true, force: true });
}
