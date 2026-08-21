#!/usr/bin/env node
/**
 * SECURITY DEFINER function audit.
 *
 * For every SECURITY DEFINER function in public (including read-model helpers):
 *   - search_path must be pinned                  → HIGH
 *   - ACL must not be NULL (PUBLIC default)       → HIGH
 *   - anon EXECUTE must be denied                 → HIGH / CRITICAL when writing
 *   - authenticated-callable writers need an
 *     in-body organization/role authorization guard → CRITICAL
 *
 * Internal trigger/helper functions with authenticated EXECUTE revoked are not
 * required to repeat a client role guard; their safety boundary is their ACL +
 * the trusted caller/trigger.
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-FUNCTION-ACL";
export const title = "SECURITY DEFINER functions: least privilege + pinned search_path + authorization guards";
export const category = "security";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);
  const secdef = Object.entries(manifest.functions).filter(([, f]) => f.secdef);

  let noPath = 0;
  let nullAcl = 0;
  let anonExec = 0;
  let anonExecWrites = 0;
  let clientWritesNoGuard = 0;
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
      ev.push(
        `[${id}-ANON-EXEC] ${key} anon EXECUTE=${f.anonExec} bodyWrites=${f.bodyWrites}`,
      );
    }

    if (f.bodyWrites && f.authExec && !f.bodyHasRoleGuard) {
      clientWritesNoGuard++;
      ev.push(
        `[${id}-CLIENT-WRITE-NO-GUARD] ${key} writes data and is executable by authenticated, but no organization/role authorization guard was detected`,
      );
    }
  }

  const failOrPass = (count, severity, key, titleText) => {
    if (count > 0) {
      report.fail(this, {
        severity,
        id: `${id}-${key}`,
        title: titleText,
        evidence: ev
          .filter((e) => e.startsWith(`[${id}-${key}]`))
          .join("\n")
          .slice(0, 3000),
      });
    } else {
      report.pass(
        this,
        `${id}-${key}`,
        titleText,
        `0 of ${secdef.length} SECURITY DEFINER functions affected`,
      );
    }
  };

  failOrPass(
    noPath,
    "HIGH",
    "SEARCH-PATH",
    "SECURITY DEFINER functions must pin search_path",
  );
  failOrPass(
    nullAcl,
    "HIGH",
    "NULL-ACL",
    "SECURITY DEFINER functions must not carry default PUBLIC ACL",
  );
  failOrPass(
    anonExecWrites,
    "CRITICAL",
    "ANON-WRITE",
    "Writing SECURITY DEFINER functions must never be executable by anon",
  );
  failOrPass(
    anonExec,
    "HIGH",
    "ANON-EXEC",
    "SECURITY DEFINER functions must not be executable by anon",
  );
  failOrPass(
    clientWritesNoGuard,
    "CRITICAL",
    "CLIENT-WRITE-NO-GUARD",
    "Authenticated-callable SECURITY DEFINER writers must authorization-guard in the body",
  );

  const ok = noPath + nullAcl + anonExec + clientWritesNoGuard === 0;
  if (ok) {
    report.pass(
      this,
      `${id}-OK`,
      "All SECURITY DEFINER functions comply with the contract",
      `${secdef.length} functions audited`,
    );
  }
}
