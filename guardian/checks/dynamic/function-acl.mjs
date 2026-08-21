#!/usr/bin/env node
/**
 * SECURITY DEFINER function audit.
 *
 * For every SECURITY DEFINER function in public:
 *   - search_path must be pinned            → HIGH
 *   - ACL must not be NULL (PUBLIC default) → HIGH
 *   - anon EXECUTE must be denied           → HIGH (CRITICAL if body writes)
 *   - a body that writes must carry a role guard (auth.uid/has_org_role/…) → CRITICAL
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-FUNCTION-ACL";
export const title = "SECURITY DEFINER functions: least privilege + pinned search_path + role guards";
export const category = "security";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);
  const secdef = Object.entries(manifest.functions).filter(([, f]) => f.secdef && !f.name.startsWith("_view_"));

  let noPath = 0;
  let nullAcl = 0;
  let anonExec = 0;
  let anonExecWrites = 0;
  let writesNoGuard = 0;
  const ev = [];

  for (const [key, f] of secdef) {
    if (!f.searchPathPinned) {
      noPath++;
      ev.push(`[${id}-SEARCH-PATH] ${key} has no pinned search_path`);
    }
    if (f.aclNull) {
      nullAcl++;
      ev.push(`[${id}-NULL-ACL] ${key} ACL is NULL → executable by PUBLIC (default)`);
    }
    if (f.anonExec) {
      anonExec++;
      if (f.bodyWrites) anonExecWrites++;
      ev.push(`[${id}-ANON-EXEC] ${key} anon EXECUTE=${f.anonExec} bodyWrites=${f.bodyWrites}`);
    }
    if (f.bodyWrites && !f.bodyHasRoleGuard) {
      writesNoGuard++;
      ev.push(`[${id}-NO-GUARD] ${key} writes to tables but has no role guard in body`);
    }
  }

  const failOrPass = (count, sev, key, titleText) => {
    if (count > 0) {
      report.fail(this, { severity: sev, id: `${id}-${key}`, title: titleText, evidence: ev.filter((e) => e.startsWith(`[${id}-${key}]`)).join("\n").slice(0, 3000) });
    } else {
      report.pass(this, `${id}-${key}`, titleText, `0 of ${secdef.length} functions affected`);
    }
  };

  failOrPass(noPath, "HIGH", "SEARCH-PATH", "SECURITY DEFINER functions must pin search_path");
  failOrPass(nullAcl, "HIGH", "NULL-ACL", "SECURITY DEFINER functions must not carry default PUBLIC ACL");
  failOrPass(anonExecWrites, "CRITICAL", "ANON-WRITE", "SECURITY DEFINER functions executable by anon that write data");
  failOrPass(anonExec, "HIGH", "ANON-EXEC", "SECURITY DEFINER functions must not be executable by anon");
  failOrPass(writesNoGuard, "CRITICAL", "WRITE-NO-GUARD", "Writing SECURITY DEFINER functions must role-guard in the body");

  const ok = noPath + nullAcl + anonExec + writesNoGuard === 0;
  if (ok) report.pass(this, `${id}-OK`, "All SECURITY DEFINER functions comply with the contract", `${secdef.length} functions audited`);
}
