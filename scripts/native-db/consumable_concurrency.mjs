#!/usr/bin/env node
/**
 * TWO-SESSION CONSUMABLE CONCURRENCY PROOF (S4B).
 *
 * pgTAP is authoritative for schema/RLS assertions but executes inside one
 * transaction. This harness uses two real PostgreSQL sessions to prove the
 * interleavings that a single-transaction test cannot create.
 *
 * Scenarios
 *   1. two concurrent issues against stock that can satisfy only one
 *   2. issue versus a stock-decreasing warehouse adjustment on the same item
 *   3. two concurrent Event custody reductions (consume vs return)
 *   4. Event movement versus final consumable reconciliation
 *   5. concurrent identical idempotent retry
 *
 * Expected outcomes: stock never negative, Event custody never negative, no
 * duplicate movement, no duplicate audit event, no movement after
 * reconciliation, no deadlock from the documented lock order
 * (Event -> stock item).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_consumable_race";

const ORG = "80000000-0000-0000-0000-0000000000a1";
const USER = "80000000-0000-0000-0000-000000000001";

const ITEM_ISSUE = "80000000-0000-0000-0000-0000000000d1";
const ITEM_ADJUST = "80000000-0000-0000-0000-0000000000d2";
const ITEM_CUSTODY = "80000000-0000-0000-0000-0000000000d3";
const ITEM_CLOSE = "80000000-0000-0000-0000-0000000000d4";
const ITEM_REPLAY = "80000000-0000-0000-0000-0000000000d5";

const STOCK_ISSUE = "80000000-0000-0000-0000-0000000000e1";
const STOCK_ADJUST = "80000000-0000-0000-0000-0000000000e2";
const STOCK_CUSTODY = "80000000-0000-0000-0000-0000000000e3";
const STOCK_CLOSE = "80000000-0000-0000-0000-0000000000e4";
const STOCK_REPLAY = "80000000-0000-0000-0000-0000000000e5";

const EVENT_A = "80000000-0000-0000-0000-000000000f01";
const EVENT_B = "80000000-0000-0000-0000-000000000f02";
const EVENT_CUSTODY = "80000000-0000-0000-0000-000000000f03";
const EVENT_CLOSE = "80000000-0000-0000-0000-000000000f04";
const EVENT_REPLAY = "80000000-0000-0000-0000-000000000f05";

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
 * the shared row lock so the second continues against the committed truth.
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
      'consumable-race@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);

    insert into public.organizations(id,name) values('${ORG}','Consumable Race Org');
    insert into public.organization_memberships(organization_id,user_id,role)
      values('${ORG}','${USER}','OWNER');
    insert into public.customers(id,organization_id,name)
      values('80000000-0000-0000-0000-0000000000c1','${ORG}','Customer');

    insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
      ('${ITEM_ISSUE}','${ORG}','Coffee','CONSUMABLE','kg','PER_UNIT',3.500,8.000),
      ('${ITEM_ADJUST}','${ORG}','Dates','CONSUMABLE','kg','PER_UNIT',2.000,5.000),
      ('${ITEM_CUSTODY}','${ORG}','Sugar','CONSUMABLE','kg','PER_UNIT',0.800,2.000),
      ('${ITEM_CLOSE}','${ORG}','Charcoal','CONSUMABLE','box','PER_UNIT',1.500,4.000),
      ('${ITEM_REPLAY}','${ORG}','Water','CONSUMABLE','box','PER_UNIT',1.000,3.000);

    insert into public.consumable_stock_items(id,organization_id,catalog_item_id,minimum_stock_quantity,created_by) values
      ('${STOCK_ISSUE}','${ORG}','${ITEM_ISSUE}',0,'${USER}'),
      ('${STOCK_ADJUST}','${ORG}','${ITEM_ADJUST}',0,'${USER}'),
      ('${STOCK_CUSTODY}','${ORG}','${ITEM_CUSTODY}',0,'${USER}'),
      ('${STOCK_CLOSE}','${ORG}','${ITEM_CLOSE}',0,'${USER}'),
      ('${STOCK_REPLAY}','${ORG}','${ITEM_REPLAY}',0,'${USER}');

    insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,
      guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
      ('${EVENT_A}','${ORG}','80000000-0000-0000-0000-0000000000c1','EV-CR-1','Issue race A',
        '2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Muscat','PREPARING',
        '81000000-0000-0000-0000-000000000001','${USER}','${USER}'),
      ('${EVENT_B}','${ORG}','80000000-0000-0000-0000-0000000000c1','EV-CR-2','Issue race B',
        '2026-10-02 10:00+04','2026-10-02 20:00+04',50,'Muscat','PREPARING',
        '81000000-0000-0000-0000-000000000002','${USER}','${USER}'),
      ('${EVENT_CUSTODY}','${ORG}','80000000-0000-0000-0000-0000000000c1','EV-CR-3','Custody race',
        '2026-10-03 10:00+04','2026-10-03 20:00+04',50,'Muscat','PREPARING',
        '81000000-0000-0000-0000-000000000003','${USER}','${USER}'),
      ('${EVENT_CLOSE}','${ORG}','80000000-0000-0000-0000-0000000000c1','EV-CR-4','Close race',
        '2026-10-04 10:00+04','2026-10-04 20:00+04',50,'Muscat','PREPARING',
        '81000000-0000-0000-0000-000000000004','${USER}','${USER}'),
      ('${EVENT_REPLAY}','${ORG}','80000000-0000-0000-0000-0000000000c1','EV-CR-5','Replay race',
        '2026-10-05 10:00+04','2026-10-05 20:00+04',50,'Muscat','PREPARING',
        '81000000-0000-0000-0000-000000000005','${USER}','${USER}');
  `);

  // Seed authoritative opening stock through the real command.
  const client = connect();
  await client.connect();
  await beginSession(client);
  const receipts = [
    [STOCK_ISSUE, "10.000", "82000000-0000-0000-0000-000000000001"],
    [STOCK_ADJUST, "10.000", "82000000-0000-0000-0000-000000000002"],
    [STOCK_CUSTODY, "10.000", "82000000-0000-0000-0000-000000000003"],
    [STOCK_CLOSE, "10.000", "82000000-0000-0000-0000-000000000004"],
    [STOCK_REPLAY, "10.000", "82000000-0000-0000-0000-000000000005"],
  ];
  for (const [stock, qty, key] of receipts) {
    await client.query(
      `select public.receive_consumable_stock('${ORG}','${stock}',${qty},null,'${key}')`,
    );
  }
  // Custody scenario: 6.000 issued, so two concurrent 4.000 reductions race.
  await client.query(
    `select public.issue_consumable_to_event('${ORG}','${EVENT_CUSTODY}','${STOCK_CUSTODY}',6.000,null,'82000000-0000-0000-0000-000000000010')`,
  );
  // Close scenario: 2.000 issued then fully consumed, so reconciliation is legal.
  await client.query(
    `select public.issue_consumable_to_event('${ORG}','${EVENT_CLOSE}','${STOCK_CLOSE}',2.000,null,'82000000-0000-0000-0000-000000000011')`,
  );
  await client.query(
    `select public.consume_consumable_at_event('${ORG}','${EVENT_CLOSE}','${STOCK_CLOSE}',2.000,null,'82000000-0000-0000-0000-000000000012')`,
  );
  await client.query("commit");
  await client.end();
}

async function onHand(db, stockItem) {
  const r = await db.query(
    `select coalesce(sum(warehouse_delta),0)::text as v
       from public.consumable_movements
      where organization_id = $1 and stock_item_id = $2`,
    [ORG, stockItem],
  );
  return Number(r.rows[0].v);
}

async function outstanding(db, eventId, stockItem) {
  const r = await db.query(
    `select coalesce(sum(event_delta),0)::text as v
       from public.consumable_movements
      where organization_id = $1 and event_id = $2 and stock_item_id = $3`,
    [ORG, eventId, stockItem],
  );
  return Number(r.rows[0].v);
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

  console.log("\n== Two-session consumable concurrency proof ==\n");

  const a = connect();
  const b = connect();
  await a.connect();
  await b.connect();

  // ---- 1. Concurrent issue vs issue on shared stock --------------------
  console.log("[1] issue race: 2 x issue(6.000) against 10.000 on hand");
  const issue = (event, key) =>
    `select public.issue_consumable_to_event('${ORG}','${event}','${STOCK_ISSUE}',6.000,null,'${key}')`;
  const settled1 = await race(
    a,
    b,
    issue(EVENT_A, "83000000-0000-0000-0000-000000000001"),
    issue(EVENT_B, "83000000-0000-0000-0000-000000000002"),
  );
  const ok1 = settled1.filter((s) => s.status === "fulfilled").length;
  const rejected1 = settled1.filter((s) => s.status === "rejected");
  check(ok1 === 1, `exactly one concurrent issue succeeded (got ${ok1})`);
  check(
    rejected1.every((r) => /CONSUMABLE_STOCK_SHORTAGE/i.test(r.reason.message)),
    "the losing issue failed with the stock-shortage invariant",
    rejected1.map((r) => r.reason.message).join(" | "),
  );
  const hand1 = await onHand(db, STOCK_ISSUE);
  check(hand1 === 4, `on-hand is exactly 4.000, never negative (got ${hand1})`);

  // ---- 2. Issue vs stock-decreasing adjustment --------------------------
  console.log("\n[2] issue vs adjustment race: issue(7.000) vs adjust(-7.000) on 10.000");
  const issueAdj = `select public.issue_consumable_to_event('${ORG}','${EVENT_A}','${STOCK_ADJUST}',7.000,null,'83000000-0000-0000-0000-000000000011')`;
  const adjust = `select public.adjust_consumable_stock('${ORG}','${STOCK_ADJUST}',-7.000,'verified count correction','83000000-0000-0000-0000-000000000012')`;
  const settled2 = await race(a, b, issueAdj, adjust);
  const ok2 = settled2.filter((s) => s.status === "fulfilled").length;
  const rejected2 = settled2.filter((s) => s.status === "rejected");
  check(ok2 === 1, `exactly one of issue/adjustment succeeded (got ${ok2})`);
  check(
    rejected2.every((r) => /CONSUMABLE_STOCK_SHORTAGE/i.test(r.reason.message)),
    "the loser failed with the stock-shortage invariant, not a deadlock",
    rejected2.map((r) => r.reason.message).join(" | "),
  );
  const hand2 = await onHand(db, STOCK_ADJUST);
  check(hand2 === 3, `on-hand is exactly 3.000, never negative (got ${hand2})`);

  // ---- 3. Concurrent Event custody reduction ----------------------------
  console.log("\n[3] custody race: consume(4.000) vs return(4.000) against 6.000 outstanding");
  const consume = `select public.consume_consumable_at_event('${ORG}','${EVENT_CUSTODY}','${STOCK_CUSTODY}',4.000,null,'83000000-0000-0000-0000-000000000021')`;
  const ret = `select public.return_consumable_from_event('${ORG}','${EVENT_CUSTODY}','${STOCK_CUSTODY}',4.000,null,'83000000-0000-0000-0000-000000000022')`;
  const settled3 = await race(a, b, consume, ret);
  const ok3 = settled3.filter((s) => s.status === "fulfilled").length;
  const rejected3 = settled3.filter((s) => s.status === "rejected");
  check(ok3 === 1, `exactly one custody reduction succeeded (got ${ok3})`);
  check(
    rejected3.every((r) => /CONSUMABLE_EXCEEDS_OUTSTANDING/i.test(r.reason.message)),
    "the losing custody reduction failed with the outstanding invariant",
    rejected3.map((r) => r.reason.message).join(" | "),
  );
  const out3 = await outstanding(db, EVENT_CUSTODY, STOCK_CUSTODY);
  check(out3 === 2, `Event custody is exactly 2.000, never negative (got ${out3})`);

  // ---- 4. Event movement versus final reconciliation --------------------
  console.log("\n[4] close race: new issue(1.000) vs final reconciliation on the same Event");
  const closeIssue = `select public.issue_consumable_to_event('${ORG}','${EVENT_CLOSE}','${STOCK_CLOSE}',1.000,null,'83000000-0000-0000-0000-000000000031')`;
  const reconcile = `select public.reconcile_event_consumables('${ORG}','${EVENT_CLOSE}',null,'83000000-0000-0000-0000-000000000032')`;
  const settled4 = await race(a, b, closeIssue, reconcile);
  const ok4 = settled4.filter((s) => s.status === "fulfilled").length;
  check(ok4 === 1, `exactly one of movement/reconciliation wins the Event lock (got ${ok4})`);
  const loser4 = settled4.find((s) => s.status === "rejected");
  check(
    loser4 &&
      /CONSUMABLES_ALREADY_RECONCILED|CONSUMABLE_OUTSTANDING_QUANTITY/i.test(
        loser4.reason.message,
      ),
    "the loser failed with a reconciliation invariant",
    loser4?.reason?.message,
  );
  const closeState = await db.query(
    `select
       (select count(*)::int from public.consumable_movements
         where organization_id=$1 and event_id=$2
           and idempotency_key='83000000-0000-0000-0000-000000000031') as movements,
       (select count(*)::int from public.event_consumable_reconciliations
         where organization_id=$1 and event_id=$2) as reconciliations`,
    [ORG, EVENT_CLOSE],
  );
  const { movements, reconciliations } = closeState.rows[0];
  check(
    (movements === 1 && reconciliations === 0) ||
      (movements === 0 && reconciliations === 1),
    `the Event either gained the movement OR was reconciled, never both (${movements}/${reconciliations})`,
  );

  // ---- 5. Concurrent identical idempotent retry -------------------------
  console.log("\n[5] idempotent replay race: same key and payload in both sessions");
  const sameKey = "83000000-0000-0000-0000-000000000041";
  const dup = `select public.issue_consumable_to_event('${ORG}','${EVENT_REPLAY}','${STOCK_REPLAY}',2.500,null,'${sameKey}')`;
  const settled5 = await race(a, b, dup, dup);
  check(
    settled5.every((s) => s.status === "fulfilled"),
    "both concurrent identical retries complete successfully",
    settled5
      .filter((s) => s.status === "rejected")
      .map((s) => s.reason.message)
      .join(" | "),
  );
  const rows5 = await db.query(
    `select count(*)::int as n from public.consumable_movements
      where organization_id=$1 and idempotency_key=$2`,
    [ORG, sameKey],
  );
  check(rows5.rows[0].n === 1, `the replayed key produced one ledger row (got ${rows5.rows[0].n})`);
  const audits5 = await db.query(
    `select count(*)::int as n from public.audit_events
      where organization_id=$1 and action='CONSUMABLE_ISSUED'
        and metadata->>'idempotency_key'=$2`,
    [ORG, sameKey],
  );
  check(audits5.rows[0].n === 1, `the replayed key produced one audit event (got ${audits5.rows[0].n})`);
  const hand5 = await onHand(db, STOCK_REPLAY);
  check(hand5 === 7.5, `the replay created no duplicate physical movement (on hand ${hand5})`);

  // ---- Global invariants -------------------------------------------------
  console.log("\n[6] global invariants after all races");
  const negatives = await db.query(
    `select count(*)::int as n from (
       select stock_item_id, sum(warehouse_delta) as bal
         from public.consumable_movements where organization_id=$1
        group by stock_item_id having sum(warehouse_delta) < 0
     ) t`,
    [ORG],
  );
  check(negatives.rows[0].n === 0, "no stock item ended with a negative warehouse balance");
  const negativeCustody = await db.query(
    `select count(*)::int as n from (
       select event_id, stock_item_id, sum(event_delta) as bal
         from public.consumable_movements
        where organization_id=$1 and event_id is not null
        group by event_id, stock_item_id having sum(event_delta) < 0
     ) t`,
    [ORG],
  );
  check(negativeCustody.rows[0].n === 0, "no Event ended with negative custody");
  const dupKeys = await db.query(
    `select count(*)::int as n from (
       select idempotency_key from public.consumable_movements
        where organization_id=$1 group by idempotency_key having count(*) > 1
     ) t`,
    [ORG],
  );
  check(dupKeys.rows[0].n === 0, "no idempotency key produced a duplicate movement");

  await a.end();
  await b.end();
  await db.end();

  if (failures > 0) {
    console.log(`\nCONSUMABLE CONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nCONSUMABLE CONCURRENCY PROOF: PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
