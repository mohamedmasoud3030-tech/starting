#!/usr/bin/env node
/**
 * Tenant isolation — executes the pgTAP suites (supabase/tests/*.test.sql)
 * against the replayed database through the native shims.
 *
 * The suites include real cross-company probes (SELECT/INSERT/UPDATE/DELETE,
 * RPCs, views, SECURITY DEFINER) in guardian_tenant_isolation.test.sql and
 * the pre-existing rls_isolation.test.sql. In CI the same files are run by
 * `supabase test db` (authoritative Supabase stack).
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
    try {
      await db.query(sql);
      const r = await db.query(`select count(*)::int n, count(*) filter (where not ok)::int bad from public._pgtap_results`);
      assertions += r.rows[0].n;
      if (r.rows[0].bad > 0) failed.push(`${t}: ${r.rows[0].bad} failed assertion(s)`);
    } catch (e) {
      failed.push(`${t}: ${e.message}`);
    } finally {
      await db.query("rollback");
      await db.query("delete from public._pgtap_plan");
    }
  }

  if (failed.length > 0) {
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-FAIL`,
      title: "pgTAP suite failures (RLS/tenant isolation/guards)",
      evidence: failed.join("\n").slice(0, 3000),
      detail: `${files.length} test files, ${assertions} assertions; failing files above.`,
    });
  } else {
    report.pass(this, `${id}-PASS`, "pgTAP suites pass on the replayed schema", `${files.length} files, ${assertions} assertions`);
  }
}
