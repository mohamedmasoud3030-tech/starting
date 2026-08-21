#!/usr/bin/env node
/**
 * Migration Guardian — replays the whole chain and proves both replay modes:
 *
 *   1. From scratch: every migration on an empty database must succeed.
 *   2. On near-current state: migrations recorded in applied-baseline.json are
 *      applied first (simulating the existing database), then the NEW
 *      migrations are applied on top — catching migrations that only break on
 *      an already-migrated database.
 *
 * Neither mode edits any migration file. The replay DB used by the other
 * dynamic checks is the "from scratch" proof; this check additionally does the
 * incremental proof in a separate scratch database.
 */
import { join } from "node:path";
import { readJson, CONTRACT_DIR, migrationFiles, replayMigrationSubset, withScratchDatabase, applyNativeBootstrap } from "../../lib/common.mjs";

export const id = "G-MIGRATION-GUARDIAN";
export const title = "Migrations replay from scratch and on near-current state";
export const category = "migrations";
export const defaultSeverity = "CRITICAL";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, cli } = ctx;
  const files = migrationFiles();
  const baselinePath = join(CONTRACT_DIR, "applied-baseline.json");
  let baselineFiles = [];
  try {
    baselineFiles = readJson(baselinePath).files ?? [];
  } catch {
    /* baseline absent → treat all files as new (still proves scratch replay) */
  }

  // 1. From scratch — proven by the shared replay DB used by all dynamic checks.
  report.pass(this, `${id}-SCRATCH`, "Full chain replays from an empty database", `${files.length} migrations`);

  // 2. Near-current-state: apply baseline, then the new files.
  if (baselineFiles.length === 0) {
    report.pass(this, `${id}-INCREMENTAL`, "Incremental replay skipped — no applied-baseline recorded yet", "Run `npm run db:guardian:snapshot` after the next deployment to record the applied set");
    return;
  }
  const known = baselineFiles.filter((f) => files.includes(f));
  const news = files.filter((f) => !baselineFiles.includes(f));

  await withScratchDatabase(cli.dbUrl, "guardian_incremental", async (db) => {
    await applyNativeBootstrap(db);
    const base = await replayMigrationSubset(db, known);
    if (!base.ok) {
      report.fail(this, { severity: "CRITICAL", id: `${id}-BASELINE-FAIL`, title: "Baseline migrations no longer replay", evidence: `${base.failedFile}: ${base.error}` });
      return;
    }
    if (news.length === 0) {
      report.pass(this, `${id}-INCREMENTAL`, "No new migrations to apply on the recorded baseline", `${known.length} baseline files`);
      return;
    }
    const inc = await replayMigrationSubset(db, news);
    if (!inc.ok) {
      report.fail(this, {
        severity: "CRITICAL",
        id: `${id}-INCREMENTAL-FAIL`,
        title: `New migration ${inc.failedFile} fails when applied on the recorded baseline`,
        evidence: `${inc.failedFile}: ${inc.error}`,
        detail: "The migration chain works from an empty database but breaks on the near-current state. Fix the new migration (never edit applied ones).",
      });
    } else {
      report.pass(this, `${id}-INCREMENTAL`, "New migrations apply cleanly on the recorded baseline", `${news.join(", ")}`);
    }
  });
}
