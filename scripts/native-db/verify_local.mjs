#!/usr/bin/env node
/**
 * LOCAL verifier — boots an embedded real PostgreSQL, then:
 *   1. replays the full migration chain + runs official pgTAP (Layer A);
 *   2. regenerates `src/lib/database.types.ts` from the replayed schema and
 *      reports any byte-level drift (the authoritative check is CI's
 *      `supabase gen types`).
 *
 * Mirrors the Supabase CI "database" job so migrations/types can be validated
 * in a sandbox without Docker. The AUTHORITATIVE acceptance environment remains
 * the official Supabase stack in CI (Layer B).
 *
 * Usage:
 *   node scripts/native-db/verify_local.mjs [--fix-types]
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dataDir = join(root, ".epgdata");
const port = 5433;
const fixTypes = process.argv.includes("--fix-types");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
});

let status = 0;
try {
  console.log("== [0/4] boot embedded PostgreSQL ==");
  rmSync(dataDir, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  const dbUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  console.log(`  → ${dbUrl}`);

  console.log("== [1/4] prepare types DB (migrations, no pgTAP shims) ==");
  let r = spawnSync(process.execPath, [join(__dirname, "make_types_db.mjs")], {
    env: { ...process.env, DB_URL: dbUrl },
    stdio: "inherit",
  });
  if (r.status !== 0) { status = 1; throw new Error("make_types_db failed"); }

  console.log("== [2/4] regenerate database.types.ts ==");
  const gen = spawnSync(
    process.execPath,
    [join(__dirname, "gen_types.mjs"), `postgres://postgres:postgres@127.0.0.1:${port}/hospitality_types`],
    { encoding: "utf8" },
  );
  if (gen.status !== 0) { status = 1; throw new Error("gen_types failed"); }
  const generated = gen.stdout;
  const committedPath = join(root, "src/lib/database.types.ts");
  const committed = readFileSync(committedPath, "utf8");
  if (generated === committed) {
    console.log("  database.types.ts: MATCH (no drift)");
  } else {
    console.log("  database.types.ts: DRIFT detected");
    if (fixTypes) {
      writeFileSync(committedPath, generated);
      console.log("  → fixed src/lib/database.types.ts");
      status = 1; // force full rerun of Layer A below to confirm clean
    } else {
      status = 1;
      const a = generated.split("\n"); const b = committed.split("\n");
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log(`  first diff at line ${i + 1}:`);
      console.log("    gen :", a.slice(i, i + 2).join("\n"));
      console.log("    comm:", b.slice(i, i + 2).join("\n"));
    }
  }

  console.log("== [3/4] Layer A: migration replay + pgTAP ==");
  r = spawnSync(process.execPath, [join(__dirname, "run.mjs")], {
    env: { ...process.env, DB_URL: dbUrl },
    stdio: "inherit",
  });
  if (r.status !== 0) { status = 1; throw new Error("Layer A failed"); }

  console.log("== [4/4] done ==");
} catch (e) {
  console.error("\nFATAL:", e.message);
  status = 1;
} finally {
  try { await pg.stop(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(status);
