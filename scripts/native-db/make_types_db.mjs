#!/usr/bin/env node
/**
 * SUPPLEMENTARY (Layer A) — prepare a clean native PostgreSQL database for
 * `gen_types.mjs` (byte-exact TypeScript type generation).
 *
 * Creates a fresh database, applies the minimal auth replica (setup_auth.sql)
 * and replays the FULL migration chain — but NOT the pgTAP shims, which add
 * `public._pgtap_*` tables/functions that would otherwise pollute the generated
 * types. The authoritative acceptance environment remains the official
 * Supabase stack in CI (Layer B).
 *
 * Usage:
 *   DB_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres node scripts/native-db/make_types_db.mjs
 *   node scripts/native-db/gen_types.mjs postgres://postgres:postgres@127.0.0.1:5433/hospitality_types
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_types";

const admin = new pg.Client({ connectionString: dbUrl });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
await admin.end();

const db = new pg.Client({ connectionString: dbUrl.replace(/\/postgres(\?|$)/, `/${dbName}$1`) });
await db.connect();
await db.query(readFileSync(join(root, "scripts/native-db/setup_auth.sql"), "utf8"));
for (const m of readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.query(readFileSync(join(root, "supabase", "migrations", m), "utf8"));
}
await db.end();
console.log(`created ${dbName} (migrations replayed, no pgTAP shims)`);
