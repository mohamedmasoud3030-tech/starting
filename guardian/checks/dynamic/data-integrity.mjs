#!/usr/bin/env node
/**
 * Data-integrity probes on the isolated scratch replay.
 *
 * This check validates that integrity queries themselves remain executable and
 * that migration-created/seeded rows do not violate core invariants. Rich
 * behavior is exercised with fixtures in guardian_data_integrity.test.sql.
 *
 * It intentionally does NOT claim to inspect production/live data: the
 * Guardian dynamic runner is scratch-only and rejects remote DB hosts.
 */
import { extractManifest } from "../../lib/manifest.mjs";

export const id = "G-DATA-INTEGRITY";
export const title = "Data integrity: FK orphans and impossible operational states";
export const category = "data";
export const defaultSeverity = "HIGH";
export const mode = "dynamic";

export async function run(ctx) {
  const { report, db } = ctx;
  const manifest = await extractManifest(db);
  const tables = manifest.tables;

  const total = { orphans: 0, impossible: 0 };
  const evidence = [];

  // 1. Orphan / broken FK references. Query failures are NOT swallowed: if the
  // manifest and generated SQL disagree, the check must fail rather than emit
  // a false green. The unified runner turns that exception into CRITICAL.
  for (const [name, t] of Object.entries(tables)) {
    for (const fk of t.foreignKeys) {
      if (!tables[fk.refTable]) continue;
      if (fk.cols.length === 0 || fk.cols.length !== fk.refCols.length) {
        throw new Error(
          `INVALID_FK_MANIFEST: ${name}.${fk.name} has ${fk.cols.length} child column(s) and ${fk.refCols.length} parent column(s)`,
        );
      }

      const missingChild = fk.cols.filter((c) => !t.columns[c]);
      const missingParent = fk.refCols.filter((c) => !tables[fk.refTable].columns[c]);
      if (missingChild.length > 0 || missingParent.length > 0) {
        throw new Error(
          `INVALID_FK_MANIFEST: ${name}.${fk.name} references missing columns child=[${missingChild.join(",")}] parent=[${missingParent.join(",")}]`,
        );
      }

      const childCols = fk.cols.join(", ");
      const parentCols = fk.refCols.join(", ");
      const sql = `select count(*)::int n
        from public.${name} c
        left join public.${fk.refTable} p
          on ${fk.cols.map((c, i) => `p.${fk.refCols[i]} = c.${c}`).join(" and ")}
        where ${fk.cols.map((c) => `c.${c} is not null`).join(" and ")}
          and p.${fk.refCols[0]} is null`;
      const r = await db.query(sql);
      if (r.rows[0].n > 0) {
        total.orphans += r.rows[0].n;
        evidence.push(
          `ORPHAN: ${name}(${childCols}) → ${fk.refTable}(${parentCols}): ${r.rows[0].n} row(s)`,
        );
      }
    }
  }

  // 2. Impossible states. Only invariants with clear domain semantics belong
  // here; fuzzy duplicate-name heuristics were removed because two customers
  // or catalog items can legitimately share a display name.
  const probes = [
    [
      "CLOSED-EVENT-EQUIPMENT-OUTSTANDING",
      `select count(*)::int n
         from public.events e
        where e.status='CLOSED'
          and exists (
            select 1
              from public.event_equipment_reservations r
             where r.organization_id=e.organization_id
               and r.event_id=e.id
               and r.status='ACTIVE'
          )`,
    ],
    [
      "CLOSED-EVENT-CONSUMABLE-OUTSTANDING",
      `select count(*)::int n
         from public.events e
        where e.status='CLOSED'
          and exists (
            select 1
              from public.consumable_movements m
             where m.organization_id=e.organization_id
               and m.event_id=e.id
             group by m.stock_item_id
            having coalesce(sum(m.event_delta),0) > 0
          )`,
    ],
    [
      "NEGATIVE-INVOICE-TOTAL",
      `select count(*)::int n
         from public.invoices
        where total_amount < 0 or pre_vat_total < 0 or vat_amount < 0`,
    ],
    [
      "CHECKOUT-BEFORE-CHECKIN",
      `select count(*)::int n
         from public.staff_attendance
        where check_out_at is not null
          and check_in_at is not null
          and check_out_at < check_in_at`,
    ],
    [
      "NEGATIVE-EXPENSE",
      `select count(*)::int n
         from public.event_expenses
        where amount < 0 and status <> 'VOIDED'`,
    ],
    [
      "NEGATIVE-ADVANCE",
      `select count(*)::int n
         from public.staff_advances
        where amount < 0 and status <> 'VOIDED'`,
    ],
    [
      "NEGATIVE-PAYOUT",
      `select count(*)::int n
         from public.host_payouts
        where amount < 0 and status <> 'VOIDED'`,
    ],
    [
      "NEGATIVE-INSTALLMENT",
      `select count(*)::int n
         from public.invoice_installments
        where amount < 0`,
    ],
  ];

  for (const [key, sql] of probes) {
    const r = await db.query(sql);
    if (r.rows[0].n > 0) {
      total.impossible += r.rows[0].n;
      evidence.push(`IMPOSSIBLE: ${key}: ${r.rows[0].n} row(s)`);
    }
  }

  const grand = total.orphans + total.impossible;
  if (grand > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-ISSUES`,
      title: "Data-integrity violations found in the scratch replay",
      evidence: evidence.join("\n").slice(0, 3000),
      detail: `orphans=${total.orphans}, impossible=${total.impossible}`,
    });
  } else {
    report.pass(
      this,
      `${id}-CLEAN`,
      "No data-integrity violations detected in the scratch replay",
      "orphans=0, impossible=0; behavior guards are exercised by guardian_data_integrity.test.sql",
    );
  }
}
