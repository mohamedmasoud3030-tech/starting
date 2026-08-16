#!/usr/bin/env node
/**
 * REAL TWO-SESSION CUSTOMER PAYMENT CONCURRENCY PROOF (S6).
 *
 * Scenarios:
 *   1. two identical record_customer_payment calls share one idempotency key;
 *   2. two distinct record_customer_payment calls race on one event;
 *   3. two void_customer_payment calls race on one RECORDED payment.
 *
 * The customer balance is never stored — it is derived from the RECORDED
 * ledger — so no racing command can corrupt a balance. Idempotency is
 * serialized by an advisory transaction lock on (organization, key); voiding
 * serializes on the payment row (SELECT ... FOR UPDATE).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_payments_race";

const ORG = "b0000000-0000-0000-0000-0000000000a1";
const USER = "b0000000-0000-0000-0000-000000000001";
const CUSTOMER = "b0000000-0000-0000-0000-0000000000c1";
const EVENT_SAME = "b0000000-0000-0000-0000-0000000000e1";
const EVENT_DISTINCT = "b0000000-0000-0000-0000-0000000000e2";
const EVENT_VOID = "b0000000-0000-0000-0000-0000000000e3";
const QUOTE_SAME = "b0000000-0000-0000-0000-0000000000f1";
const QUOTE_DISTINCT = "b0000000-0000-0000-0000-0000000000f2";
const QUOTE_VOID = "b0000000-0000-0000-0000-0000000000f3";
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
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated','pay-race@test.local','x',now(),now(),now(),'{}','{}',false);
    insert into public.organizations(id,name) values('${ORG}','Payments Race Org');
    insert into public.organization_memberships(organization_id,user_id,role) values('${ORG}','${USER}','OWNER');
    insert into public.customers(id,organization_id,name) values('${CUSTOMER}','${ORG}','Race Customer');
    insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by) values
      ('${EVENT_SAME}','${ORG}','${CUSTOMER}','EV-RACE-1','Race 1','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','b1100000-0000-0000-0000-000000000001','${USER}','${USER}'),
      ('${EVENT_DISTINCT}','${ORG}','${CUSTOMER}','EV-RACE-2','Race 2','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','b1100000-0000-0000-0000-000000000002','${USER}','${USER}'),
      ('${EVENT_VOID}','${ORG}','${CUSTOMER}','EV-RACE-3','Race 3','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','b1100000-0000-0000-0000-000000000003','${USER}','${USER}');
    insert into public.quotations(id,organization_id,event_id,quotation_number,revision,status,customer_name_snapshot,event_number_snapshot,event_title_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,total_selling,total_expected_cost,total_expected_profit,idempotency_key,issued_by,accepted_by,accepted_at) values
      ('${QUOTE_SAME}','${ORG}','${EVENT_SAME}','QT-RACE-1',1,'ACCEPTED','Race Customer','EV-RACE-1','Race 1',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',1000.000,500.000,500.000,'b1200000-0000-0000-0000-000000000001','${USER}','${USER}',now()),
      ('${QUOTE_DISTINCT}','${ORG}','${EVENT_DISTINCT}','QT-RACE-2',1,'ACCEPTED','Race Customer','EV-RACE-2','Race 2',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',1000.000,500.000,500.000,'b1200000-0000-0000-0000-000000000002','${USER}','${USER}',now()),
      ('${QUOTE_VOID}','${ORG}','${EVENT_VOID}','QT-RACE-3',1,'ACCEPTED','Race Customer','EV-RACE-3','Race 3',100,'2026-10-01 10:00+04','2026-10-01 20:00+04','Muscat',1000.000,500.000,500.000,'b1200000-0000-0000-0000-000000000003','${USER}','${USER}',now());
    update public.events set accepted_quotation_id='${QUOTE_SAME}' where id='${EVENT_SAME}';
    update public.events set accepted_quotation_id='${QUOTE_DISTINCT}' where id='${EVENT_DISTINCT}';
    update public.events set accepted_quotation_id='${QUOTE_VOID}' where id='${EVENT_VOID}';
    -- seed one RECORDED payment to void
    insert into public.customer_payments(id,organization_id,event_id,amount,payment_method,paid_at,recorded_by,idempotency_key,request_fingerprint) values
      ('b1300000-0000-0000-0000-000000000001','${ORG}','${EVENT_VOID}',50.000,'CASH',now(),'${USER}','b1400000-0000-0000-0000-000000000001',repeat('a',64));
  `);
}

function record(event, amount, key) {
  return `select public.record_customer_payment(
    '${ORG}','${event}',${amount},'CASH',null,null,'2026-08-14T12:00:00Z','${key}')`;
}
function voidPayment(paymentId, reason, key) {
  return `select public.void_customer_payment('${ORG}','${paymentId}','${reason}','${key}')`;
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
  console.log("\n== Two-session customer payment concurrency proof ==\n");

  console.log("[1] two identical record(100.000) calls share one idempotency key");
  const same = await race(
    a,
    b,
    record(EVENT_SAME, "100.000", "b2000000-0000-0000-0000-000000000001"),
    record(EVENT_SAME, "100.000", "b2000000-0000-0000-0000-000000000001"),
  );
  check(same.every((x) => x.status === "fulfilled"), "both identical callers receive a successful replay");
  const sameCount = await db.query(`select count(*)::int n from public.customer_payments where event_id=$1`, [EVENT_SAME]);
  check(sameCount.rows[0].n === 1, `identical retry creates exactly one payment (got ${sameCount.rows[0].n})`);

  console.log("\n[2] two distinct record(50.000) calls race on one event");
  const distinct = await race(
    a,
    b,
    record(EVENT_DISTINCT, "50.000", "b2000000-0000-0000-0000-000000000011"),
    record(EVENT_DISTINCT, "50.000", "b2000000-0000-0000-0000-000000000012"),
  );
  check(distinct.every((x) => x.status === "fulfilled"), "both distinct payments succeed");
  const distinctSum = await db.query(`select sum(amount)::text value from public.customer_payments where event_id=$1`, [EVENT_DISTINCT]);
  check(distinctSum.rows[0].value === "100.000", `distinct payments sum exactly to 100.000 (got ${distinctSum.rows[0].value})`);

  console.log("\n[3] two void calls race on one RECORDED payment");
  const voidRace = await race(
    a,
    b,
    voidPayment("b1300000-0000-0000-0000-000000000001", "wrong amount", "b2000000-0000-0000-0000-000000000021"),
    voidPayment("b1300000-0000-0000-0000-000000000001", "duplicate entry", "b2000000-0000-0000-0000-000000000022"),
  );
  check(voidRace.filter((x) => x.status === "fulfilled").length === 1, "exactly one void wins");
  check(
    voidRace.filter((x) => x.status === "rejected").every((x) => /PAYMENT_ALREADY_VOIDED/.test(x.reason.message)),
    "losing void fails with PAYMENT_ALREADY_VOIDED",
    voidRace.filter((x) => x.status === "rejected").map((x) => x.reason.message).join(" | "),
  );
  const voidState = await db.query(`select status::text from public.customer_payments where id=$1`, ["b1300000-0000-0000-0000-000000000001"]);
  check(voidState.rows[0].status === "VOIDED", "payment reaches VOIDED exactly once");

  const duplicateKeys = await db.query(`select count(*)::int n from (
    select idempotency_key from public.payments_command_idempotency
    group by organization_id,idempotency_key having count(*)>1
  ) d`);
  check(duplicateKeys.rows[0].n === 0, "no concurrency race duplicates a command key");

  await a.end();
  await b.end();
  await db.end();
  if (failures) {
    console.log(`\nPAYMENTS CONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nPAYMENTS CONCURRENCY PROOF: PASSED");

  // R11 adds a separate quotation race harness. The protected repository
  // workflow already invokes this native-db stage, so run the adjacent proof
  // here without weakening or replacing the established payment scenarios.
  const quotationProof = spawnSync(
    process.execPath,
    [join(__dirname, "quotation_concurrency.mjs")],
    { stdio: "inherit", env: process.env },
  );
  if (quotationProof.status !== 0) process.exit(quotationProof.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
