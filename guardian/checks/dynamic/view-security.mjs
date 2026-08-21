#!/usr/bin/env node
/**
 * View security — every business view must satisfy ONE safe boundary:
 *   1. security_invoker=true, so caller/base-table RLS remains authoritative; or
 *   2. explicit organization filtering in the view body, verified behaviorally.
 *
 * A view satisfying neither condition is a CRITICAL cross-tenant leak risk.
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-VIEW-SECURITY";
export const title = "Views: security_invoker OR explicit organization filtering";
export const category = "security";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);

  const safeDefinerViews = [];
  const unsafeViews = [];

  for (const [name, view] of Object.entries(manifest.views)) {
    if (!view.securityInvoker && view.orgFiltered) safeDefinerViews.push(name);
    if (!view.securityInvoker && !view.orgFiltered) unsafeViews.push(name);
  }

  if (safeDefinerViews.length > 0) {
    report.pass(
      this,
      `${id}-FILTERED-DEFINER`,
      "Non-security_invoker views are explicitly organization-filtered",
      safeDefinerViews.join("\n"),
    );
  } else {
    report.pass(
      this,
      `${id}-FILTERED-DEFINER`,
      "No organization-filtered definer-security view deviations detected",
      "(none)",
    );
  }

  if (unsafeViews.length > 0) {
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-UNSAFE`,
      title: "Views are neither security_invoker nor explicitly organization-filtered",
      evidence: unsafeViews.join("\n"),
      detail:
        "Such a view can bypass base-table RLS without supplying its own tenant boundary. Convert it to security_invoker or add and behavior-test an explicit organization filter.",
    });
  } else {
    report.pass(
      this,
      `${id}-SAFE`,
      "Every view has a tenant-safe execution boundary",
      `${Object.keys(manifest.views).length} view(s): security_invoker or explicit org filter`,
    );
  }
}
