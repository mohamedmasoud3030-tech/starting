#!/usr/bin/env node
/**
 * Database Guardian — unified runner.
 *
 * Usage:
 *   npm run db:guardian                 # static + dynamic against LOCAL scratch PostgreSQL
 *   npm run db:guardian -- --mode static
 *   npm run db:guardian -- --db-url postgresql://…   (LOCAL scratch server only)
 *   npm run db:guardian:snapshot        # safely regenerate expected schema + lock NEW migration hashes
 *   npm run db:guardian -- --fail-on CRITICAL
 *
 * Snapshot safety rule:
 *   - existing migration hashes are immutable and are NEVER overwritten;
 *   - edited/deleted recorded migrations make snapshot mode fail before any
 *     contract file is rewritten;
 *   - applied-baseline.json is NOT advanced automatically. It represents a
 *     separately verified deployed/stable baseline.
 *
 * Exit code is non-zero when any FAIL finding is at or above --fail-on
 * (default: HIGH, per the canonical contract). Report:
 *   guardian/reports/latest/report.json | summary.md | findings.csv
 *   guardian/reports/latest/inventory.md|json · write-paths.md|json
 */
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import {
  Report,
  ROOT,
  CONTRACT_DIR,
  MIGRATIONS_DIR,
  readJson,
  writeJson,
  withScratchDatabase,
  applyNativeBootstrap,
  replayMigrations,
  migrationFiles,
  hashFile,
  currentBranch,
  shortHead,
} from "./lib/common.mjs";
import { writeReport } from "./lib/report.mjs";
import { checksFor } from "./checks/registry.mjs";

