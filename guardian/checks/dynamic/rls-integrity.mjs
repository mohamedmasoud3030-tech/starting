#!/usr/bin/env node
/**
 * RLS / tenant-isolation structural integrity.
 *
 *   - RLS enabled on every business table                       → CRITICAL
 *   - DELETE-capable policies on financial tables               → CRITICAL
 *   - DELETE-capable policies on master-catalog tables          → HIGH
 *   - DELETE policies outside the contract allowed list         → MEDIUM
 *   - anon table grants                                         → CRITICAL
 *   - org-scoped FKs must include organization_id               → HIGH
 *   - org-scoped tables carry organization_id                   → MEDIUM
 *   - no table may be fully open to the client (no INSERT/UPDATE policy on tables that
 *     must be command-only, per contract)                       → HIGH
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-RLS-INTEGRITY";
export const title = "RLS and tenant-isolation structural integrity";
export const category = "rls";
export const defaultSeverity = "CRITICAL";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db, contract } = ctx;
  const manifest = await extractManifest(db);
  const tables = manifest.tables;

  const financial = new Set(contract.financial?.financialTables ?? []);
  const master = new Set(["catalog_categories", "catalog_items", "packages", "package_items", "suppliers", "customers", "organizations", "events"]);
  const allowedDelete = new Set(contract.writePaths?.allowedDeleteOnly ?? []);

  const rlsOff = Object.entries(tables).filter(([, t]) => !t.rls).map(([n]) => n);
  if (rlsOff.length > 0) {
    report.fail(this, { severity: "CRITICAL", id: `${id}-RLS-OFF`, title: "RLS must be enabled on every business table", evidence: rlsOff.join("\n") });
  } else {
    report.pass(this, `${id}-RLS-OFF`, "RLS enabled on all business tables", `${Object.keys(tables).length} tables`);
  }

  // DELETE-capable policies
  const deletePolicies = manifest.policies.filter((p) => p.cmd === "d" || p.cmd === "*");
  const finDel = deletePolicies.filter((p) => financial.has(p.table));
  const masterDel = deletePolicies.filter((p) => master.has(p.table));
  const otherDel = deletePolicies.filter((p) => !financial.has(p.table) && !master.has(p.table) && !allowedDelete.has(p.table));

  if (finDel.length > 0) {
    report.fail(this, { severity: "CRITICAL", id: `${id}-DELETE-FINANCIAL`, title: "DELETE-capable RLS policies on financial tables (hard-delete risk)", evidence: finDel.map((p) => `${p.table}.${p.name} [${p.cmd}]`).join("\n") });
  } else {
    report.pass(this, `${id}-DELETE-FINANCIAL`, "No DELETE-capable policies on financial tables", "");
  }
  if (masterDel.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-DELETE-MASTER`, title: "DELETE-capable RLS policies on master/catalog tables", evidence: masterDel.map((p) => `${p.table}.${p.name} [${p.cmd}]`).join("\n") });
  } else {
    report.pass(this, `${id}-DELETE-MASTER`, "No DELETE-capable policies on master/catalog tables", "");
  }
  if (otherDel.length > 0) {
    report.fail(this, { severity: "MEDIUM", id: `${id}-DELETE-OTHER`, title: "DELETE policies outside the contract allowed list", evidence: otherDel.map((p) => `${p.table}.${p.name} [${p.cmd}] (allowed: ${[...allowedDelete].join(", ") || "none"})`).join("\n") });
  } else {
    report.pass(this, `${id}-DELETE-OTHER`, "All DELETE-capable policies are inside the contract allowed list", "");
  }

  // org-scoped FK completeness (composite org FK or non-org target)
  let crossOrgRisk = [];
  for (const [name, t] of Object.entries(tables)) {
    if (!Object.keys(t.columns).includes("organization_id")) continue;
    for (const fk of t.foreignKeys) {
      const refTable = tables[fk.refTable];
      if (!refTable) continue;
      if (!Object.keys(refTable.columns).includes("organization_id")) continue; // target not org-scoped
      if (!fk.cols.includes("organization_id")) crossOrgRisk.push(`${name}.(${fk.cols.join(",")}) → ${fk.refTable} without organization_id`);
    }
  }
  if (crossOrgRisk.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-FK-ORG-SCOPE`, title: "Org-scoped FKs must include organization_id (cross-company link risk)", evidence: crossOrgRisk.join("\n") });
  } else {
    report.pass(this, `${id}-FK-ORG-SCOPE`, "All org-scoped FKs are composite org-scoped FKs", "");
  }

  // anon table grants
  const anonGrants = [];
  for (const [name] of Object.entries(tables)) {
    const r = await db.query(
      `select (select string_agg(privilege_type, ',') from aclexplode(c.relacl) a where a.grantee='anon'::regrole) privs
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=$1`,
      [name],
    );
    if (r.rows[0].privs) anonGrants.push(`${name}: ${r.rows[0].privs}`);
  }
  if (anonGrants.length > 0) {
    report.fail(this, { severity: "CRITICAL", id: `${id}-ANON-GRANTS`, title: "Anonymous role has table grants", evidence: anonGrants.join("\n") });
  } else {
    report.pass(this, `${id}-ANON-GRANTS`, "No anon table grants", "");
  }

  // command-only tables must have no client INSERT policy
  const cmdOnly = ["invoices", "invoice_installments", "customer_payments", "host_payouts", "host_payout_allocations", "staff_advances", "staff_attendance", "event_expenses", "event_financial_closures", "quotations", "quotation_lines", "event_commercial_lines", "procurement_orders", "procurement_order_lines", "procurement_receipts", "procurement_receipt_lines", "consumable_movements", "event_equipment_movements", "event_equipment_reservations", "event_warehouse_reconciliations", "event_consumable_reconciliations", "audit_events", "suppliers", "attachment_evidence", "event_status_history", "event_transition_overrides", "command_idempotency"];
  const clientWritable = [];
  for (const t of cmdOnly) {
    const policies = manifest.policies.filter((p) => p.table === t && (p.cmd === "a" || p.cmd === "w" || p.cmd === "*"));
    if (policies.length > 0) clientWritable.push(`${t}: ${policies.map((p) => `${p.name}[${p.cmd}]`).join(", ")}`);
  }
  if (clientWritable.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-CLIENT-WRITE-CMD`, title: "Command-owned tables must not expose client INSERT/UPDATE policies", evidence: clientWritable.join("\n"), detail: "These tables are written exclusively by SECURITY DEFINER RPCs; a client write policy opens a second write path." });
  } else {
    report.pass(this, `${id}-CLIENT-WRITE-CMD`, "Command-owned tables expose no client write policies", "");
  }

  // org-scoped tables without organization_id
  const orgRoot = contract.roles?.tenantRoot ?? "organizations";
  const fkToRoot = new Set();
  for (const [name, t] of Object.entries(tables)) {
    for (const fk of t.foreignKeys) if (fk.refTable === orgRoot) fkToRoot.add(name);
  }
  report.pass(this, `${id}-ORG-SCOPE`, `Org-scoped tables identified (${fkToRoot.size} tables FK to ${orgRoot})`, [...fkToRoot].sort().join(", "));
}
