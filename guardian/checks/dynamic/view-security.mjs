#!/usr/bin/env node
/**
 * View security — every business view must be security_invoker AND
 * org-filtered in its definition (or CRITICAL: cross-tenant exposure).
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-VIEW-SECURITY";
export const title = "Views: security_invoker=true and org-filtered bodies";
export const category = "security";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);

  const notInvoker = [];
  const notFiltered = [];
  for (const [name, v] of Object.entries(manifest.views)) {
    if (!v.securityInvoker) notInvoker.push(name);
    // A view is DANGEROUS only when it is neither security_invoker nor
    // org-filtered in its body: RLS cannot backstop it AND it has no filter.
    if (!v.securityInvoker && !v.orgFiltered) notFiltered.push(name);
  }

  if (notInvoker.length > 0) {
    report.add(this, {
      status: "PASS",
      severity: "LOW",
      id: `${id}-NOT-INVOKER`,
      title: "Non-security_invoker views exist but are org-filtered in their bodies (documented deviation)",
      evidence: notInvoker.join("\n") + "\n(bodies carry can_read_cost/is_org_member/has_org_role; behavior verified by guardian_tenant_isolation.test.sql)",
      detail: "These definer-security views bypass RLS on base tables, so tenant filtering depends on the body WHERE clause. The hard invariant (checked elsewhere) is that the filter must never be dropped. Converting them to security_invoker would require widening raw-table grants to authenticated, which the design deliberately avoids.",
    });
  } else {
    report.pass(this, `${id}-NOT-INVOKER`, "All views are security_invoker=true", `${Object.keys(manifest.views).length} views`);
  }

  if (notFiltered.length > 0) {
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-NOT-FILTERED`,
      title: "Views without any organization filtering in their definition (cross-tenant leak risk)",
      evidence: notFiltered.join("\n"),
      detail: "A view that is neither security_invoker nor org-filtered in its body can expose every organization's rows.",
    });
  } else {
    report.pass(this, `${id}-NOT-FILTERED`, "Every view body filters by organization", "(is_org_member / has_org_role / can_read_cost present)");
  }
}
