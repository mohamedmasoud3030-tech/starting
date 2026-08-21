#!/usr/bin/env node
/**
 * Full schema inventory — tables, columns/types, PK/FK/unique/check
 * constraints, indexes, views, triggers, functions/RPCs, RLS policies,
 * SECURITY DEFINER functions, enums.
 *
 * Produces guardian/reports/latest/inventory.md + inventory.json.
 */
import { extractManifest } from "../../lib/manifest.mjs";
import { writeArtifact } from "../../lib/report.mjs";

export const id = "G-INVENTORY";
export const title = "Full schema inventory extraction";
export const category = "inventory";
export const defaultSeverity = "INFO";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);

  const tableNames = Object.keys(manifest.tables);
  const secdef = Object.values(manifest.functions).filter((f) => f.secdef);
  const rlsOff = tableNames.filter((n) => !manifest.tables[n].rls);
  const nonInvokerViews = Object.entries(manifest.views).filter(([, v]) => !v.securityInvoker).map(([n]) => n);

  const md = [];
  md.push(`# Database inventory — ${new Date().toISOString()}`, "");
  md.push(`- **Tables**: ${tableNames.length}`);
  md.push(`- **Views**: ${Object.keys(manifest.views).length} (${nonInvokerViews.length} non-security_invoker: ${nonInvokerViews.join(", ") || "—"})`);
  md.push(`- **Functions/RPCs**: ${Object.keys(manifest.functions).length} (${secdef.length} SECURITY DEFINER)`);
  md.push(`- **Triggers**: ${manifest.triggers.length}`);
  md.push(`- **RLS policies**: ${manifest.policies.length} (RLS disabled on: ${rlsOff.join(", ") || "none"})`);
  md.push(`- **Enums**: ${Object.keys(manifest.enums).length}`, "");

  md.push("## Tables", "", "| Table | Columns | PK | FK | Unique | Check | Indexes | RLS |");
  md.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const name of tableNames.sort()) {
    const t = manifest.tables[name];
    md.push(`| \`${name}\` | ${Object.keys(t.columns).length} | ${t.primaryKey.join(", ")} | ${t.foreignKeys.length} | ${t.uniques.length} | ${t.checks.length} | ${t.indexes.length} | ${t.rls ? "✅" : "❌"} |`);
  }

  md.push("", "## Columns (money columns highlighted)", "", "| Table | Column | Type | Nullable | Default |");
  md.push("| --- | --- | --- | --- | --- |");
  for (const name of tableNames.sort()) {
    const t = manifest.tables[name];
    for (const [col, c] of Object.entries(t.columns)) {
      const isMoney = /price|amount|cost|total|balance|paid|due|vat|discount|rate|salary|wage|payout|fee|value|charge/i.test(col);
      const moneyMark = isMoney ? (c.type === "numeric" ? " 💰" : " 🚨FLOAT") : "";
      md.push(`| \`${name}\` | \`${col}\`${moneyMark} | ${c.type}${c.type === "numeric" ? `(${c.precision},${c.scale})` : ""} | ${c.nullable ? "YES" : "NO"} | ${c.default ?? "—"} |`);
    }
  }

  md.push("", "## SECURITY DEFINER functions", "", "| Function | search_path pinned | ACL null (PUBLIC) | anon EXECUTE | body writes | role guard |");
  md.push("| --- | --- | --- | --- | --- | --- |");
  for (const [key, f] of Object.entries(manifest.functions)) {
    if (!f.secdef) continue;
    md.push(`| \`${key}\` | ${f.searchPathPinned ? "✅" : "❌"} | ${f.aclNull ? "⚠️" : "—"} | ${f.anonExec ? "⚠️" : "—"} | ${f.bodyWrites ? "yes" : "no"} | ${f.bodyHasRoleGuard ? "yes" : "**NO**"} |`);
  }

  md.push("", "## Triggers", "", "| Table | Trigger | Timing | Events | Statement |");
  md.push("| --- | --- | --- | --- | --- |");
  for (const t of manifest.triggers) md.push(`| \`${t.table}\` | \`${t.name}\` | ${t.timing} | ${t.events} | ${t.statement} |`);

  md.push("", "## RLS policies", "", "| Table | Policy | Cmd | Roles | Using | Check |");
  md.push("| --- | --- | --- | --- | --- | --- |");
  for (const p of manifest.policies) md.push(`| \`${p.table}\` | \`${p.name}\` | ${p.cmd} | ${p.roles} | ${p.using} | ${p.check} |`);

  const reportDir = ctx.cli.reportDir;
  writeArtifact(reportDir, "inventory.md", md.join("\n") + "\n");
  writeArtifact(reportDir, "inventory.json", JSON.stringify(manifest, null, 2) + "\n");

  report.pass(this, `${id}-OK`, "Full schema inventory extracted", `${tableNames.length} tables, ${Object.keys(manifest.views).length} views, ${Object.keys(manifest.functions).length} functions, ${manifest.policies.length} RLS policies`);
}
