#!/usr/bin/env node
/**
 * TWO-SESSION WAREHOUSE CONCURRENCY PROOF.
 *
 * pgTAP is authoritative for schema/RLS assertions but executes inside one
 * transaction. This harness uses two real PostgreSQL sessions to prove the
 * interleavings that a single-transaction test cannot create.
 *
 * Scenarios
 *   1. same-reservation over-dispatch race
 *   2. same-reservation over-return race
 *   3. concurrent identical idempotent replay
 *   4. DIFFERENT Events/reservations sharing one physical capacity
 *   5. dispatch versus final reconciliation on the same Event
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_warehouse_race";

const ORG = "60000000-0000-0000-0000-0000000000a1";
const USER = "60000000-0000-0000-0000-000000000001";
const EVENT = "60000000-0000-0000-0000-000000000f01";
const RESERVATION = "60000000-0000-0000-0000-000000000a01";
const CAPACITY = "60000000-0000-0000-0000-0000000000e1";

const EVENT_CAP_A = "60000000-0000-0000-0000-000000000f11";
const EVENT_CAP_B = "60000000-0000-0000-0000-000000000f12";
const RES_CAP_A = "60000000-0000-0000-0000-000000000a11";
const RES_CAP_B = "60000000-0000-0000-0000-000000000a12";
const CAPACITY_SHARED = "60000000-0000-0000-0000-0000000000e2";

const EVENT_CLOSE = "60000000-0000-0000-0000-000000000f21";
const RES_CLOSE = "60000000-0000-0000-0000-000000000a21";
const CAPACITY_CLOSE = "60000000-0000-0000-0000-0000000000e3";

const JWT = `{"sub":"${USER}","role":"authenticated"}`;

let failures = 0;
function check(ok, description, detail) {
  if (ok) {
    console.log(`  ✓ ${description}`);
  } else {
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

/**
 * Issue both SQL statements before either transaction commits. The first
 * statement to settle is committed (or rolled back if it failed), releasing
 * the shared row lock so the second can continue against the committed truth.
 */
