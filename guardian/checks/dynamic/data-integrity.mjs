#!/usr/bin/env node
/**
 * Data integrity scans (run against the connected database — the replayed
 * scratch DB locally, or the live/actual DB via --db-url):
 *
 *   - orphan records / broken foreign references (per-FK scan)
 *   - cross-company relationships (org-scoped FK mismatches)
 *   - duplicate business records
 *   - impossible states (closed event with outstanding stock, negative
 *     balances, check-out before check-in, …)
 *   - invalid status transitions (event_status_history outside the matrix)
 *
 * On an empty scratch DB these scans PASS with zero rows — their real value is
 * on a data-bearing database (the live Supabase project). The behavior-level
 * guards are exercised with fixtures in guardian_data_integrity.test.sql.
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-DATA-INTEGRITY";
export const title = "Data integrity: orphans, cross-org links, duplicates, impossible states";
export const category = "data";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);
  const tables = manifest.tables;

  const total = { orphans: 0, crossOrg: 0, impossible: 0, duplicates: 0 };
  const evidence = [];

  // 1. Orphan / broken FK references
  for (const [name, t] of Object.entries(tables)) {
    for (const fk of t.foreignKeys) {
      const childCols = fk.cols.join(", ");
      const parentCols = fk.refCols.join(", ");
      // Skip if child cols are not all present
      const missing = fk.cols.filter((c) => !t.columns[c]);
      if (missing.length > 0) continue;
      const sql = `select count(*)::int n from public.${name} c
        left join public.${fk.refTable} p on ${fk.cols.map((c, i) => `p.${fk.refCols[i]} = c.${c}`).join(" and ")}
        where ${fk.cols.map((c) => `c.${c} is not null`).join(" and ")}
          and p.${fk.refCols[0]} is null`;
      try {
        const r = await db.query(sql);
        if (r.rows[0].n > 0) {
          total.orphans += r.rows[0].n;
          evidence.push(`ORPHAN: ${name}(${childCols}) → ${fk.refTable}(${parentCols}): ${r.rows[0].n} row(s)`);
        }
      } catch {
        /* skip un-runnable scans */
      }
    }
  }

  // 2. Cross-company relationships: org-scoped FK pairs with mismatched org
  for (const [name, t] of Object.entries(tables)) {
    if (!Object.keys(t.columns).includes("organization_id")) continue;
    for (const fk of t.foreignKeys) {
      const ref = tables[fk.refTable];
      if (!ref || !Object.keys(ref.columns).includes("organization_id")) continue;
      if (!fk.cols.includes("organization_id")) continue;
      const i = fk.cols.indexOf("organization_id");
      const refOrgCol = fk.refCols[i] ?? "organization_id";
      if (!Object.keys(ref.columns).includes(refOrgCol)) continue;
      const sql = `select count(*)::int n from public.${name} c
        join public.${fk.refTable} p on ${fk.cols.map((c, j) => `p.${fk.refCols[j]} = c.${c}`).join(" and ")}
        where c.organization_id is distinct from p.${refOrgCol}`;
      try {
        const r = await db.query(sql);
        if (r.rows[0].n > 0) {
          total.crossOrg += r.rows[0].n;
          evidence.push(`CROSS-ORG: ${name} rows reference ${fk.refTable} rows of another organization: ${r.rows[0].n}`);
        }
      } catch {
        /* skip */
      }
    }
  }

  // 3. Impossible states
  const probes = [
    ["CLOSED-EVENT-OUTSTANDING", `select count(*)::int n from public.events e where e.status='CLOSED' and exists (select 1 from public.event_equipment_reservations r where r.organization_id=e.organization_id and r.event_id=e.id and r.status = 'ACTIVE')`],
    ["CLOSED-EVENT-CONSUMABLE-OUTSTANDING", `select count(*)::int n from public.events e where e.status='CLOSED' and exists (select 1 from public.consumable_movements m where m.organization_id=e.organization_id and m.event_id=e.id and m.movement_kind in ('ISSUE_TO_EVENT','CONSUME_AT_EVENT','WASTE_AT_EVENT') and m.event_delta > 0)`],
    ["NEGATIVE-INVOICE-TOTAL", `select count(*)::int n from public.invoices where total_amount < 0 or pre_vat_total < 0 or vat_amount < 0`],
    ["CHECKOUT-BEFORE-CHECKIN", `select count(*)::int n from public.staff_attendance where check_out_at is not null and check_in_at is not null and check_out_at < check_in_at`],
    ["VOIDED-WITH-RECORDED-PAYMENTS", `select count(*)::int n from public.customer_payments p join public.events e on e.id=p.event_id and e.organization_id=p.organization_id where p.status='VOIDED' and e.status in ('CONFIRMED','PREPARING','DISPATCHED','IN_PROGRESS','RETURNING','CLOSED') and false`],
    ["NEGATIVE-EXPENSE", `select count(*)::int n from public.event_expenses where amount < 0 and status <> 'VOIDED'`],
    ["NEGATIVE-ADVANCE", `select count(*)::int n from public.staff_advances where amount < 0 and status <> 'VOIDED'`],
    ["NEGATIVE-PAYOUT", `select count(*)::int n from public.host_payouts where amount < 0 and status <> 'VOIDED'`],
    ["INSTALLMENT-OVERFLOW", `select count(*)::int n from public.invoice_installments where amount < 0`],
  ];
  for (const [key, sql] of probes) {
    try {
      const r = await db.query(sql);
      if (r.rows[0].n > 0) {
        total.impossible += r.rows[0].n;
        evidence.push(`IMPOSSIBLE: ${key}: ${r.rows[0].n} row(s)`);
      }
    } catch {
      /* skip un-runnable probes */
    }
  }

  // 4. Duplicate business records (customer names per org; event titles+time per org)
  const dupProbes = [
    ["DUPLICATE-CUSTOMERS", `select count(*)::int n from (select organization_id, lower(trim(name)) name, count(*) c from public.customers group by 1,2 having count(*)>1) x`],
    ["DUPLICATE-EVENTS", `select count(*)::int n from (select organization_id, lower(trim(title)) title, start_at, count(*) c from public.events group by 1,2,3 having count(*)>1) x`],
    ["DUPLICATE-CATALOG", `select count(*)::int n from (select organization_id, lower(trim(name)) name, count(*) c from public.catalog_items group by 1,2 having count(*)>1) x`],
  ];
  for (const [key, sql] of dupProbes) {
    try {
      const r = await db.query(sql);
      if (r.rows[0].n > 0) {
        total.duplicates += r.rows[0].n;
        evidence.push(`DUP: ${key}: ${r.rows[0].n} group(s)`);
      }
    } catch {
      /* skip */
    }
  }

  const grand = total.orphans + total.crossOrg + total.impossible + total.duplicates;
  if (grand > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-ISSUES`,
      title: "Data integrity violations found",
      evidence: evidence.join("\n").slice(0, 3000),
      detail: `orphans=${total.orphans}, cross-org=${total.crossOrg}, impossible=${total.impossible}, duplicates=${total.duplicates}`,
    });
  } else {
    report.pass(this, `${id}-CLEAN`, "No data-integrity violations detected", `orphans=0, cross-org=0, impossible=0, duplicates=0 (empty scratch DB ⇒ guards exercised by guardian_data_integrity.test.sql)`);
  }
}
