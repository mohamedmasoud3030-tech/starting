#!/usr/bin/env node
/**
 * Migration Guardian — proves both replay modes:
 *
 *   1. From scratch: already proven by the shared dynamic replay before this
 *      check is invoked.
 *   2. Incremental: applied-baseline.json must be an exact ordered PREFIX of
 *      the current migration chain; that baseline is replayed first, then only
 *      the newer suffix is applied.
 *
 * applied-baseline.json is advanced separately after a verified deployment /
 * stable baseline. db:guardian:snapshot intentionally does not modify it.
 */
import { join } from "node:path";
import {
  readJson,
  CONTRACT_DIR,
  migrationFiles,
  replayMigrationSubset,
  withScratchDatabase,
  applyNativeBootstrap,
} from "../../lib/common.mjs";

export const id = "G-MIGRATION-GUARDIAN";
export const title = "Migrations replay from scratch and on the verified applied baseline";
export const category = "migrations";
export const defaultSeverity = "CRITICAL";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, cli } = ctx;
  const files = migrationFiles();
  const baselinePath = join(CONTRACT_DIR, "applied-baseline.json");

  let baseline;
  try {
    baseline = readJson(baselinePath);
  } catch {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-BASELINE-MISSING`,
      title: "applied-baseline.json is missing; incremental migration replay cannot be proven",
      evidence: baselinePath,
      detail:
        "Record a separately verified stable/applied migration prefix. Do not use db:guardian:snapshot to auto-advance it.",
    });
    return;
  }

  const baselineFiles = baseline.files ?? [];
  if (baselineFiles.length === 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-BASELINE-EMPTY`,
      title: "Applied migration baseline is empty",
      evidence: baselinePath,
      detail:
        "Incremental safety requires a known stable migration prefix. Advance it only after independent deployment/stability verification.",
    });
    return;
  }

  // 1. From scratch — the runner reaches this check only after the shared replay
  // completed successfully.
  report.pass(
    this,
    `${id}-SCRATCH`,
    "Full chain replays from an empty scratch database",
    `${files.length} migrations`,
  );

  // 2. Baseline must be an exact ordered prefix. Filtering missing filenames or
  // tolerating reordering would make the incremental proof unlike production.
  const prefix = files.slice(0, baselineFiles.length);
  const prefixMatches =
    prefix.length === baselineFiles.length &&
    prefix.every((file, index) => file === baselineFiles[index]);

  if (!prefixMatches) {
    const firstMismatch = Math.max(
      0,
      baselineFiles.findIndex((file, index) => prefix[index] !== file),
    );
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-BASELINE-NOT-PREFIX`,
      title: "Applied baseline is not an exact prefix of the current migration chain",
      evidence: [
        `baseline[${firstMismatch}]=${baselineFiles[firstMismatch] ?? "<none>"}`,
        `current[${firstMismatch}]=${prefix[firstMismatch] ?? "<none>"}`,
        `baselineCount=${baselineFiles.length}`,
        `currentCount=${files.length}`,
      ].join("\n"),
      detail:
        "A historical migration was inserted, removed, renamed, or reordered relative to the verified baseline. Revert history and add a new migration at the end.",
    });
    return;
  }

  const news = files.slice(baselineFiles.length);

  await withScratchDatabase(cli.dbUrl, "guardian_incremental", async (db) => {
    await applyNativeBootstrap(db);

    const base = await replayMigrationSubset(db, baselineFiles);
    if (!base.ok) {
      report.fail(this, {
        severity: "CRITICAL",
        id: `${id}-BASELINE-FAIL`,
        title: "Verified baseline migrations no longer replay",
        evidence: `${base.failedFile}: ${base.error}`,
      });
      return;
    }

    if (news.length === 0) {
      report.pass(
        this,
        `${id}-INCREMENTAL`,
        "No migrations newer than the verified baseline",
        `${baselineFiles.length} baseline files`,
      );
      return;
    }

    const inc = await replayMigrationSubset(db, news);
    if (!inc.ok) {
      report.fail(this, {
        severity: "CRITICAL",
        id: `${id}-INCREMENTAL-FAIL`,
        title: `New migration ${inc.failedFile} fails when applied on the verified baseline`,
        evidence: `${inc.failedFile}: ${inc.error}`,
        detail:
          "The full chain may replay from empty while the upgrade path still breaks. Fix only the new migration; never edit the verified baseline files.",
      });
      return;
    }

    report.pass(
      this,
      `${id}-INCREMENTAL`,
      "New migrations apply cleanly on the verified baseline",
      `${news.length} new file(s): ${news.join(", ")}`,
    );
  });
}
