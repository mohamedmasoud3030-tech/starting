#!/usr/bin/env node
/**
 * REAL TWO-SESSION PROCUREMENT LIFECYCLE SERIALIZATION PROOF (S5A hardening).
 *
 * Proves that supplier deactivation and Event cancellation cannot race past
 * create/update/approval on stale ACTIVE/procureable snapshots.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_procurement_lifecycle_race";

const ORG = "a3000000-0000-0000-0000-0000000000a1";
const USER = "a3000000-0000-0000-0000-000000000001";
const SUPPLIER_A = "a3000000-0000-0000-0000-0000000000b1";
const SUPPLIER_B = "a3000000-0000-0000-0000-0000000000b2";
const SUPPLIER_C = "a3000000-0000-0000-0000-0000000000b3";
const CUSTOMER = "a3000000-0000-0000-0000-0000000000c1";
const EVENT_CREATE = "a3000000-0000-0000-0000-0000000000e1";
const EVENT_UPDATE = "a3000000-0000-0000-0000-0000000000e2";
const EVENT_APPROVE = "a3000000-0000-0000-0000-0000000000e3";
const ORDER_UPDATE = "a3000000-0000-0000-0000-000000000101";
const ORDER_APPROVE = "a3000000-0000-0000-0000-000000000102";
const JWT = `{"sub":"${USER}","role":"authenticated"}`;

let failures = 0;
function check(ok, description, detail = "") {
  if (ok) console.log(`  ✓ ${description}`);
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

async function beginAuth(client) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(`set local "request.jwt.claims" = '${JWT}'`);
  await client.query("set local statement_timeout = '20s'");
}

async function isStillPending(promise, delayMs = 250) {
  const marker = Symbol("pending");
  const result = await Promise.race([
    promise.then(() => "fulfilled", () => "rejected"),
    new Promise((resolve) => setTimeout(() => resolve(marker), delayMs)),
  ]);
  return result === marker;
}

async function settle(client, promise) {
  try {
    const value = await promise;
    await client.query("commit");
    return { status: "fulfilled", value };
  } catch (reason) {
    await client.query("rollback");
    return { status: "rejected", reason };
  }
}

function createOrder(supplierId, eventId, key, notes) {
  return `select public.create_procurement_order(
    '${ORG}','${supplierId}',${eventId ? `'${eventId}'` : "null"},current_date,null,
    '${notes}','[]'::jsonb,'${key}')`;
}

function updateOrder(orderId, supplierId, eventId, key, notes) {
  return `select public.update_procurement_order(
    '${ORG}','${orderId}','${supplierId}',${eventId ? `'${eventId}'` : "null"},current_date,null,
    '${notes}','[]'::jsonb,'${key}')`;
}

async function seed(db) {
  await db.query(`
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
      email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated',
      'procurement-lifecycle-race@test.local','x',now(),now(),now(),'{}','{}',false);

    insert into public.organizations(id,name) values('${ORG}','Procurement Lifecycle Race Org');
    insert into public.organization_memberships(organization_id,user_id,role)
      values('${ORG}','${USER}','OWNER');
    insert into public.customers(id,organization_id,name)
      values('${CUSTOMER}','${ORG}','Race Customer');

    insert into public.suppliers(id,organization_id,name,status,created_by,updated_by) values
      ('${SUPPLIER_A}','${ORG}','Supplier A','ACTIVE','${USER}','${USER}'),
      ('${SUPPLIER_B}','${ORG}','Supplier B','ACTIVE','${USER}','${USER}'),
      ('${SUPPLIER_C}','${ORG}','Supplier C','ACTIVE','${USER}','${USER}');

    insert into public.events(
      id,organization_id,customer_id,event_number,title,start_at,end_at,
      guest_count,venue_name,status,idempotency_key,created_by,updated_by
    ) values
      ('${EVENT_CREATE}','${ORG}','${CUSTOMER}','EV-RACE-1','Create Race',now()+interval '2 days',now()+interval '2 days 4 hours',50,'Muscat','CONFIRMED','a3000000-0000-0000-0000-000000000201','${USER}','${USER}'),
      ('${EVENT_UPDATE}','${ORG}','${CUSTOMER}','EV-RACE-2','Update Race',now()+interval '3 days',now()+interval '3 days 4 hours',50,'Muscat','CONFIRMED','a3000000-0000-0000-0000-000000000202','${USER}','${USER}'),
      ('${EVENT_APPROVE}','${ORG}','${CUSTOMER}','EV-RACE-3','Approve Race',now()+interval '4 days',now()+interval '4 days 4 hours',50,'Muscat','CONFIRMED','a3000000-0000-0000-0000-000000000203','${USER}','${USER}');

    insert into public.procurement_orders(
      id,organization_id,supplier_id,event_id,order_number,order_date,status,
      created_by,updated_by
    ) values
      ('${ORDER_UPDATE}','${ORG}','${SUPPLIER_B}','${EVENT_UPDATE}','PO-RACE-U',current_date,'DRAFT','${USER}','${USER}'),
      ('${ORDER_APPROVE}','${ORG}','${SUPPLIER_C}','${EVENT_APPROVE}','PO-RACE-A',current_date,'DRAFT','${USER}','${USER}');

    insert into public.procurement_order_lines(
      organization_id,order_id,line_kind,description,unit,quantity,
      agreed_unit_cost,agreed_total_cost
    ) values(
      '${ORG}','${ORDER_APPROVE}','OTHER','Approval line','unit',1,1,1
    );
    update public.procurement_orders set agreed_total_cost=1 where id='${ORDER_APPROVE}';
  `);
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

  console.log("\n== Procurement supplier/Event lifecycle concurrency proof ==\n");

  console.log("[1] supplier deactivation commits before create");
  await beginAuth(a);
  await a.query(`select public.set_supplier_status(
    '${ORG}','${SUPPLIER_A}','INACTIVE','a3000000-0000-0000-0000-000000000301')`);
  await beginAuth(b);
  const createAfterDeactivate = b.query(createOrder(
    SUPPLIER_A,
    null,
    "a3000000-0000-0000-0000-000000000302",
    "supplier-deactivate-first",
  ));
  check(
    await isStillPending(createAfterDeactivate),
    "create waits for the supplier lifecycle lock",
  );
  await a.query("commit");
  const createAfterDeactivateResult = await settle(b, createAfterDeactivate);
  check(
    createAfterDeactivateResult.status === "rejected" &&
      /SUPPLIER_NOT_ACTIVE/.test(createAfterDeactivateResult.reason?.message ?? ""),
    "create rejects the supplier state that actually committed first",
    createAfterDeactivateResult.reason?.message,
  );

  console.log("\n[2] create commits before supplier deactivation");
  await db.query(`update public.suppliers set status='ACTIVE' where id='${SUPPLIER_A}'`);
  await beginAuth(b);
  await b.query(createOrder(
    SUPPLIER_A,
    null,
    "a3000000-0000-0000-0000-000000000303",
    "create-first",
  ));
  await beginAuth(a);
  const deactivateAfterCreate = a.query(`select public.set_supplier_status(
    '${ORG}','${SUPPLIER_A}','INACTIVE','a3000000-0000-0000-0000-000000000304')`);
  check(
    await isStillPending(deactivateAfterCreate),
    "deactivation waits while create owns the supplier lifecycle lock",
  );
  await b.query("commit");
  const deactivateAfterCreateResult = await settle(a, deactivateAfterCreate);
  check(
    deactivateAfterCreateResult.status === "fulfilled",
    "deactivation succeeds after the earlier create commits",
    deactivateAfterCreateResult.reason?.message,
  );
  const createFirstState = await db.query(`select
      (select count(*)::int from public.procurement_orders where notes='create-first') orders,
      (select status::text from public.suppliers where id=$1) supplier_status`, [SUPPLIER_A]);
  check(
    createFirstState.rows[0].orders === 1 && createFirstState.rows[0].supplier_status === "INACTIVE",
    "final state is linearizable: order first, then supplier inactive",
    JSON.stringify(createFirstState.rows[0]),
  );

  console.log("\n[3] Event cancellation commits before create");
  await beginAuth(a);
  await a.query(`select public.cancel_event(
    '${ORG}','${EVENT_CREATE}','event cancelled','a3000000-0000-0000-0000-000000000311')`);
  await beginAuth(b);
  const createAfterCancel = b.query(createOrder(
    SUPPLIER_B,
    EVENT_CREATE,
    "a3000000-0000-0000-0000-000000000312",
    "event-cancel-first",
  ));
  check(
    await isStillPending(createAfterCancel),
    "create waits for the Event lifecycle lock",
  );
  await a.query("commit");
  const createAfterCancelResult = await settle(b, createAfterCancel);
  check(
    createAfterCancelResult.status === "rejected" &&
      /EVENT_NOT_PROCUREABLE/.test(createAfterCancelResult.reason?.message ?? ""),
    "create rejects the Event state that actually committed first",
    createAfterCancelResult.reason?.message,
  );

  console.log("\n[4] Event cancellation commits before draft update");
  await beginAuth(a);
  await a.query(`select public.cancel_event(
    '${ORG}','${EVENT_UPDATE}','event cancelled','a3000000-0000-0000-0000-000000000321')`);
  await beginAuth(b);
  const updateAfterCancel = b.query(updateOrder(
    ORDER_UPDATE,
    SUPPLIER_B,
    EVENT_UPDATE,
    "a3000000-0000-0000-0000-000000000322",
    "stale-event-update",
  ));
  check(
    await isStillPending(updateAfterCancel),
    "draft update waits for the Event lifecycle lock",
  );
  await a.query("commit");
  const updateAfterCancelResult = await settle(b, updateAfterCancel);
  check(
    updateAfterCancelResult.status === "rejected" &&
      /EVENT_NOT_PROCUREABLE/.test(updateAfterCancelResult.reason?.message ?? ""),
    "draft update cannot commit against a cancelled Event snapshot",
    updateAfterCancelResult.reason?.message,
  );

  console.log("\n[5] Event cancellation commits before approval");
  await beginAuth(a);
  await a.query(`select public.cancel_event(
    '${ORG}','${EVENT_APPROVE}','event cancelled','a3000000-0000-0000-0000-000000000331')`);
  await beginAuth(b);
  const approveAfterCancel = b.query(`select public.approve_procurement_order(
    '${ORG}','${ORDER_APPROVE}','a3000000-0000-0000-0000-000000000332')`);
  check(
    await isStillPending(approveAfterCancel),
    "approval waits for the Event lifecycle lock at the order write edge",
  );
  await a.query("commit");
  const approveAfterCancelResult = await settle(b, approveAfterCancel);
  check(
    approveAfterCancelResult.status === "rejected" &&
      /EVENT_NOT_PROCUREABLE/.test(approveAfterCancelResult.reason?.message ?? ""),
    "approval cannot commit after Event cancellation wins",
    approveAfterCancelResult.reason?.message,
  );

  const staleOrders = await db.query(`select count(*)::int n
    from public.procurement_orders o
    join public.events e on e.organization_id=o.organization_id and e.id=o.event_id
    where o.organization_id=$1 and e.status='CANCELLED'
      and o.status='APPROVED'`, [ORG]);
  check(
    staleOrders.rows[0].n === 0,
    "no approval created from a stale cancelled-Event snapshot",
    `stale approvals=${staleOrders.rows[0].n}`,
  );

  await a.end();
  await b.end();
  await db.end();

  if (failures > 0) {
    console.log(`\nPROCUREMENT LIFECYCLE CONCURRENCY PROOF: ${failures} FAILED`);
    process.exit(1);
  }
  console.log("\nPROCUREMENT LIFECYCLE CONCURRENCY PROOF: PASSED");
}

main().catch((error) => {
  console.error("PROCUREMENT LIFECYCLE CONCURRENCY PROOF: FATAL");
  console.error(error);
  process.exit(1);
});
