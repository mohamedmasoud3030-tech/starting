#!/usr/bin/env node
/**
 * SUPPLEMENTARY (Layer A) — native PostgreSQL migration replay + pgTAP harness.
 *
 * Runs the full migration chain against a plain native PostgreSQL server,
 * then executes the OFFICIAL supabase/tests/*.sql pgTAP files through the
 * minimal pgTAP shims (pgtap_shims.sql), using a replica auth schema
 * (setup_auth.sql).
 *
 * This is for early defect detection only. The AUTHORITATIVE acceptance
 * environment is the official Supabase stack in GitHub Actions (Layer B):
 * `supabase db reset` + `supabase test db`.
 *
 * Usage:
 *   DB_URL=postgres://postgres@127.0.0.1:5433/postgres node scripts/native-db/run.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";

const migrationsDir = join(root, "supabase", "migrations");
const testsDir = join(root, "supabase", "tests");

const admin = new pg.Client({ connectionString: dbUrl });

function log(...a) {
  console.log(...a);
}

async function exec(client, sql, label) {
  try {
    await client.query(sql);
    log(`  ✓ ${label}`);
  } catch (e) {
    log(`  ✗ ${label}: ${e.message}`);
    throw e;
  }
}

async function main() {
  await admin.connect();

  // Fresh database per run → true "replay from clean state".
  const dbName = "hospitality_native_check";
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const db = new pg.Client({
    connectionString: dbUrl.replace(/\/postgres(\?|$)/, `/${dbName}$1`),
  });
  await db.connect();
  await db.query("set search_path to public");
  await db.query("set check_function_bodies = on");

  log("\n== Layer A: native PostgreSQL validation ==");

  // 1. auth replica + pgTAP shims
  log("\n[1/4] setup auth replica + pgTAP shims");
  await exec(db, readFileSync(join(__dirname, "setup_auth.sql"), "utf8"), "auth replica");
  await exec(db, readFileSync(join(__dirname, "pgtap_shims.sql"), "utf8"), "pgTAP shims");

  // 2. migrations (replay)
  log("\n[2/4] replay migrations");
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await exec(db, readFileSync(join(migrationsDir, m), "utf8"), m);
  }

  // 3. run official pgTAP tests through the shims
  log("\n[3/4] run official pgTAP tests");
  const tests = readdirSync(testsDir).filter((f) => f.endsWith(".sql")).sort();
  let allPassed = true;
  for (const t of tests) {
    const sql = readFileSync(join(testsDir, t), "utf8");
    try {
      await db.query(sql);
      log(`  ✓ ${t}`);
    } catch (e) {
      allPassed = false;
      log(`  ✗ ${t}: ${e.message}`);
      const res = await db.query(
        "select description from public._pgtap_results where ok = false order by id",
      );
      for (const row of res.rows) log(`      FAIL: ${row.description}`);
    } finally {
      await db.query("rollback");
    }
  }

  await db.end();

  if (!allPassed) {
    log("\nLayer A: FAILED");
    process.exit(1);
  }
  log("\nLayer A: PASSED (supplementary)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
