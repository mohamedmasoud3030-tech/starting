#!/usr/bin/env node
/**
 * TWO-SESSION WAREHOUSE CONCURRENCY PROOF (supplementary, Layer A).
 *
 * pgTAP runs inside a single transaction and therefore cannot interleave two
 * live sessions. This harness opens TWO real PostgreSQL connections and drives
 * a genuine race against the same reservation to prove — empirically, not by
 * inspection — that the database cannot be made to over-dispatch or
 * over-return.
 *
 * Scenarios
 *   1. OVER-DISPATCH RACE
 *      Reservation of 10. Session A and session B each open a transaction and
 *      dispatch 6. Both calls are issued before either commits, so they truly
 *      overlap. Expected: exactly one succeeds; the other either blocks on the
 *      reservation row lock and then fails with DISPATCH_EXCEEDS_RESERVATION,
 *      or fails on the idempotency/serialization boundary. Final dispatched
 *      quantity must be 6, never 12.
 *
 *   2. OVER-RETURN RACE
 *      6 units outstanding. Two concurrent returns of 6 each. Expected:
 *      exactly one succeeds; final accounted quantity must be 6, never 12.
 *
 *   3. IDEMPOTENT REPLAY RACE
 *      The same command with the SAME idempotency key issued concurrently by
 *      two sessions. Expected: at most one ledger row, one audit event, and no
 *      duplicate physical movement.
 *
 * The AUTHORITATIVE gate remains `supabase test db` in GitHub Actions; this is
 * an additional, stronger check that CI's single-transaction pgTAP cannot make.
 *
 * Usage:
 *   DB_URL=postgres://postgres@127.0.0.1:5433/postgres \
 *     node scripts/native-db/warehouse_concurrency.mjs
 */
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

/** Open a transaction as the authenticated user, ready to issue a command. */
async function beginSession(client) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(`set local "request.jwt.claims" = '${JWT}'`);
  // A blocked session must never hang the harness: if the row lock is never
  // released the run fails loudly instead of stalling.
  await client.query("set local statement_timeout = '20s'");
}

/**
 * Drive a TRUE race between two sessions.
 *
 * Both statements are issued before either transaction commits, so the second
 * one is genuinely in flight (and, if the locking is correct, blocked on the
 * reservation row lock) while the first is still open. Whichever settles first
 * is committed, which releases the lock and lets the loser proceed — at which
 * point it must observe the winner's row and fail the business invariant.
 *
 * This is the interleaving that a single-transaction pgTAP file cannot create.
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

  // The first statement to settle wins the lock; commit it so the blocked
  // loser can continue and hit the freshly-committed invariant.
  const firstIndex = await Promise.race(promises);
  await state[firstIndex].client.query(
    state[firstIndex].settled.status === "fulfilled" ? "commit" : "rollback",
  );

  // Now the loser can finish.
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
    insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price)
      values('60000000-0000-0000-0000-0000000000d1','${ORG}','Chairs','REUSABLE_EQUIPMENT','piece','PER_UNIT',4.250,9.000);
    insert into public.equipment_capacity(id,organization_id,catalog_item_id,total_quantity)
      values('60000000-0000-0000-0000-0000000000e1','${ORG}','60000000-0000-0000-0000-0000000000d1',100);
    insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,
      guest_count,venue_name,status,idempotency_key,created_by,updated_by)
      values('${EVENT}','${ORG}','60000000-0000-0000-0000-0000000000c1','EV-RACE-1','Race',
        '2026-10-01 10:00+04','2026-10-01 20:00+04',50,'Muscat','PREPARING',
        '61000000-0000-0000-0000-000000000001','${USER}','${USER}');
    insert into public.event_equipment_reservations(id,organization_id,event_id,equipment_capacity_id,
      quantity,reserved_from,reserved_until,idempotency_key,created_by)
      values('${RESERVATION}','${ORG}','${EVENT}','60000000-0000-0000-0000-0000000000e1',10,
        '2026-10-01 10:00+04','2026-10-01 20:00+04','62000000-0000-0000-0000-000000000001','${USER}');
  `);
}

async function derived(db, column) {
  const r = await db.query(
    `select coalesce(sum(${column}),0)::int as v
       from public.event_equipment_movements
      where organization_id = $1 and reservation_id = $2`,
    [ORG, RESERVATION],
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

  // ---- 1. Over-dispatch race -------------------------------------------
  console.log("[1] over-dispatch race: 2 x dispatch(6) against a reservation of 10");
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
  const dispatched = await derived(db, "dispatched_quantity");
  check(dispatched === 6, `dispatched quantity is 6, not 12 (got ${dispatched})`);

  // ---- 2. Over-return race ---------------------------------------------
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
  const returned = await derived(db, "returned_good_quantity");
  check(returned === 6, `returned-good quantity is 6, not 12 (got ${returned})`);

  // ---- 3. Idempotent replay race ---------------------------------------
  console.log("\n[3] idempotent replay race: same key issued by both sessions");
  await db.query(
    `update public.events set status='PREPARING' where id=$1`,
    [EVENT],
  );
  const sameKey = "63000000-0000-0000-0000-000000000021";
  const dup = `select public.dispatch_event_equipment('${ORG}','${EVENT}','${RESERVATION}',2,null,null,'${sameKey}')`;
  await race(a, b, dup, dup);

  const rows = await db.query(
    `select count(*)::int as n from public.event_equipment_movements
      where organization_id=$1 and idempotency_key=$2`,
    [ORG, sameKey],
  );
  check(rows.rows[0].n === 1, `the replayed key produced exactly one ledger row (got ${rows.rows[0].n})`);

  const audits = await db.query(
    `select count(*)::int as n from public.audit_events
      where organization_id=$1 and action='EQUIPMENT_DISPATCHED'
        and metadata->>'idempotency_key'=$2`,
    [ORG, sameKey],
  );
  check(audits.rows[0].n === 1, `the replayed key produced exactly one audit event (got ${audits.rows[0].n})`);

  const finalDispatched = await derived(db, "dispatched_quantity");
  check(finalDispatched === 8, `no duplicate physical movement: dispatched is 8 (got ${finalDispatched})`);

  await a.end();
  await b.end();
  await db.end();

  if (failures > 0) {
    console.log(`\nCONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nCONCURRENCY PROOF: PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
