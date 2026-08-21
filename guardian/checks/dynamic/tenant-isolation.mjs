#!/usr/bin/env node
/**
 * Tenant isolation — executes the repository pgTAP suites against the replayed
 * scratch database through the native shims.
 *
 * Every suite must declare plan(N) and call finish(). The shim's finish()
 * raises on failed assertions or plan mismatch, so db.query(sql) is the actual
 * pass/fail signal. We count planned assertions from source because the test
 * files intentionally ROLLBACK, which also rolls back _pgtap_results rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TESTS_DIR, listFiles } from "../../lib/common.mjs";

export const id = "G-TENANT-ISOLATION";
export const title = "RLS/tenant-isolation behavior suite (pgTAP) passes";
export const category = "rls";
export const defaultSeverity = "CRITICAL";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const files = listFiles(TESTS_DIR, ".test.sql");
  const failed = [];
  let assertions = 0;

  for (const t of files) {
    const sql = readFileSync(join(TESTS_DIR, t), "utf8");
    const planMatch = sql.match(/\bselect\s+plan\s*\(\s*(\d+)\s*\)/i);
    const hasFinish = /\bselect\s+\*\s+from\s+finish\s*\(\s*\)/i.test(sql);

    if (!planMatch) {
      failed.push(`${t}: missing literal select plan(N)`);
      continue;
    }
    if (!hasFinish) {
      failed.push(`${t}: missing select * from finish()`);
      continue;
    }

    assertions += Number(planMatch[1]);

    try {
      // finish() raises if an assertion failed or the number executed differs
      // from plan(N). Most suites then ROLLBACK their fixture transaction.
      await db.query(sql);
    } catch (e) {
      failed.push(`${t}: ${e.message}`);
    } finally {
      // If a suite raised before its own ROLLBACK, recover the connection.
      await db.query("rollback");
      await db.query("delete from public._pgtap_results");
      await db.query("delete from public._pgtap_plan");
    }
  }

  if (failed.length > 0) {
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-FAIL`,
      title: "pgTAP suite failures (RLS/tenant isolation/guards)",
      evidence: failed.join("\n").slice(0, 3000),
      detail: `${files.length} test files, ${assertions} planned assertions; failing files above.`,
    });
  } else {
    report.pass(
      this,
      `${id}-PASS`,
      "pgTAP suites pass on the replayed schema",
      `${files.length} files, ${assertions} planned assertions`,
    );
  }
}