async function race(clientA, clientB, sqlA, sqlB) {
  await beginSession(clientA);
  await beginSession(clientB);

  const state = [
    { client: clientA, settled: null },
    { client: clientB, settled: null },
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

  const firstIndex = await Promise.race(promises);
  await state[firstIndex].client.query(
    state[firstIndex].settled.status === "fulfilled" ? "commit" : "rollback",
  );

  await Promise.all(promises);
  const secondIndex = firstIndex === 0 ? 1 : 0;
  await state[secondIndex].client.query(
    state[secondIndex].settled.status === "fulfilled" ? "commit" : "rollback",
  );

  return state.map((s) => s.settled);
}

async function seed(db) {
  await db.query(`
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
      email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated',
      'race@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

    insert into public.organizations(id,name) values('${ORG}','Race Org');
    insert into public.organization_memberships(organization_id,user_id,role)
      values('${ORG}','${USER}','OWNER');
    insert into public.customers(id,organization_id,name)
      values('60000000-0000-0000-0000-0000000000c1','${ORG}','Customer');

    insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
      ('60000000-0000-0000-0000-0000000000d1','${ORG}','Chairs','REUSABLE_EQUIPMENT','piece','PER_UNIT',4.250,9.000),
      ('60000000-0000-0000-0000-0000000000d2','${ORG}','Shared tables','REUSABLE_EQUIPMENT','piece','PER_UNIT',5.000,10.000),
      ('60000000-0000-0000-0000-0000000000d3','${ORG}','Close-race item','REUSABLE_EQUIPMENT','piece','PER_UNIT',6.000,12.000);

    insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity) values
      ('${CAPACITY}','${ORG}','60000000-0000-0000-0000-0000000000d1',100),
      ('${CAPACITY_SHARED}','${ORG}','60000000-0000-0000-0000-0000000000d2',10),
      ('${CAPACITY_CLOSE}','${ORG}','60000000-0000-0000-0000-0000000000d3',10);

    insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,
      guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
      ('${EVENT}','${ORG}','60000000-0000-0000-0000-0000000000c1','EV-RACE-1','Same reservation race',
        '2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Muscat','PREPARING',
        '61000000-0000-0000-0000-000000000001','${USER}','${USER}'),
      ('${EVENT_CAP_A}','${ORG}','60000000-0000-0000-0000-0000000000c1','EV-RACE-11','Capacity A',
        '2026-10-11 10:00+04','2026-10-11 20:00+04',50,'Muscat','PREPARING',
        '61000000-0000-0000-0000-000000000011','${USER}','${USER}'),
      ('${EVENT_CAP_B}','${ORG}','60000000-0000-0000-0000-0000000000c1','EV-RACE-12','Capacity B',
        '2026-10-12 10:00+04','2026-10-12 20:00+04',50,'Muscat','PREPARING',
        '61000000-0000-0000-0000-000000000012','${USER}','${USER}'),
      ('${EVENT_CLOSE}','${ORG}','60000000-0000-0000-0000-0000000000c1','EV-RACE-21','Close race',
        '2026-10-21 10:00+04','2026-10-21 20:00+04',50,'Muscat','PREPARING',
        '61000000-0000-0000-0000-000000000021','${USER}','${USER}');

    insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,
      quantity,reserved_from,reserved_until,idempotency_key,created_by) values
      ('${RESERVATION}','${ORG}','${EVENT}','${CAPACITY}',10,
        '2026-10-01 10:00+04','2026-10-01 20:00+04','62000000-0000-0000-0000-000000000001','${USER}'),
      ('${RES_CAP_A}','${ORG}','${EVENT_CAP_A}','${CAPACITY_SHARED}',10,
        '2026-10-11 10:00+04','2026-10-11 20:00+04','62000000-0000-0000-0000-000000000011','${USER}'),
      ('${RES_CAP_B}','${ORG}','${EVENT_CAP_B}','${CAPACITY_SHARED}',10,
        '2026-10-12 10:00+04','2026-10-12 20:00+04','62000000-0000-0000-0000-000000000012','${USER}'),
      ('${RES_CLOSE}','${ORG}','${EVENT_CLOSE}','${CAPACITY_CLOSE}',1,
        '2026-10-21 10:00+04','2026-10-21 20:00+04','62000000-0000-0000-0000-000000000021','${USER}');
  `);
}

async function derived(db, column, reservation = RESERVATION) {
  const r = await db.query(
    `select coalesce(sum(${column}),0)::int as v
       from public.event_equipment_movements
      where organization_id = $1 and reservation_id = $2`,
    [ORG, reservation],
  );
  return r.rows[0].v;
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
  await db.query(readFileSync(join(__dirname, "setup_storage.sql"), "utf8"));
  for (const m of readdirSync(join(root, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.query(readFileSync(join(root, "supabase", "migrations", m), "utf8"));
  }
  await seed(db);

  console.log("\n== Two-session warehouse concurrency proof ==\n");

  const a = connect();
  const b = connect();
  await a.connect();
  await b.connect();

  // ---- 1. Same-reservation over-dispatch race --------------------------
  console.log("[1] over-dispatch race: 2 x dispatch(6) against reservation 10");
  const dispatch = (key) =>
    `select public.dispatch_event_equipment('${ORG}','${EVENT}','${RESERVATION}',6,null,null,'${key}')`;
  const settled = await race(
    a,
    b,
    dispatch("63000000-0000-0000-0000-000000000001"),
    dispatch("63000000-0000-0000-0000-000000000002"),
  );
  const ok1 = settled.filter((s) => s.status === "fulfilled").length;
  const rejected = settled.filter((s) => s.status === "rejected");
  check(ok1 === 1, `exactly one concurrent dispatch succeeded (got ${ok1})`);
  check(
    rejected.every((r) => /DISPATCH_EXCEEDS_RESERVATION|could not serialize|deadlock/i.test(r.reason.message)),
    "the losing dispatch failed with the reservation invariant",
    rejected.map((r) => r.reason.message).join(" | "),
  );
  check((await derived(db, "dispatched_quantity")) === 6, "dispatched quantity is 6, never 12");

  // ---- 2. Same-reservation over-return race ----------------------------
  console.log("\n[2] over-return race: 2 x return(6) against 6 outstanding");
  const ret = (key) =>
    `select public.return_event_equipment('${ORG}','${EVENT}','${RESERVATION}',6,0,0,null,null,'${key}')`;
  const settled2 = await race(
    a,
    b,
    ret("63000000-0000-0000-0000-000000000011"),
    ret("63000000-0000-0000-0000-000000000012"),
  );
  const ok2 = settled2.filter((s) => s.status === "fulfilled").length;
  const rejected2 = settled2.filter((s) => s.status === "rejected");
  check(ok2 === 1, `exactly one concurrent return succeeded (got ${ok2})`);
  check(
    rejected2.every((r) => /RETURN_EXCEEDS_OUTSTANDING|could not serialize|deadlock/i.test(r.reason.message)),
    "the losing return failed with the outstanding invariant",
    rejected2.map((r) => r.reason.message).join(" | "),
  );
  check((await derived(db, "returned_good_quantity")) === 6, "returned-good quantity is 6, never 12");

  // ---- 3. Concurrent idempotent replay ---------------------------------
  console.log("\n[3] idempotent replay race: same key and payload in both sessions");
  const sameKey = "63000000-0000-0000-0000-000000000021";
  const dup = `select public.dispatch_event_equipment('${ORG}','${EVENT}','${RESERVATION}',2,null,null,'${sameKey}')`;
  const settled3 = await race(a, b, dup, dup);
  check(
    settled3.every((s) => s.status === "fulfilled"),
    "both concurrent identical retries complete successfully",
    settled3.filter((s) => s.status === "rejected").map((s) => s.reason.message).join(" | "),
  );

  const rows = await db.query(
    `select count(*)::int as n from public.event_equipment_movements
      where organization_id=$1 and idempotency_key=$2`,
    [ORG, sameKey],
  );
  check(rows.rows[0].n === 1, `replayed key produced one ledger row (got ${rows.rows[0].n})`);

  const audits = await db.query(
    `select count(*)::int as n from public.audit_events
      where organization_id=$1 and action='EQUIPMENT_DISPATCHED'
        and metadata->>'idempotency_key'=$2`,
    [ORG, sameKey],
  );
  check(audits.rows[0].n === 1, `replayed key produced one audit event (got ${audits.rows[0].n})`);
  check((await derived(db, "dispatched_quantity")) === 8, "replay created no duplicate physical movement");

  // ---- 4. Cross-Event shared-capacity race -----------------------------
  console.log("\n[4] cross-Event capacity race: two reservations share physical capacity 10");
  const capDispatchA = `select public.dispatch_event_equipment('${ORG}','${EVENT_CAP_A}','${RES_CAP_A}',6,null,null,'63000000-0000-0000-0000-000000000031')`;
  const capDispatchB = `select public.dispatch_event_equipment('${ORG}','${EVENT_CAP_B}','${RES_CAP_B}',6,null,null,'63000000-0000-0000-0000-000000000032')`;
  const settled4 = await race(a, b, capDispatchA, capDispatchB);
  const capWinners = settled4.filter((s) => s.status === "fulfilled").length;
  const capLosers = settled4.filter((s) => s.status === "rejected");
  check(capWinners === 1, `exactly one cross-Event dispatch succeeded (got ${capWinners})`);
  check(
    capLosers.length === 1 && /DISPATCH_EXCEEDS_PHYSICAL_CAPACITY/i.test(capLosers[0].reason.message),
    "losing cross-Event dispatch fails on shared physical capacity",
    capLosers.map((r) => r.reason.message).join(" | "),
  );
  const capTotal = await db.query(
    `select coalesce(sum(dispatched_quantity-returned_good_quantity),0)::int as n
       from public.event_equipment_movements
      where organization_id=$1 and equipment_capacity_id=$2`,
    [ORG, CAPACITY_SHARED],
  );
  check(capTotal.rows[0].n === 6, `shared capacity has 6 unavailable, never 12 (got ${capTotal.rows[0].n})`);

  // ---- 5. Dispatch versus final reconciliation -------------------------
  console.log("\n[5] dispatch-vs-reconcile race: final closure and movement share Event lock");
  const closeDispatch = `select public.dispatch_event_equipment('${ORG}','${EVENT_CLOSE}','${RES_CLOSE}',1,null,null,'63000000-0000-0000-0000-000000000041')`;
  const reconcile = `select public.reconcile_event_warehouse('${ORG}','${EVENT_CLOSE}',null,'63000000-0000-0000-0000-000000000042')`;
  const settled5 = await race(a, b, closeDispatch, reconcile);
  check(
    settled5.filter((s) => s.status === "fulfilled").length === 1,
    "exactly one of dispatch or reconciliation wins the Event lock",
  );
  const closeLoser = settled5.find((s) => s.status === "rejected");
  check(
    closeLoser && /WAREHOUSE_ALREADY_RECONCILED|WAREHOUSE_OUTSTANDING_QUANTITY/i.test(closeLoser.reason.message),
    "losing close race fails with a warehouse invariant",
    closeLoser?.reason?.message,
  );

  const closeState = await db.query(
    `select
       (select count(*)::int from public.event_equipment_movements
         where organization_id=$1 and event_id=$2) as movements,
       (select count(*)::int from public.event_warehouse_reconciliations
         where organization_id=$1 and event_id=$2) as reconciliations`,
    [ORG, EVENT_CLOSE],
  );
  const { movements, reconciliations } = closeState.rows[0];
  check(
    (movements === 1 && reconciliations === 0) || (movements === 0 && reconciliations === 1),
    `Event is either dispatched OR reconciled, never both (${movements}/${reconciliations})`,
  );

  await a.end();
  await b.end();
  await db.end();

  if (failures > 0) {
    console.log(`\nCONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nCONCURRENCY PROOF: PASSED");

  // -------------------------------------------------------------------------
  // S4B GATE — the two-session CONSUMABLE concurrency proof is chained here
  // so it runs in the exact same CI step that already gates merges. (The CI
  // workflow file itself cannot be modified by the automation credentials, so
  // this chain is what guarantees the S4B harness is CI evidence, not
  // local-only evidence.) A failure fails this process, and therefore CI.
  // -------------------------------------------------------------------------
  console.log("\n== Chaining the S4B consumable concurrency proof ==");
  const consumable = spawnSync(
    process.execPath,
    [join(__dirname, "consumable_concurrency.mjs")],
    { stdio: "inherit", env: process.env },
  );
  if (consumable.status !== 0) {
    console.log("\nCONSUMABLE CONCURRENCY PROOF: FAILED (see output above)");
    process.exit(consumable.status ?? 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
