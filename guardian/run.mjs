#!/usr/bin/env node
/**
 * Database Guardian — unified runner.
 *
 * Usage:
 *   npm run db:guardian                 # static + dynamic against DB_URL (or local default)
 *   npm run db:guardian -- --mode static
 *   npm run db:guardian -- --db-url postgresql://…   (e.g., live Supabase)
 *   npm run db:guardian:snapshot        # regenerate contract snapshots from a clean replay
 *   npm run db:guardian -- --fail-on CRITICAL
 *
 * Exit code is non-zero when any FAIL finding is at or above --fail-on
 * (default: HIGH, per the canonical contract). Report:
 *   guardian/reports/latest/report.json | summary.md | findings.csv
 *   guardian/reports/latest/inventory.md|json · write-paths.md|json
 */
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import {
  Report, ROOT, CONTRACT_DIR, MIGRATIONS_DIR, readJson, writeJson,
  withScratchDatabase, applyNativeBootstrap, replayMigrations,
  migrationFiles, hashFile, currentBranch, shortHead,
} from "./lib/common.mjs";
import { writeReport } from "./lib/report.mjs";
import { checksFor } from "./checks/registry.mjs";

const USAGE = `Database Guardian — unified runner

Usage:
  node guardian/run.mjs [options]

Options:
  --mode <static|dynamic|all>   default: all
  --db-url <url>                Postgres connection (env DB_URL fallback;
                                default postgres://postgres:postgres@127.0.0.1:54322/postgres)
  --snapshot                    regenerate contract snapshots (expected-schema.json,
                                migration-hashes.json, applied-baseline.json) from a clean replay
  --fail-on <severity>          exit non-zero on failures >= severity (default: HIGH)
  --report-dir <path>           default: guardian/reports/latest
  --skip <checkId,...>          skip specific checks by id prefix
  --help`;