const USAGE = `Database Guardian — unified runner

Usage:
  node guardian/run.mjs [options]

Options:
  --mode <static|dynamic|all>   default: all
  --db-url <url>                LOCAL Postgres scratch server only
                                (env DB_URL fallback; default
                                postgres://postgres:postgres@127.0.0.1:54322/postgres)
  --snapshot                    safely regenerate expected-schema.json and add
                                hashes for NEW migrations only; existing hashes
                                are immutable and applied-baseline is untouched
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
      case "--mode":
        cli.mode = val();
        break;
      case "--db-url":
        cli.dbUrl = val();
        break;
      case "--snapshot":
        cli.snapshot = true;
        break;
      case "--fail-on":
        cli.failOn = val().toUpperCase();
        break;
      case "--report-dir":
        cli.reportDir = val();
        break;
      case "--skip":
        for (const s of val().split(",")) cli.skip.add(s.trim());
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        console.error(`unknown option: ${a}\n${USAGE}`);
        process.exit(2);
    }
  }
  if (!["static", "dynamic", "all"].includes(cli.mode)) {
    console.error(`--mode must be static|dynamic|all (got ${cli.mode})`);
    process.exit(2);
  }
  return cli;
}

function snapshotHistoryViolations() {
  const hashesPath = join(CONTRACT_DIR, "migration-hashes.json");
  let baseline;
  try {
    baseline = readJson(hashesPath);
  } catch {
    return [];
  }

  const current = new Set(migrationFiles());
  const violations = [];
  for (const [file, expectedHash] of Object.entries(baseline.files ?? {})) {
    if (!current.has(file)) {
      violations.push(`${file}: recorded migration was deleted`);
      continue;
    }
    const actualHash = hashFile(join(MIGRATIONS_DIR, file));
    if (actualHash !== expectedHash) {
      violations.push(
        `${file}: recorded hash changed (${String(expectedHash).slice(0, 12)} → ${actualHash.slice(0, 12)})`,
      );
    }
  }
  return violations;
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

  if (cli.snapshot) {
    const violations = snapshotHistoryViolations();
    if (violations.length > 0) {
      report.fail(
        { id: "G-SNAPSHOT-SAFETY", title: "Snapshot safety", category: "migrations" },
        {
          severity: "CRITICAL",
          id: "G-SNAPSHOT-SAFETY-IMMUTABLE-HISTORY",
          title: "Snapshot refused: a recorded migration was edited or deleted",
          evidence: violations.join("\n"),
          detail:
            "Revert historical migration changes. Snapshot mode may add hashes for new migrations but never rewrites an existing migration hash.",
        },
      );
    }
  }

  const checks = checksFor(cli.mode).filter(
    (c) => ![...cli.skip].some((s) => c.id.startsWith(s)),
  );
  const ctx = { report, cli, contract, paths: [] };
  let snapshotManifest = null;

  console.log(`\n=== Database Guardian ${runId} ===`);
  console.log(`mode=${cli.mode}  fail-on=${cli.failOn}  db-url=${cli.dbUrl}\n`);

  for (const check of checks.filter((c) => c.mode === "static")) {
    ctx.report.meta.checksRun = (ctx.report.meta.checksRun ?? 0) + 1;
    try {
      await check.run(ctx);
      console.log(`  ✓ static  ${check.id} — ${check.title}`);
    } catch (e) {
      report.fail(check, {
        severity: "CRITICAL",
        id: `${check.id}-RUNNER-ERROR`,
        title: `Check crashed: ${e.message}`,
        evidence: e.stack ?? "",
      });
      console.error(`  ✗ static  ${check.id} crashed: ${e.message}`);
    }
  }

  const dynamic = checks.filter((c) => c.mode === "dynamic");
  if (dynamic.length > 0) {
    console.log(`\n-- dynamic phase (LOCAL scratch replay on ${cli.dbUrl}) --`);
    await withScratchDatabase(cli.dbUrl, "guardian_scratch", async (db) => {
      const bootstrapped = await applyNativeBootstrap(db);
      console.log(
        bootstrapped
          ? "  (native bootstrap applied: auth replica + pgTAP shims)"
          : "  (local Supabase-like server detected — no bootstrap needed)",
      );
      const replay = await replayMigrations(db);
      if (!replay.ok) {
        report.fail(
          { id: "G-REPLAY", title: "Migration replay from scratch", category: "migrations" },
          {
            severity: "CRITICAL",
            id: "G-REPLAY-FAILED",
            title: `Migration ${replay.failedFile} fails on an empty database`,
            evidence: replay.error,
          },
        );
        console.error(`  ✗ replay failed at ${replay.failedFile}: ${replay.error}`);
        return;
      }

      console.log(`  ✓ replay: ${replay.count} migrations from scratch`);
      ctx.db = db;

      for (const check of dynamic) {
        ctx.report.meta.checksRun = (ctx.report.meta.checksRun ?? 0) + 1;
        try {
          await check.run(ctx);
          console.log(`  ✓ dynamic ${check.id} — ${check.title}`);
        } catch (e) {
          report.fail(check, {
            severity: "CRITICAL",
            id: `${check.id}-RUNNER-ERROR`,
            title: `Check crashed: ${e.message}`,
            evidence: e.stack ?? "",
          });
          console.error(`  ✗ dynamic ${check.id} crashed: ${e.message}`);
        }
      }

      if (cli.snapshot) {
        const { extractManifest } = await import("./lib/manifest.mjs");
        snapshotManifest = await extractManifest(db);
      }
    });
  }

  if (cli.snapshot) {
    const blockingBeforeSnapshot = report.failuresAtOrAbove(cli.failOn);
    if (blockingBeforeSnapshot.length > 0 || !snapshotManifest) {
      console.error(
        "\n✗ snapshot files NOT written because Guardian has blocking findings or replay did not complete",
      );
    } else {
      const files = migrationFiles();
      const hashesPath = join(CONTRACT_DIR, "migration-hashes.json");
      let existing = { files: {} };
      try {
        existing = readJson(hashesPath);
      } catch {
        // First bootstrap of the Guardian contract.
      }

      const lockedFiles = { ...(existing.files ?? {}) };
      for (const file of files) {
        if (!(file in lockedFiles)) {
          lockedFiles[file] = hashFile(join(MIGRATIONS_DIR, file));
        }
      }

      writeJson(join(CONTRACT_DIR, "expected-schema.json"), snapshotManifest);
      writeJson(hashesPath, {
        generatedAt: new Date().toISOString(),
        count: Object.keys(lockedFiles).length,
        files: lockedFiles,
      });
      console.log(
        `\n  ✓ snapshot written safely: expected-schema.json + migration-hashes.json (${Object.keys(lockedFiles).length} locked files)`,
      );
      console.log(
        "  - applied-baseline.json intentionally unchanged; advance it only after a separately verified deployment/stable baseline",
      );
    }
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
