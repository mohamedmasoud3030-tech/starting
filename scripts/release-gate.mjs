#!/usr/bin/env node
/**
 * PORTABLE RELEASE GATE — CI-independent verification for the whole repo.
 *
 * Runs every release-critical gate locally in one command:
 *
 *   node scripts/release-gate.mjs            # full gate; database REQUIRED
 *   node scripts/release-gate.mjs --skip-db  # explicit frontend/static-only gate
 *
 * Order:
 *   1. typecheck
 *   2. lint
 *   3. frontend tests (vitest)
 *   4. build
 *   5. Database Guardian — static checks (always)
 *   6. Database gates (required unless --skip-db is explicit):
 *        - native migration replay (supabase migrations on a scratch DB)
 *        - official pgTAP suites via the native harness (supabase/tests/*.sql)
 *        - Database Guardian — dynamic checks (drift, ACL, RLS, integrity, …)
 *
 * Exit code: 0 only when every REQUIRED gate passes. A missing database is a
 * failure by default so `npm run gate` can never produce a false green for a
 * database-changing release. `--skip-db` is an explicit operator choice and is
 * recorded as SKIPPED in the machine-readable report.
 *
 * Output: guardian/reports/latest/release-gate.json (machine-readable) +
 * console summary.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "guardian", "reports", "latest");

const skipDb = process.argv.includes("--skip-db");
const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres";

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
    tail: tail.trim().slice(0, 1200),
  };
}

function reachable(url) {
  try {
    execSync(
      `node -e "new (require('pg').Client)({connectionString:process.env.U}).connect().then(c=>{c.end();process.exit(0)}).catch(()=>process.exit(1))"`,
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
  dbUrl,
  dbRequired: !skipDb,
  skipDb,
  steps: [],
};

const steps = [
  ["typecheck", "npm", ["run", "typecheck", "--silent"]],
  ["lint", "npm", ["run", "lint", "--silent"]],
  ["frontend-tests", "npm", ["run", "test", "--silent", "--", "--run"]],
  ["build", "npm", ["run", "build", "--silent"]],
  ["guardian-static", "node", ["guardian/run.mjs", "--mode", "static", "--report-dir", OUT_DIR]],
];

let dbAvailable = false;
if (!skipDb) {
  dbAvailable = reachable(dbUrl);
  report.dbAvailable = dbAvailable;
}

for (const [name, cmd, args] of steps) {
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
    const r = run(name, cmd, args, { env: { ...process.env, DB_URL: dbUrl } });
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
  report.steps.push({ name: "db-gates", status: "SKIPPED", durationMs: 0, tail });
  console.log("  - db-gates SKIPPED (--skip-db was explicitly supplied)");
} else {
  const tail = `no reachable local database at ${dbUrl}; set DB_URL to a local scratch PostgreSQL server or start the local PG harness`;
  const r = { name: "db-gates", ok: false, status: "db-unavailable", durationMs: 0, tail };
  report.steps.push({ name: r.name, status: "FAIL", durationMs: 0, tail });
  results.push(r);
  console.error(`  ✗ db-gates — ${tail}`);
}

const failed = results.filter((r) => !r.ok);
report.finishedAt = new Date().toISOString();
report.status = failed.length === 0 ? "PASS" : "FAIL";
report.failedSteps = failed.map((r) => r.name);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "release-gate.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\n=== Portable Release Gate: ${report.status} ===`);
console.log(
  `steps: ${report.steps.length} (${report.steps.filter((s) => s.status === "PASS").length} PASS, ${report.steps.filter((s) => s.status === "FAIL").length} FAIL, ${report.steps.filter((s) => s.status === "SKIPPED").length} SKIPPED)`,
);
console.log(`report: ${join(OUT_DIR, "release-gate.json")}`);
process.exit(failed.length > 0 ? 1 : 0);