function parseArgs(argv) {
  const cli = {
    mode: "all",
    dbUrl: process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    snapshot: false,
    failOn: "HIGH",
    reportDir: join(ROOT, "guardian", "reports", "latest"),
    skip: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case "--mode": cli.mode = val(); break;
      case "--db-url": cli.dbUrl = val(); break;
      case "--snapshot": cli.snapshot = true; break;
      case "--fail-on": cli.failOn = val().toUpperCase(); break;
      case "--report-dir": cli.reportDir = val(); break;
      case "--skip": for (const s of val().split(",")) cli.skip.add(s.trim()); break;
      case "--help":
      case "-h": console.log(USAGE); process.exit(0);
      default: console.error(`unknown option: ${a}\n${USAGE}`); process.exit(2);
    }
  }
  if (!["static", "dynamic", "all"].includes(cli.mode)) {
    console.error(`--mode must be static|dynamic|all (got ${cli.mode})`);
    process.exit(2);
  }
  return cli;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const runId = `guardian-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const report = new Report({ runId, startedAt: new Date().toISOString(), cli });
  report.meta.branch = currentBranch();
  report.meta.head = shortHead();

  let contract = {};
  try {
    contract = readJson(join(CONTRACT_DIR, "canonical-contract.json"));
  } catch {
    console.error("✗ guardian/contract/canonical-contract.json missing");
    process.exit(2);
  }

  const checks = checksFor(cli.mode).filter((c) => ![...cli.skip].some((s) => c.id.startsWith(s)));
  const ctx = { report, cli, contract, paths: [] };

  console.log(`\n=== Database Guardian ${runId} ===`);
  console.log(`mode=${cli.mode}  fail-on=${cli.failOn}  db-url=${cli.dbUrl}\n`);

  for (const check of checks.filter((c) => c.mode === "static")) {
    ctx.report.meta.checksRun = (ctx.report.meta.checksRun ?? 0) + 1;
    try {
      await check.run(ctx);
      console.log(`  ✓ static  ${check.id} — ${check.title}`);
    } catch (e) {
      report.fail(check, { severity: "CRITICAL", id: `${check.id}-RUNNER-ERROR`, title: `Check crashed: ${e.message}`, evidence: e.stack ?? "" });
      console.error(`  ✗ static  ${check.id} crashed: ${e.message}`);
    }
  }

  const dynamic = checks.filter((c) => c.mode === "dynamic");
  if (dynamic.length > 0) {
    console.log(`\n-- dynamic phase (replaying migrations on ${cli.dbUrl}) --`);
    await withScratchDatabase(cli.dbUrl, "guardian_scratch", async (db) => {
      const bootstrapped = await applyNativeBootstrap(db);
      console.log(bootstrapped ? "  (native bootstrap applied: auth replica + pgTAP shims)" : "  (Supabase-like server detected — no bootstrap needed)");
      const replay = await replayMigrations(db);
      if (!replay.ok) {
        report.fail({ id: "G-REPLAY", title: "Migration replay from scratch", category: "migrations" }, {
          severity: "CRITICAL",
          id: "G-REPLAY-FAILED",
          title: `Migration ${replay.failedFile} fails on an empty database`,
          evidence: replay.error,
        });
        console.error(`  ✗ replay failed at ${replay.failedFile}: ${replay.error}`);
      } else {
        console.log(`  ✓ replay: ${replay.count} migrations from scratch`);
      }
      ctx.db = db;

      for (const check of dynamic) {
        ctx.report.meta.checksRun = (ctx.report.meta.checksRun ?? 0) + 1;
        try {
          await check.run(ctx);
          console.log(`  ✓ dynamic ${check.id} — ${check.title}`);
        } catch (e) {
          report.fail(check, { severity: "CRITICAL", id: `${check.id}-RUNNER-ERROR`, title: `Check crashed: ${e.message}`, evidence: e.stack ?? "" });
          console.error(`  ✗ dynamic ${check.id} crashed: ${e.message}`);
        }
      }

      if (cli.snapshot) {
        // Regenerate the canonical expected-schema.json from this clean replay.
        const { extractManifest } = await import("./lib/manifest.mjs");
        const full = await extractManifest(db);
        writeJson(join(CONTRACT_DIR, "expected-schema.json"), full);
        console.log("  ✓ expected-schema.json regenerated from clean replay");
      }
    });
  }

  if (cli.snapshot) {
    // Contract snapshots are written from the clean replay (done inside
    // schema-drift when cli.snapshot is set). Hashes + baseline here:
    const files = migrationFiles();
    const hashes = { generatedAt: new Date().toISOString(), count: files.length, files: {} };
    for (const f of files) hashes.files[f] = hashFile(join(MIGRATIONS_DIR, f));
    writeJson(join(CONTRACT_DIR, "migration-hashes.json"), hashes);
    writeJson(join(CONTRACT_DIR, "applied-baseline.json"), { generatedAt: new Date().toISOString(), files });
    console.log(`\n  ✓ snapshot written: expected-schema.json + migration-hashes.json (${files.length} files) + applied-baseline.json`);
  }

  const durationMs = performance.now() - t0;
  writeReport(cli.reportDir, report, {
    durationMs,
    dbTarget: cli.dbUrl,
    modes: [cli.mode],
  });

  const failed = report.failed;
  const blocking = report.failuresAtOrAbove(cli.failOn);
  console.log(`\n=== Guardian summary ===`);
  console.log(`findings: ${report.findings.length} (PASS ${report.passed.length} / FAIL ${failed.length})`);
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    const n = failed.filter((f) => f.severity === sev).length;
    if (n > 0) console.log(`  ${sev}: ${n}`);
  }
  console.log(`worst: ${report.worstSeverity()} · blocking (>= ${cli.failOn}): ${blocking.length}`);
  console.log(`report: ${cli.reportDir}/report.json`);
  for (const f of failed) console.log(`  [${f.severity}] ${f.id} — ${f.title}`);

  if (blocking.length > 0) {
    console.error(`\n✗ Guardian FAILED (${blocking.length} finding(s) at or above ${cli.failOn})`);
    process.exit(1);
  }
  console.log(`\n✓ Guardian PASSED (no findings at or above ${cli.failOn})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
