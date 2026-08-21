#!/usr/bin/env node
/**
 * Financial integrity — reconciliation, duplicate-payment detection,
 * approved-document immutability, hard-delete prevention, NUMERIC money,
 * document-number uniqueness.
 *
 * Schema-level facts come from the manifest. Data-level scans run against the
 * isolated scratch replay; behavior guards are exercised by
 * guardian_financial_integrity.test.sql with fixtures.
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
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-FLOAT-MONEY`,
      title: "Money columns stored as binary float",
      evidence: floatMoney.join("\n"),
    });
  } else {
    report.pass(this, `${id}-FLOAT-MONEY`, "No money column uses a binary float type", "");
  }
  if (badScale.length > 0) {
    report.fail(this, {
      severity: "MEDIUM",
      id: `${id}-SCALE`,
      title: "Money columns must have scale 3 (OMR millesimal)",
      evidence: badScale.join("\n"),
    });
  } else {
    report.pass(this, `${id}-SCALE`, "All money columns are numeric(…,3)", "");
  }

  // ---- 2. Reconciliation / overpayment (data scan) ---------------------------
  // Sum EVERY active invoice row. SUM(DISTINCT total_amount) is incorrect here:
  // two legitimate invoices can have the same amount and must both count.
  const overpaid = await db.query(
    `select e.organization_id, e.id event_id, e.event_number,
            coalesce(sum(i.total_amount),0)::numeric(14,3) invoice_total,
            (select coalesce(sum(p.amount),0)::numeric(14,3)
               from public.customer_payments p
              where p.organization_id=e.organization_id
                and p.event_id=e.id
                and p.status='RECORDED') paid_total
       from public.events e
       left join public.invoices i
         on i.organization_id=e.organization_id
        and i.event_id=e.id
        and i.status <> 'CANCELLED'
      where e.status <> 'CANCELLED'
      group by e.organization_id, e.id, e.event_number
     having (select coalesce(sum(p.amount),0)
               from public.customer_payments p
              where p.organization_id=e.organization_id
                and p.event_id=e.id
                and p.status='RECORDED') > coalesce(sum(i.total_amount),0)`,
  );
  if (overpaid.rows.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-OVERPAYMENT`,
      title: "Event payments exceed invoiced totals (overpayment)",
      evidence: overpaid.rows
        .map((r) => `${r.event_number}: paid ${r.paid_total} > invoices ${r.invoice_total}`)
        .join("\n"),
    });
  } else {
    report.pass(this, `${id}-OVERPAYMENT`, "No event is overpaid vs its invoices", "");
  }

  // ---- 3. Duplicate posting detection (data scan) ----------------------------
  // Distinct idempotency keys can still produce two payments with the same
  // external reference/amount/method. This is a detection signal, not a blanket
  // prohibition: legitimate duplicate-looking payments may require review.
  const doublePost = await db.query(
    `select organization_id, event_id, reference, amount, payment_method, count(*) c
       from public.customer_payments
      where status='RECORDED'
        and reference is not null
        and nullif(trim(reference),'') is not null
      group by 1,2,3,4,5
     having count(*) > 1
      order by c desc`,
  );
  if (doublePost.rows.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-DOUBLE-POST`,
      title: "Duplicate-looking RECORDED payments require review",
      evidence: doublePost.rows
        .map((r) => `${r.event_id}: ${r.reference} ${r.amount} ×${r.c}`)
        .join("\n"),
      detail:
        "Same event/reference/amount/method appears more than once. This may be legitimate, but it must be reviewed because it can also indicate double posting.",
    });
  } else {
    report.pass(this, `${id}-DOUBLE-POST`, "No duplicate-looking RECORDED payments detected", "");
  }

  // ---- 4. Approved-document immutability (schema + pgTAP behavior) ------------
  // Do not infer mutation from quotations.updated_at > issued_at: legitimate
  // ISSUED→ACCEPTED→CONVERTED lifecycle transitions update updated_at by design.
  // The correct invariant is the immutable-snapshot trigger plus behavior tests.
  const quotationGuard = manifest.triggers.some(
    (tr) => tr.table === "quotations" && tr.name === "quotation_snapshot_immutable",
  );
  if (!quotationGuard) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-APPROVED-IMMUTABILITY-GUARD`,
      title: "Quotation immutable-snapshot trigger is missing",
      evidence: "expected trigger quotations.quotation_snapshot_immutable",
      detail:
        "Issued quotation commercial facts must be protected by the database trigger; lifecycle transitions are tested separately by pgTAP.",
    });
  } else {
    report.pass(
      this,
      `${id}-APPROVED-IMMUTABILITY-GUARD`,
      "Approved quotation snapshot is protected by the database trigger",
      "quotations.quotation_snapshot_immutable",
    );
  }

  // ---- 5. Hard-delete prevention (schema) ------------------------------------
  const delPolicies = manifest.policies.filter(
    (p) => financialSet.has(p.table) && (p.cmd === "d" || p.cmd === "*"),
  );
  if (delPolicies.length > 0) {
    report.fail(this, {
      severity: "CRITICAL",
      id: `${id}-DELETE-POLICY`,
      title: "Financial tables expose DELETE-capable RLS policies",
      evidence: delPolicies.map((p) => `${p.table}.${p.name}`).join("\n"),
    });
  } else {
    report.pass(this, `${id}-DELETE-POLICY`, "No financial table exposes a client DELETE policy", "");
  }

  // Each financial table must be protected by a guard trigger OR be
  // client-write-impossible by policy/grant design.
  const guards = new Map();
  for (const tr of manifest.triggers) {
    if (!guards.has(tr.table)) guards.set(tr.table, []);
    guards.get(tr.table).push(tr.name);
  }
  const unprotected = [];
  for (const t of financial) {
    const guard = (guards.get(t) ?? []).some((g) =>
      /guard|append|immutable|no_delete|history/i.test(g),
    );
    if (guard) continue;
    const writePols = manifest.policies.filter(
      (p) => p.table === t && (p.cmd === "a" || p.cmd === "w" || p.cmd === "*"),
    );
    if (writePols.length > 0) {
      unprotected.push(
        `${t} (no guard trigger and has client write policies: ${writePols.map((p) => p.name).join(", ")})`,
      );
    } else {
      unprotected.push(`${t} (no guard trigger; client writes impossible by grants/policies — acceptable)`);
    }
  }
  const trulyUnprotected = unprotected.filter((u) => !u.includes("acceptable"));
  if (trulyUnprotected.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-HARD-DELETE`,
      title: "Financial tables without hard-delete protection",
      evidence: trulyUnprotected.join("\n"),
    });
  } else {
    report.pass(
      this,
      `${id}-HARD-DELETE`,
      "Every financial table is guarded by a trigger or is client-write-impossible",
      unprotected.join("; ") || "(none)",
    );
  }

  // ---- 6. Document-number uniqueness (schema) --------------------------------
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
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-DOC-UNIQUE`,
      title: "Document-number uniqueness constraints missing",
      evidence: missingUniques.join("\n"),
    });
  } else {
    report.pass(
      this,
      `${id}-DOC-UNIQUE`,
      "Document-number uniqueness enforced per organization",
      Object.keys(contract.financial?.documentNumberTables ?? {}).join(", "),
    );
  }

  // ---- 7. Command idempotency (schema) ---------------------------------------
  const finRpcNoIdem = [];
  for (const [key, f] of Object.entries(manifest.functions)) {
    if (!f.secdef || !f.bodyWrites) continue;
    if (!/(invoice|payment|payout|advance|expense|procurement|attendance|purchase|receipt|payroll)/i.test(key)) continue;
    const r = await db.query(
      `select pg_get_functiondef(p.oid) def
         from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname=$1
          and pg_get_function_identity_arguments(p.oid)=$2`,
      [key.split("(")[0], key.slice(key.indexOf("(") + 1, -1)],
    );
    const def = r.rows[0]?.def ?? "";
    if (!/idempotency|begin_command/i.test(def)) finRpcNoIdem.push(key);
  }
  if (finRpcNoIdem.length > 0) {
    report.fail(this, {
      severity: "MEDIUM",
      id: `${id}-IDEMPOTENCY`,
      title: "Financial RPCs without idempotency protection",
      evidence: finRpcNoIdem.join("\n"),
    });
  } else {
    report.pass(this, `${id}-IDEMPOTENCY`, "All financial RPCs use idempotency keys / begin_command", "");
  }

  report.pass(this, `${id}-OK`, "Financial integrity checks completed", "");
}
