#!/usr/bin/env node
/**
 * Financial integrity — reconciliation, overpayment, double posting,
 * approved-document immutability, hard-delete prevention, NUMERIC money,
 * document-number uniqueness.
 *
 * Schema-level facts come from the manifest; data-level scans run against the
 * connected database (empty on the scratch DB — behavior guards are exercised
 * by guardian_financial_integrity.test.sql with fixtures).
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-FINANCIAL-INTEGRITY";
export const title = "Financial integrity: exact money, reconciliation, immutability, uniqueness";
export const category = "financial";
export const defaultSeverity = "CRITICAL";
export const mode = "dynamic";

const MONEY_COL_RE = /price|amount|cost|total|balance|paid|due|vat|discount|rate|salary|wage|payout|fee|value|charge/i;

export async function run(ctx) {
  const { report, db, contract } = ctx;
  const manifest = await extractManifest(db);
  const tables = manifest.tables;
  const financial = contract.financial?.financialTables ?? [];
  const financialSet = new Set(financial);

  // ---- 1. Money column types -------------------------------------------------
  const floatMoney = [];
  const badScale = [];
  for (const [tname, t] of Object.entries(tables)) {
    for (const [cname, c] of Object.entries(t.columns)) {
      if (!MONEY_COL_RE.test(cname)) continue;
      if (c.type === "double precision" || c.type === "real") {
        floatMoney.push(`${tname}.${cname} ${c.type}`);
      } else if (c.type === "numeric" && c.scale !== 3) {
        badScale.push(`${tname}.${cname} numeric(p=${c.precision},s=${c.scale}) — scale must be 3`);
      }
    }
  }
  if (floatMoney.length > 0) {
    report.fail(this, { severity: "CRITICAL", id: `${id}-FLOAT-MONEY`, title: "Money columns stored as binary float", evidence: floatMoney.join("\n") });
  } else {
    report.pass(this, `${id}-FLOAT-MONEY`, "No money column uses a binary float type", "");
  }
  if (badScale.length > 0) {
    report.fail(this, { severity: "MEDIUM", id: `${id}-SCALE`, title: "Money columns must have scale 3 (OMR millesimal)", evidence: badScale.join("\n") });
  } else {
    report.pass(this, `${id}-SCALE`, "All money columns are numeric(…,3)", "");
  }

  // ---- 2. Reconciliation / overpayment (data scan) ---------------------------
  const overpaid = await db.query(
    `select e.organization_id, e.id event_id, e.event_number,
            sum(distinct i.total_amount)::numeric(14,3) invoice_total,
            (select coalesce(sum(p.amount),0)::numeric(14,3) from public.customer_payments p
              where p.organization_id=e.organization_id and p.event_id=e.id and p.status='RECORDED') paid_total
     from public.events e
     left join public.invoices i on i.organization_id=e.organization_id and i.event_id=e.id and i.status <> 'CANCELLED'
     where e.status <> 'CANCELLED'
     group by e.organization_id, e.id, e.event_number
     having (select coalesce(sum(p.amount),0) from public.customer_payments p
              where p.organization_id=e.organization_id and p.event_id=e.id and p.status='RECORDED') > sum(distinct i.total_amount)`,
  );
  if (overpaid.rows.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-OVERPAYMENT`, title: "Event payments exceed invoiced totals (overpayment)", evidence: overpaid.rows.map((r) => `${r.event_number}: paid ${r.paid_total} > invoices ${r.invoice_total}`).join("\n") });
  } else {
    report.pass(this, `${id}-OVERPAYMENT`, "No event is overpaid vs its invoices", "");
  }

  // ---- 3. Double posting (data scan) -----------------------------------------
  const doublePost = await db.query(
    `select organization_id, event_id, reference, amount, payment_method, count(*) c
     from public.customer_payments
     where status='RECORDED' and reference is not null and nullif(trim(reference),'') is not null
     group by 1,2,3,4,5 having count(*) > 1
     order by c desc`,
  );
  if (doublePost.rows.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-DOUBLE-POST`, title: "Identical RECORDED payments (same reference/amount/method) — possible double posting", evidence: doublePost.rows.map((r) => `${r.event_id}: ${r.reference} ${r.amount} ×${r.c}`).join("\n") });
  } else {
    report.pass(this, `${id}-DOUBLE-POST`, "No duplicate RECORDED payments detected", "");
  }

  // ---- 4. Approved-document immutability (data scan) --------------------------
  // Invoices carry no updated_at (append-only by design; the DB trigger blocks
  // any post-issue mutation, so there is nothing to scan). Quotations have an
  // updated_at and must not change after issue (snapshot immutability).
  const mutated = await db.query(
    `select 'quotation' kind, quotation_number ref, organization_id from public.quotations
      where status in ('ISSUED','ACCEPTED','CONVERTED') and updated_at > issued_at`,
  );
  if (mutated.rows.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-APPROVED-MUTATED`, title: "Approved financial documents were modified after issue", evidence: mutated.rows.map((r) => `${r.kind} ${r.ref}`).join("\n"), detail: "Issued invoices/quotations are immutable snapshots; mutations must go through void/revision commands." });
  } else {
    report.pass(this, `${id}-APPROVED-MUTATED`, "No approved document was mutated after issue", "");
  }

  // ---- 5. Hard-delete prevention (schema) ------------------------------------
  const delPolicies = manifest.policies.filter((p) => financialSet.has(p.table) && (p.cmd === "d" || p.cmd === "*"));
  if (delPolicies.length > 0) {
    report.fail(this, { severity: "CRITICAL", id: `${id}-DELETE-POLICY`, title: "Financial tables expose DELETE-capable RLS policies", evidence: delPolicies.map((p) => `${p.table}.${p.name}`).join("\n") });
  } else {
    report.pass(this, `${id}-DELETE-POLICY`, "No financial table exposes a client DELETE policy", "");
  }

  // Each financial table must be protected by a guard trigger OR be client-write-impossible
  const guards = new Map();
  for (const tr of manifest.triggers) {
    if (!guards.has(tr.table)) guards.set(tr.table, []);
    guards.get(tr.table).push(tr.name);
  }
  const unprotected = [];
  for (const t of financial) {
    const guard = (guards.get(t) ?? []).some((g) => /guard|append|immutable|no_delete|history/i.test(g));
    if (guard) continue;
    // no trigger → must have no client write policies
    const writePols = manifest.policies.filter((p) => p.table === t && (p.cmd === "a" || p.cmd === "w" || p.cmd === "*"));
    if (writePols.length > 0) unprotected.push(`${t} (no guard trigger and has client write policies: ${writePols.map((p) => p.name).join(", ")})`);
    else unprotected.push(`${t} (no guard trigger; client writes impossible by grants/policies — acceptable)`);
  }
  const trulyUnprotected = unprotected.filter((u) => !u.includes("acceptable"));
  if (trulyUnprotected.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-HARD-DELETE`, title: "Financial tables without hard-delete protection", evidence: trulyUnprotected.join("\n") });
  } else {
    report.pass(this, `${id}-HARD-DELETE`, "Every financial table is guarded by a trigger or is client-write-impossible", unprotected.join("; ") || "(none)");
  }

  // ---- 6. Document-number uniqueness (schema) ---------------------------------
  const missingUniques = [];
  for (const [table, cols] of Object.entries(contract.financial?.documentNumberTables ?? {})) {
    const t = tables[table];
    if (!t) {
      missingUniques.push(`${table} missing`);
      continue;
    }
    const covered = t.uniques.some((u) => cols.every((c) => u.cols.includes(c)));
    if (!covered) missingUniques.push(`${table}(${cols.join(", ")})`);
  }
  if (missingUniques.length > 0) {
    report.fail(this, { severity: "HIGH", id: `${id}-DOC-UNIQUE`, title: "Document-number uniqueness constraints missing", evidence: missingUniques.join("\n") });
  } else {
    report.pass(this, `${id}-DOC-UNIQUE`, "Document-number uniqueness enforced per organization", Object.keys(contract.financial?.documentNumberTables ?? {}).join(", "));
  }

  // ---- 7. Command idempotency (schema) ---------------------------------------
  const finRpcNoIdem = [];
  for (const [key, f] of Object.entries(manifest.functions)) {
    if (!f.secdef || !f.bodyWrites) continue;
    if (!/(invoice|payment|payout|advance|expense|procurement|attendance|purchase|receipt|payroll)/i.test(key)) continue;
    const r = await db.query(
      `select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname=$1 and pg_get_function_identity_arguments(p.oid)=$2`,
      [key.split("(")[0], key.slice(key.indexOf("(") + 1, -1)],
    );
    const def = r.rows[0]?.def ?? "";
    if (!/idempotency|begin_command/i.test(def)) finRpcNoIdem.push(key);
  }
  if (finRpcNoIdem.length > 0) {
    report.fail(this, { severity: "MEDIUM", id: `${id}-IDEMPOTENCY`, title: "Financial RPCs without idempotency protection", evidence: finRpcNoIdem.join("\n") });
  } else {
    report.pass(this, `${id}-IDEMPOTENCY`, "All financial RPCs use idempotency keys / begin_command", "");
  }

  report.pass(this, `${id}-OK`, "Financial integrity checks completed", "");
}
