#!/usr/bin/env node
/**
 * Database Guardian — unified runner.
 *
 * Usage:
 *   npm run db:guardian                 # static + dynamic against LOCAL scratch PostgreSQL
 *   npm run db:guardian -- --mode static
 *   npm run db:guardian -- --db-url postgresql://…   # LOCAL only
 *   npm run db:guardian:snapshot        # safe expected-schema + NEW hash snapshot
 *   npm run db:guardian -- --fail-on CRITICAL
 *
 * Snapshot safety:
 *   - recorded migration hashes are immutable and never overwritten;
 *   - edited/deleted recorded migrations block snapshot writing;
 *   - expected-schema is written only after a clean replay and ZERO failed
 *     Guardian findings;
 *   - applied-baseline.json is never advanced automatically.
 */
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import {
  Report,
  ROOT,
  CONTRACT_DIR,
  MIGRATIONS_DIR,
  SEVERITY_RANK,
  readJson,
  writeJson,
  withScratchDatabase,
  applyNativeBootstrap,
  replayMigrations,
  migrationFiles,
  hashFile,
  currentBranch,
  shortHead,
  redactDatabaseUrl,
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
                                postgresql://postgres:postgres@127.0.0.1:54322/postgres)
  --snapshot                    safely regenerate expected-schema.json and add
                                hashes for NEW migrations only; existing hashes
                                are immutable and applied-baseline is untouched
  --fail-on <severity>          CRITICAL|HIGH|MEDIUM|LOW|INFO (default: HIGH)
  --report-dir <path>           default: guardian/reports/latest
  --skip <checkId,...>          skip specific checks by id prefix
  --help`;

function parseArgs(argv) {
  const cli = {
    mode: "all",
    dbUrl:
      process.env.DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    snapshot: false,
    failOn: "HIGH",
    reportDir: join(ROOT, "guardian", "reports", "latest"),
    skip: new Set(),
  };

  const requireValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--mode":
        cli.mode = requireValue(i, a);
        i++;
        break;
      case "--db-url":
        cli.dbUrl = requireValue(i, a);
        i++;
        break;
      case "--snapshot":
        cli.snapshot = true;
        break;
      case "--fail-on":
        cli.failOn = requireValue(i, a).toUpperCase();
        i++;
        break;
      case "--report-dir":
        cli.reportDir = requireValue(i, a);
        i++;
        break;
      case "--skip":
        for (const s of requireValue(i, a).split(",")) {
          if (s.trim()) cli.skip.add(s.trim());
        }
        i++;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }

  if (!["static", "dynamic", "all"].includes(cli.mode)) {
    throw new Error(`--mode must be static|dynamic|all (got ${cli.mode})`);
  }
  if (!(cli.failOn in SEVERITY_RANK)) {
    throw new Error(
      `--fail-on must be CRITICAL|HIGH|MEDIUM|LOW|INFO (got ${cli.failOn})`,
    );
  }
  if (cli.snapshot && cli.mode === "static") {
    throw new Error("--snapshot requires --mode dynamic or all; static mode cannot build a schema snapshot");
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
  let cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }

  const safeDbTarget = redactDatabaseUrl(cli.dbUrl);
  const t0 = performance.now();
  const runId = `guardian-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const report = new Report({
    runId,
    startedAt: new Date().toISOString(),
    cli,
  });
  report.meta.branch = currentBranch();
  report.meta.head = shortHead();

  let contract;
  try {
    contract = readJson(join(CONTRACT_DIR, "canonical-contract.json"));
  } catch {
    console.error("✗ guardian/contract/canonical-contract.json missing or invalid");
    process.exit(2);
  }

  if (cli.snapshot) {
    const violations = snapshotHistoryViolations();
    if (violations.length > 0) {
      report.fail(
        {
          id: "G-SNAPSHOT-SAFETY",
          title: "Snapshot safety",
          category: "migrations",
        },
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
  console.log(
    `mode=${cli.mode}  fail-on=${cli.failOn}  db-target=${safeDbTarget}\n`,
  );

  for (const check of checks.filter((c) => c.mode === "static")) {
    report.meta.checksRun = (report.meta.checksRun ?? 0) + 1;
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
    console.log(`\n-- dynamic phase (LOCAL scratch replay on ${safeDbTarget}) --`);
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
          {
            id: "G-REPLAY",
            title: "Migration replay from scratch",
            category: "migrations",
          },
          {
            severity: "CRITICAL",
            id: "G-REPLAY-FAILED",
            title: `Migration ${replay.failedFile} fails on an empty database`,
            evidence: replay.error,
          },
        );
        console.error(
          `  ✗ replay failed at ${replay.failedFile}: ${replay.error}`,
        );
        return;
      }

      console.log(`  ✓ replay: ${replay.count} migrations from scratch`);
      ctx.db = db;

      for (const check of dynamic) {
        report.meta.checksRun = (report.meta.checksRun ?? 0) + 1;
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
    // Snapshot is stricter than the normal release threshold: any failed
    // finding means the contract must not be rewritten around that defect.
    if (report.failed.length > 0 || !snapshotManifest) {
      report.fail(
        {
          id: "G-SNAPSHOT-SAFETY",
          title: "Snapshot safety",
          category: "migrations",
        },
        {
          severity: "HIGH",
          id: "G-SNAPSHOT-SAFETY-NOT-WRITTEN",
          title: "Snapshot files were not written",
          evidence: `${report.failed.length} failed finding(s); manifestReady=${Boolean(snapshotManifest)}`,
          detail:
            "Fix every failed Guardian finding and complete a clean dynamic replay before updating expected-schema.json.",
        },
      );
      console.error(
        "\n✗ snapshot files NOT written because Guardian has failed findings or replay did not complete",
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
        "  - applied-baseline.json intentionally unchanged; advance only after separately verified deployment/stability",
      );
    }
  }

  const durationMs = performance.now() - t0;
  writeReport(cli.reportDir, report, {
    durationMs,
    dbTarget: safeDbTarget,
    modes: [cli.mode],
  });

  const failed = report.failed;
  const blocking = report.failuresAtOrAbove(cli.failOn);
  console.log("\n=== Guardian summary ===");
  console.log(
    `findings: ${report.findings.length} (PASS ${report.passed.length} / FAIL ${failed.length})`,
  );
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    const n = failed.filter((f) => f.severity === sev).length;
    if (n > 0) console.log(`  ${sev}: ${n}`);
  }
  console.log(
    `worst: ${report.worstSeverity()} · blocking (>= ${cli.failOn}): ${blocking.length}`,
  );
  console.log(`report: ${cli.reportDir}/report.json`);
  for (const f of failed) {
    console.log(`  [${f.severity}] ${f.id} — ${f.title}`);
  }

  if (blocking.length > 0) {
    console.error(
      `\n✗ Guardian FAILED (${blocking.length} finding(s) at or above ${cli.failOn})`,
    );
    process.exit(1);
  }
  console.log(`\n✓ Guardian PASSED (no findings at or above ${cli.failOn})`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
