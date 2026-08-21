#!/usr/bin/env node
/**
 * PORTABLE RELEASE GATE — CI-independent verification for the whole repo.
 *
 *   node scripts/release-gate.mjs            # full gate; LOCAL DB REQUIRED
 *   node scripts/release-gate.mjs --skip-db  # explicit frontend/static-only gate
 *
 * Full order:
 *   1. typecheck
 *   2. lint
 *   3. frontend tests
 *   4. build
 *   5. Guardian static
 *   6. native migration replay + pgTAP on isolated local scratch DB
 *   7. Guardian dynamic on isolated local scratch DBs
 *
 * A missing or unsafe DB target fails the full gate. Remote DB URLs are rejected
 * BEFORE any connection attempt. Credentials are never written to reports.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalScratchDatabaseUrl,
  redactDatabaseUrl,
} from "../guardian/lib/common.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "guardian", "reports", "latest");

const allowedArgs = new Set(["--skip-db"]);
const unknownArgs = process.argv.slice(2).filter((arg) => !allowedArgs.has(arg));
if (unknownArgs.length > 0) {
  console.error(`unknown release-gate argument(s): ${unknownArgs.join(", ")}`);
  process.exit(2);
}

const skipDb = process.argv.includes("--skip-db");
const dbUrl =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const safeDbTarget = redactDatabaseUrl(dbUrl);

function sanitizeText(value) {
  return String(value ?? "").split(dbUrl).join(safeDbTarget);
}

function run(name, cmd, args, { cwd = ROOT, okOnExit = [0], env = {} } = {}) {
  const t0 = Date.now();
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const ok = okOnExit.includes(res.status ?? -1);
  const tail =
    (res.stdout || "").split("\n").slice(-8).join("\n") +
    "\n" +
    (res.stderr || "").split("\n").slice(-8).join("\n");
  return {
    name,
    ok,
    status: res.status ?? "spawn-error",
    durationMs: Date.now() - t0,
    tail: sanitizeText(tail.trim()).slice(0, 1200),
  };
}

function reachable(url) {
  try {
    execSync(
      `node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.U});c.connect().then(async()=>{await c.end();process.exit(0)}).catch(()=>process.exit(1))"`,
      {
        env: { ...process.env, U: url },
        cwd: ROOT,
        timeout: 8000,
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

const results = [];
const report = {
  startedAt: new Date().toISOString(),
  dbTarget: safeDbTarget,
  dbRequired: !skipDb,
  skipDb,
  steps: [],
};

const frontendAndStaticSteps = [
  ["typecheck", "npm", ["run", "typecheck", "--silent"]],
  ["lint", "npm", ["run", "lint", "--silent"]],
  ["frontend-tests", "npm", ["run", "test", "--silent", "--", "--run"]],
  ["build", "npm", ["run", "build", "--silent"]],
  [
    "guardian-static",
    "node",
    ["guardian/run.mjs", "--mode", "static", "--report-dir", OUT_DIR],
  ],
];

let dbAvailable = false;
let dbSafetyError = null;
if (!skipDb) {
  try {
    // Safety check BEFORE reachable() so a remote DB is never contacted.
    assertLocalScratchDatabaseUrl(dbUrl);
    dbAvailable = reachable(dbUrl);
  } catch (e) {
    dbSafetyError = e.message;
  }
  report.dbAvailable = dbAvailable;
  report.dbSafetyError = dbSafetyError;
}

for (const [name, cmd, args] of frontendAndStaticSteps) {
  const r = run(name, cmd, args);
  report.steps.push({
    name,
    status: r.ok ? "PASS" : "FAIL",
    durationMs: r.durationMs,
    tail: r.tail,
  });
  results.push(r);
  console.log(
    `  ${r.ok ? "✓" : "✗"} ${name} (${r.durationMs}ms)${r.ok ? "" : "\n" + r.tail}`,
  );
}

if (dbAvailable) {
  for (const [name, cmd, args] of [
    ["db-replay+pgtap (native harness)", "node", ["scripts/native-db/run.mjs"]],
    ["guardian-dynamic", "node", ["guardian/run.mjs", "--report-dir", OUT_DIR]],
  ]) {
    const r = run(name, cmd, args, { env: { DB_URL: dbUrl } });
    report.steps.push({
      name,
      status: r.ok ? "PASS" : "FAIL",
      durationMs: r.durationMs,
      tail: r.tail,
    });
    results.push(r);
    console.log(
      `  ${r.ok ? "✓" : "✗"} ${name} (${r.durationMs}ms)${r.ok ? "" : "\n" + r.tail}`,
    );
  }
} else if (skipDb) {
  const tail = "database gates explicitly skipped with --skip-db";
  report.steps.push({
    name: "db-gates",
    status: "SKIPPED",
    durationMs: 0,
    tail,
  });
  console.log("  - db-gates SKIPPED (--skip-db was explicitly supplied)");
} else {
  const tail = dbSafetyError
    ? `unsafe database target rejected before connection: ${dbSafetyError}`
    : `no reachable local PostgreSQL server at ${safeDbTarget}`;
  const r = {
    name: "db-gates",
    ok: false,
    status: dbSafetyError ? "unsafe-db-target" : "db-unavailable",
    durationMs: 0,
    tail,
  };
  report.steps.push({
    name: r.name,
    status: "FAIL",
    durationMs: 0,
    tail,
  });
  results.push(r);
  console.error(`  ✗ db-gates — ${tail}`);
}

const failed = results.filter((r) => !r.ok);
report.finishedAt = new Date().toISOString();
report.status = failed.length === 0 ? "PASS" : "FAIL";
report.failedSteps = failed.map((r) => r.name);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, "release-gate.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(`\n=== Portable Release Gate: ${report.status} ===`);
console.log(
  `steps: ${report.steps.length} (${report.steps.filter((s) => s.status === "PASS").length} PASS, ${report.steps.filter((s) => s.status === "FAIL").length} FAIL, ${report.steps.filter((s) => s.status === "SKIPPED").length} SKIPPED)`,
);
console.log(`report: ${join(OUT_DIR, "release-gate.json")}`);
process.exit(failed.length > 0 ? 1 : 0);
