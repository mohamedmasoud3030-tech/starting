#!/usr/bin/env node
/**
 * SUPPLEMENTARY (Layer A) — native PostgreSQL migration replay + pgTAP harness.
 *
 * DESTRUCTIVE SCRATCH HARNESS: it creates and drops an isolated database, so
 * it is intentionally restricted to localhost / loopback PostgreSQL only.
 * Never pass a Supabase production/direct/pooler URL to this script.
 *
 * Usage:
 *   DB_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres node scripts/native-db/run.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/postgres";

const migrationsDir = join(root, "supabase", "migrations");
const testsDir = join(root, "supabase", "tests");

function assertLocalScratchTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NATIVE_DB_INVALID_DB_URL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `NATIVE_DB_REMOTE_TARGET_FORBIDDEN: scratch replay only accepts localhost/loopback (got ${parsed.hostname})`,
    );
  }
}

function databaseUrl(url, dbName) {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function quoteIdent(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

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

async function dropScratch(name) {
  const cleanup = new pg.Client({ connectionString: dbUrl });
  try {
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${quoteIdent(name)}`);
  } finally {
    await cleanup.end().catch(() => {});
  }
}

async function main() {
  assertLocalScratchTarget(dbUrl);

  const dbName = `hospitality_native_check_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: dbUrl });
  let db;
  let allPassed = true;

  try {
    await admin.connect();
    await admin.query(`create database ${quoteIdent(dbName)}`);
    await admin.end();

    db = new pg.Client({ connectionString: databaseUrl(dbUrl, dbName) });
    await db.connect();
    await db.query("set search_path to public");
    await db.query("set check_function_bodies = on");

    log("\n== Layer A: native PostgreSQL validation ==");

    // 1. auth/storage replicas + pgTAP shims
    log("\n[1/4] setup auth replica + storage replica + pgTAP shims");
    await exec(db, readFileSync(join(__dirname, "setup_auth.sql"), "utf8"), "auth replica");
    await exec(db, readFileSync(join(__dirname, "setup_storage.sql"), "utf8"), "storage replica");
    await exec(db, readFileSync(join(__dirname, "pgtap_shims.sql"), "utf8"), "pgTAP shims");

    // 2. full migration replay
    log("\n[2/4] replay migrations");
    const migrations = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const migration of migrations) {
      await exec(
        db,
        readFileSync(join(migrationsDir, migration), "utf8"),
        migration,
      );
    }

    // 3. repository pgTAP tests through native shims. finish() inside each test
    // raises on assertion failure/plan mismatch. Most files rollback fixtures.
    log("\n[3/4] run pgTAP tests");
    const tests = readdirSync(testsDir)
      .filter((f) => f.endsWith(".test.sql"))
      .sort();

    for (const test of tests) {
      const sql = readFileSync(join(testsDir, test), "utf8");
      try {
        await db.query(sql);
        log(`  ✓ ${test}`);
      } catch (e) {
        allPassed = false;
        log(`  ✗ ${test}: ${e.message}`);
      } finally {
        // Recover an aborted transaction when finish() raises before the test's
        // own trailing ROLLBACK. Safe when already outside a transaction.
        await db.query("rollback");
      }
    }

    log("\n[4/4] native replay complete");
  } finally {
    if (db) await db.end().catch(() => {});
    // Always clean the uniquely named scratch DB, including migration/test
    // failures. No fixed database name is ever dropped.
    await dropScratch(dbName).catch((e) => {
      console.error(`scratch cleanup failed for ${dbName}: ${e.message}`);
      allPassed = false;
    });
  }

  if (!allPassed) {
    log("\nLayer A: FAILED");
    process.exitCode = 1;
    return;
  }
  log("\nLayer A: PASSED (supplementary)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
