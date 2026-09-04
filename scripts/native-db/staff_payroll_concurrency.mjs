#!/usr/bin/env node
/**
 * REAL TWO-SESSION STAFF PAYROLL CONCURRENCY PROOF (S9).
 *
 * Scenarios:
 *   1. two identical attendance commands share one idempotency key;
 *   2. two distinct command keys race for one business attendance slot;
 *   3. two void commands race on one live attendance row.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_staff_payroll_race";

const ORG = "c0000000-0000-0000-0000-0000000000a1";
const USER = "c0000000-0000-0000-0000-000000000001";
const CUSTOMER = "c0000000-0000-0000-0000-0000000000c1";
const EVENT = "c0000000-0000-0000-0000-0000000000e1";
const STAFF = "c0000000-0000-0000-0000-0000000000f1";
const ASSIGNMENT = "c0000000-0000-0000-0000-0000000000d1";
const JWT = `{"sub":"${USER}","role":"authenticated"}`;

let failures = 0;
function check(condition, description, detail = "") {
  if (condition) console.log(`  ✓ ${description}`);
  else {
    failures += 1;
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
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated','staff-race@test.local','x',now(),now(),now(),'{}','{}',false);
    insert into public.organizations(id,name) values('${ORG}','Staff Payroll Race Org');
    insert into public.organization_memberships(organization_id,user_id,role) values('${ORG}','${USER}','OWNER');
    insert into public.customers(id,organization_id,name) values('${CUSTOMER}','${ORG}','Race Customer');
    insert into public.events(id,organization_id,customer_id,event_number,title,start_at,end_at,guest_count,venue_name,status,idempotency_key,created_by,updated_by)
    values('${EVENT}','${ORG}','${CUSTOMER}','EV-STAFF-RACE','Staff Race','2026-10-01 10:00+04','2026-10-01 20:00+04',100,'Muscat','CONFIRMED','c1100000-0000-0000-0000-000000000001','${USER}','${USER}');
    insert into public.staff_members(id,organization_id,name,staff_type,is_active,default_compensation_method,default_rate)
    values('${STAFF}','${ORG}','Race Host','HOST',true,'PER_HOUR',2.000);
    insert into public.event_staff_assignments(id,organization_id,event_id,staff_member_id,assignment_role,scheduled_start,scheduled_end,compensation_method,rate,expected_compensation,status,idempotency_key,created_by)
    values('${ASSIGNMENT}','${ORG}','${EVENT}','${STAFF}','HOST','2026-10-01 10:00+04','2026-10-01 20:00+04','PER_HOUR',2.000,20.000,'ACTIVE','c1200000-0000-0000-0000-000000000001','${USER}');
  `);
}

function record(date, key) {
  return `select public.record_staff_attendance(
    '${ORG}','${EVENT}','${STAFF}','${ASSIGNMENT}','${date}','MORNING',
    '${date} 10:00+04','${date} 15:00+04',0,'PRESENT',
    'race proof','${key}')`;
}
function voidAttendance(id, reason, key) {
  return `select public.void_staff_attendance('${ORG}','${id}','${reason}','${key}')`;
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
  console.log("\n== Two-session staff payroll concurrency proof ==\n");

  console.log("[1] identical attendance requests share one idempotency key");
  const same = await race(
    a,
    b,
    record("2026-10-01", "c2000000-0000-0000-0000-000000000001"),
    record("2026-10-01", "c2000000-0000-0000-0000-000000000001"),
  );
  check(same.every((x) => x.status === "fulfilled"), "both callers receive the same successful replay");
  const sameCount = await db.query(
    `select count(*)::int n from public.staff_attendance where organization_id=$1 and event_id=$2 and attendance_date='2026-10-01' and status <> 'VOIDED'`,
    [ORG, EVENT],
  );
  check(sameCount.rows[0].n === 1, `identical retry creates exactly one live row (got ${sameCount.rows[0].n})`);

  console.log("\n[2] distinct keys race for one business attendance slot");
  const distinct = await race(
    a,
    b,
    record("2026-10-02", "c2000000-0000-0000-0000-000000000011"),
    record("2026-10-02", "c2000000-0000-0000-0000-000000000012"),
  );
  check(distinct.filter((x) => x.status === "fulfilled").length === 1, "exactly one distinct-key attendance command wins");
  const losers = distinct.filter((x) => x.status === "rejected");
  check(
    losers.length === 1 && /ATTENDANCE_SLOT_ALREADY_RECORDED/.test(losers[0].reason.message),
    "losing command fails with ATTENDANCE_SLOT_ALREADY_RECORDED",
    losers.map((x) => x.reason.message).join(" | "),
  );
  const distinctCount = await db.query(
    `select count(*)::int n from public.staff_attendance where organization_id=$1 and event_id=$2 and attendance_date='2026-10-02' and status <> 'VOIDED'`,
    [ORG, EVENT],
  );
  check(distinctCount.rows[0].n === 1, `business slot contains exactly one live row (got ${distinctCount.rows[0].n})`);

  console.log("\n[3] two void commands race on one live attendance row");
  const target = await db.query(
    `select id::text from public.staff_attendance where organization_id=$1 and event_id=$2 and attendance_date='2026-10-02' and status <> 'VOIDED'`,
    [ORG, EVENT],
  );
  const targetId = target.rows[0].id;
  const voidRace = await race(
    a,
    b,
    voidAttendance(targetId, "operator correction", "c2000000-0000-0000-0000-000000000021"),
    voidAttendance(targetId, "duplicate entry", "c2000000-0000-0000-0000-000000000022"),
  );
  check(voidRace.filter((x) => x.status === "fulfilled").length === 1, "exactly one void wins");
  const voidLosers = voidRace.filter((x) => x.status === "rejected");
  check(
    voidLosers.length === 1 && /ATTENDANCE_ALREADY_VOIDED/.test(voidLosers[0].reason.message),
    "losing void fails with ATTENDANCE_ALREADY_VOIDED",
    voidLosers.map((x) => x.reason.message).join(" | "),
  );
  const voidState = await db.query(`select status::text from public.staff_attendance where id=$1`, [targetId]);
  check(voidState.rows[0].status === "VOIDED", "attendance reaches VOIDED exactly once");

  const duplicateKeys = await db.query(`select count(*)::int n from (
    select organization_id,idempotency_key from public.staff_payroll_command_idempotency
    group by organization_id,idempotency_key having count(*)>1
  ) d`);
  check(duplicateKeys.rows[0].n === 0, "no concurrency race duplicates a command key");

  await a.end();
  await b.end();
  await db.end();
  if (failures) {
    console.log(`\nSTAFF PAYROLL CONCURRENCY PROOF: FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nSTAFF PAYROLL CONCURRENCY PROOF: PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
