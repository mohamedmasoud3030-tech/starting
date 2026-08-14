#!/usr/bin/env node
/**
 * REAL TWO-SESSION PROCUREMENT CONCURRENCY PROOF (S5A).
 *
 * Scenarios:
 *   1. two receipts contend for one remaining ordered quantity;
 *   2. physical receipt races cancellation;
 *   3. concurrent identical receipt retry;
 *   4. two stale lifecycle transitions race on one APPROVED order;
 *   5. order approval races supplier deactivation.
 *
 * Lock order under proof:
 *   idempotency advisory lock -> order row -> supplier row (approval only) ->
 *   S4B stock-item rows in UUID order. Supplier-only transitions never acquire
 *   an order lock, and no stock-first path waits for an order row.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_procurement_race";

const ORG = "a0000000-0000-0000-0000-0000000000a1";
const USER = "a0000000-0000-0000-0000-000000000001";
const SUPPLIER = "a0000000-0000-0000-0000-0000000000b1";
const RACE_SUPPLIER = "a0000000-0000-0000-0000-0000000000b2";
const CATALOG = "a0000000-0000-0000-0000-0000000000c1";
const STOCK = "a0000000-0000-0000-0000-0000000000d1";

const ORDER_OVER = "a0000000-0000-0000-0000-000000000101";
const ORDER_CANCEL = "a0000000-0000-0000-0000-000000000102";
const ORDER_RETRY = "a0000000-0000-0000-0000-000000000103";
const ORDER_SEND = "a0000000-0000-0000-0000-000000000104";
const ORDER_SUPPLIER = "a0000000-0000-0000-0000-000000000105";
const LINE_OVER = "a0000000-0000-0000-0000-000000000201";
const LINE_CANCEL = "a0000000-0000-0000-0000-000000000202";
const LINE_RETRY = "a0000000-0000-0000-0000-000000000203";
const LINE_SEND = "a0000000-0000-0000-0000-000000000204";
const LINE_SUPPLIER = "a0000000-0000-0000-0000-000000000205";
const JWT = `{"sub":"${USER}","role":"authenticated"}`;

let failures = 0;
function check(condition, description, detail = "") {
  if (condition) console.log(`  ✓ ${description}`);
  else {
    failures++;
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ""}`);
  }
}
function connect() {
  return new pg.Client({
    connectionString: dbUrl.replace(/\/postgres(\?|$)/, `/${dbName}$1`),
  });
}
async function beginSession(client) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(`set local "request.jwt.claims" = '${JWT}'`);
  await client.query("set local statement_timeout = '20s'");
}
async function race(a, b, sqlA, sqlB) {
  await beginSession(a);
  await beginSession(b);
  const state = [
    { client: a, settled: null },
    { client: b, settled: null },
  ];
  const promises = [sqlA, sqlB].map((sql, i) =>
    state[i].client
      .query(sql)
      .then((value) => {
        state[i].settled = { status: "fulfilled", value };
        return i;
      })
      .catch((reason) => {
        state[i].settled = { status: "rejected", reason };
        return i;
      }),
  );
  const first = await Promise.race(promises);
  await state[first].client.query(
    state[first].settled.status === "fulfilled" ? "commit" : "rollback",
  );
  await Promise.all(promises);
  const second = first === 0 ? 1 : 0;
  await state[second].client.query(
    state[second].settled.status === "fulfilled" ? "commit" : "rollback",
  );
  return state.map((entry) => entry.settled);
}

async function seed(db) {
  await db.query(`
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated','proc-race@test.local','x',now(),now(),now(),'{}','{}',false);
    insert into public.organizations(id,name) values('${ORG}','Procurement Race Org');
    insert into public.organization_memberships(organization_id,user_id,role) values('${ORG}','${USER}','OWNER');
    insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
      ('${SUPPLIER}','${ORG}','Stable Supplier','ACTIVE','${USER}','${USER}'),
      ('${RACE_SUPPLIER}','${ORG}','Lifecycle Supplier','ACTIVE','${USER}','${USER}');
    insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price)
      values('${CATALOG}','${ORG}','Coffee','CONSUMABLE','kg','PER_UNIT',1,2);
    insert into public.consumable_stock_items(id,organization_id,catalog_item_id,created_by)
      values('${STOCK}','${ORG}','${CATALOG}','${USER}');

    insert into public.procurement_orders(id,organization_id,supplier_id,order_number,order_date,status,created_by,updated_by) values
      ('${ORDER_OVER}','${ORG}','${SUPPLIER}','PO-RACE-1',current_date,'DRAFT','${USER}','${USER}'),
      ('${ORDER_CANCEL}','${ORG}','${SUPPLIER}','PO-RACE-2',current_date,'DRAFT','${USER}','${USER}'),
      ('${ORDER_RETRY}','${ORG}','${SUPPLIER}','PO-RACE-3',current_date,'DRAFT','${USER}','${USER}'),
      ('${ORDER_SEND}','${ORG}','${SUPPLIER}','PO-RACE-4',current_date,'DRAFT','${USER}','${USER}'),
      ('${ORDER_SUPPLIER}','${ORG}','${RACE_SUPPLIER}','PO-RACE-5',current_date,'DRAFT','${USER}','${USER}');
    insert into public.procurement_order_lines(id,organization_id,order_id,line_kind,catalog_item_id,stock_item_id,description,unit,quantity,agreed_unit_cost,agreed_total_cost) values
      ('${LINE_OVER}','${ORG}','${ORDER_OVER}','CATERING_SERVICE',null,null,'Service','job',5,1,5),
      ('${LINE_CANCEL}','${ORG}','${ORDER_CANCEL}','CONSUMABLE','${CATALOG}','${STOCK}','Coffee','kg',5,1,5),
      ('${LINE_RETRY}','${ORG}','${ORDER_RETRY}','CONSUMABLE','${CATALOG}','${STOCK}','Coffee','kg',5,1,5),
      ('${LINE_SEND}','${ORG}','${ORDER_SEND}','OTHER',null,null,'Other','unit',1,1,1),
      ('${LINE_SUPPLIER}','${ORG}','${ORDER_SUPPLIER}','OTHER',null,null,'Other','unit',1,1,1);
    update public.procurement_orders set
      status='APPROVED', agreed_total_cost=case when id='${ORDER_SEND}' then 1 else 5 end,
      supplier_name_snapshot='Stable Supplier',approved_by='${USER}',approved_at=now()
    where id in ('${ORDER_OVER}','${ORDER_CANCEL}','${ORDER_RETRY}','${ORDER_SEND}');
    update public.procurement_orders set
      status='SENT',sent_by='${USER}',sent_at=now()
    where id in ('${ORDER_OVER}','${ORDER_CANCEL}','${ORDER_RETRY}');
    update public.procurement_orders set
      status='CONFIRMED',confirmed_by='${USER}',confirmed_at=now()
    where id in ('${ORDER_OVER}','${ORDER_CANCEL}','${ORDER_RETRY}');
    update public.procurement_orders set agreed_total_cost=1 where id='${ORDER_SUPPLIER}';
  `);
}

function receive(order, line, quantity, reference, key) {
  return `select public.receive_procurement_order(
    '${ORG}','${order}','2026-08-14T12:00:00Z','${reference}',null,
    jsonb_build_array(jsonb_build_object('order_line_id','${line}','quantity','${quantity}')),
    '${key}')`;
}

async function main() {
  const admin = new pg.Client({ connectionString: dbUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const db = connect();
  await db.connect();
  await db.query(readFileSync(join(__dirname, "setup_auth.sql"), "utf8"));
  for (const migration of readdirSync(join(root, "supabase", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.query(readFileSync(join(root, "supabase", "migrations", migration), "utf8"));
  }
  await seed(db);

  const a = connect();
  const b = connect();
  await a.connect();
  await b.connect();
  console.log("\n== Two-session procurement concurrency proof ==\n");

  console.log("[1] two receipt(4.000) commands against ordered 5.000");
  const over = await race(
    a,
    b,
    receive(ORDER_OVER, LINE_OVER, "4.000", "OVER-A", "a1000000-0000-0000-0000-000000000001"),
    receive(ORDER_OVER, LINE_OVER, "4.000", "OVER-B", "a1000000-0000-0000-0000-000000000002"),
  );
  check(over.filter((x) => x.status === "fulfilled").length === 1, "exactly one receipt wins the remaining quantity");
  check(
    over.filter((x) => x.status === "rejected").every((x) => /PROCUREMENT_OVER_RECEIPT/.test(x.reason.message)),
    "losing receipt fails with PROCUREMENT_OVER_RECEIPT",
    over.filter((x) => x.status === "rejected").map((x) => x.reason.message).join(" | "),
  );
  const overTotal = await db.query("select sum(quantity)::text value from public.procurement_receipt_lines where order_id=$1", [ORDER_OVER]);
  check(overTotal.rows[0].value === "4.000", `cumulative receipt is exactly 4.000 (got ${overTotal.rows[0].value})`);

  console.log("\n[2] consumable receipt races order cancellation");
  const cancelRace = await race(
    a,
    b,
    receive(ORDER_CANCEL, LINE_CANCEL, "2.000", "CANCEL-RACE", "a1000000-0000-0000-0000-000000000011"),
    `select public.cancel_procurement_order('${ORG}','${ORDER_CANCEL}','supplier stopped delivery','a1000000-0000-0000-0000-000000000012')`,
  );
  check(cancelRace[1].status === "fulfilled", "cancellation completes without deadlock");
  const cancelState = await db.query(`select status::text from public.procurement_orders where id=$1`, [ORDER_CANCEL]);
  check(cancelState.rows[0].status === "CANCELLED", "aggregate is terminally CANCELLED");
  const cancelFacts = await db.query(`select
      (select count(*)::int from public.procurement_receipt_lines where order_id=$1) receipts,
      (select count(*)::int from public.consumable_movements m join public.procurement_receipt_lines rl on rl.consumable_movement_id=m.id where rl.order_id=$1) movements`, [ORDER_CANCEL]);
  check(cancelFacts.rows[0].receipts === cancelFacts.rows[0].movements, "every winning physical receipt retains exactly one linked RECEIVE movement");
  check([0, 1].includes(cancelFacts.rows[0].receipts), "receipt linearizes entirely before or after cancellation");

  console.log("\n[3] concurrent identical consumable receipt retry");
  const retrySql = receive(ORDER_RETRY, LINE_RETRY, "2.500", "RETRY", "a1000000-0000-0000-0000-000000000021");
  const retry = await race(a, b, retrySql, retrySql);
  check(retry.every((x) => x.status === "fulfilled"), "both identical callers receive a successful replay");
  const retryFacts = await db.query(`select
      (select count(*)::int from public.procurement_receipts where order_id=$1) receipts,
      (select count(*)::int from public.procurement_receipt_lines where order_id=$1) lines,
      (select count(*)::int from public.consumable_movements m join public.procurement_receipt_lines rl on rl.consumable_movement_id=m.id where rl.order_id=$1) movements,
      (select count(*)::int from public.audit_events where metadata->>'idempotency_key'='a1000000-0000-0000-0000-000000000021') audits`, [ORDER_RETRY]);
  check(retryFacts.rows[0].receipts === 1, "identical retry creates one receipt");
  check(retryFacts.rows[0].lines === 1 && retryFacts.rows[0].movements === 1, "identical retry creates one receipt line and one stock movement");
  check(retryFacts.rows[0].audits === 1, "identical retry creates one parent audit event");

  console.log("\n[4] two stale SEND transitions race on one APPROVED order");
  const sendRace = await race(
    a,
    b,
    `select public.send_procurement_order('${ORG}','${ORDER_SEND}','a1000000-0000-0000-0000-000000000031')`,
    `select public.send_procurement_order('${ORG}','${ORDER_SEND}','a1000000-0000-0000-0000-000000000032')`,
  );
  check(sendRace.filter((x) => x.status === "fulfilled").length === 1, "exactly one stale lifecycle transition wins");
  check(sendRace.filter((x) => x.status === "rejected").every((x) => /INVALID_PROCUREMENT_ORDER_TRANSITION/.test(x.reason.message)), "losing lifecycle transition observes committed state");
  const sendState = await db.query(`select status::text from public.procurement_orders where id=$1`, [ORDER_SEND]);
  check(sendState.rows[0].status === "SENT", "order reaches SENT exactly once");

  console.log("\n[5] approval races supplier deactivation");
  const supplierRace = await race(
    a,
    b,
    `select public.approve_procurement_order('${ORG}','${ORDER_SUPPLIER}','a1000000-0000-0000-0000-000000000041')`,
    `select public.set_supplier_status('${ORG}','${RACE_SUPPLIER}','INACTIVE','a1000000-0000-0000-0000-000000000042')`,
  );
  check(supplierRace[1].status === "fulfilled", "supplier deactivation completes without deadlock");
  const supplierState = await db.query(`select o.status::text,s.status::text supplier_status,o.supplier_name_snapshot from public.procurement_orders o join public.suppliers s on s.id=o.supplier_id where o.id=$1`, [ORDER_SUPPLIER]);
  const approvalWon = supplierRace[0].status === "fulfilled";
  check(
    (approvalWon && supplierState.rows[0].status === "APPROVED" && supplierState.rows[0].supplier_name_snapshot === "Lifecycle Supplier") ||
      (!approvalWon && supplierState.rows[0].status === "DRAFT" && /SUPPLIER_NOT_ACTIVE/.test(supplierRace[0].reason.message)),
    "approval either snapshots active supplier first or rejects after deactivation",
  );
  check(supplierState.rows[0].supplier_status === "INACTIVE", "supplier lifecycle ends INACTIVE without rewriting an approved snapshot");

  const duplicateKeys = await db.query(`select count(*)::int n from (
    select idempotency_key from public.procurement_command_idempotency
    group by organization_id,idempotency_key having count(*)>1
  ) d`);
  check(duplicateKeys.rows[0].n === 0, "no concurrency race duplicates a command key");

  await a.end();
  await b.end();
  await db.end();
  if (failures) {
    console.log(`\nPROCUREMENT CONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nPROCUREMENT CONCURRENCY PROOF: PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
