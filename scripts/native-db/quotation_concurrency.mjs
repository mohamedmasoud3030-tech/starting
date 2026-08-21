#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_quotation_race";
const ORG = "d5000000-0000-0000-0000-0000000000a1";
const USER = "d5000000-0000-0000-0000-000000000001";
const QUOTE = "d5000000-0000-0000-0000-0000000000f1";
const JWT = `{"sub":"${USER}","role":"authenticated"}`;
let failures = 0;

function check(condition, label, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function connection(database = dbName) {
  return new pg.Client({ connectionString: dbUrl.replace(/\/postgres(\?|$)/, `/${database}$1`) });
}
async function begin(client) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(`set local "request.jwt.claims"='${JWT}'`);
  await client.query("set local statement_timeout='20s'");
}
async function race(a, b, sqlA, sqlB) {
  await begin(a); await begin(b);
  const state = [{ client: a, result: null }, { client: b, result: null }];
  const pending = [sqlA, sqlB].map((sql, index) => state[index].client.query(sql)
    .then((value) => { state[index].result = { status: "fulfilled", value }; return index; })
    .catch((reason) => { state[index].result = { status: "rejected", reason }; return index; }));
  const first = await Promise.race(pending);
  await state[first].client.query(state[first].result.status === "fulfilled" ? "commit" : "rollback");
  await Promise.all(pending);
  const second = first === 0 ? 1 : 0;
  await state[second].client.query(state[second].result.status === "fulfilled" ? "commit" : "rollback");
  return state.map((entry) => entry.result);
}

async function main() {
  const admin = connection("postgres"); await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`); await admin.end();
  const db = connection(); await db.connect();
  await db.query(readFileSync(join(here, "setup_auth.sql"), "utf8"));
  await db.query(readFileSync(join(here, "setup_storage.sql"), "utf8"));
  for (const migration of readdirSync(join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(root, "supabase", "migrations", migration), "utf8"));
  }
  await db.query(`
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated','quotation-race@test.local','x',now(),now(),now(),'{}','{}',false);
    insert into public.organizations(id,name) values('${ORG}','Quotation Race');
    insert into public.organization_memberships(organization_id,user_id,role) values('${ORG}','${USER}','OWNER');
    insert into public.quotations(id,organization_id,revision,status,customer_name_snapshot,customer_phone_snapshot,event_title_snapshot,event_type_snapshot,guest_count_snapshot,start_at_snapshot,end_at_snapshot,venue_snapshot,idempotency_key,created_by)
    values('${QUOTE}','${ORG}',1,'DRAFT','Race Prospect','99001122','Race Event','OTHER',50,'2026-10-01 10:00+04','2026-10-01 14:00+04','Muscat','d5000000-0000-0000-0000-000000000101','${USER}');
    insert into public.quotation_lines(organization_id,quotation_id,description,item_type,unit,pricing_method,quantity,unit_selling_price,expected_unit_cost,total_selling,total_expected_cost,is_custom,sort_order)
    values('${ORG}','${QUOTE}','Hospitality','SERVICE','event','FIXED',1,100.000,40.000,100.000,40.000,true,0);
  `);
  const a = connection(), b = connection(); await a.connect(); await b.connect();
  console.log("\n== Two-session canonical quotation concurrency proof ==\n");
  const issued = await race(a, b,
    `select (public.issue_quotation('${ORG}','${QUOTE}',null,null,'d5000000-0000-0000-0000-000000000201')).id`,
    `select (public.issue_quotation('${ORG}','${QUOTE}',null,null,'d5000000-0000-0000-0000-000000000202')).id`);
  check(issued.every((result) => result.status === "fulfilled"), "two issue attempts return safely", issued.map((x) => x.reason?.message).filter(Boolean).join(" | "));
  const issueState = await db.query("select status::text,quotation_number from public.quotations where id=$1", [QUOTE]);
  check(issueState.rows[0]?.status === "ISSUED", "quotation issued once");
  check(/^QT-/.test(issueState.rows[0]?.quotation_number ?? ""), "one official number allocated");

  await db.query("begin"); await db.query("set local role authenticated"); await db.query(`set local "request.jwt.claims"='${JWT}'`);
  await db.query(`select public.accept_quotation('${ORG}','${QUOTE}','d5000000-0000-0000-0000-000000000203')`); await db.query("commit");
  const converted = await race(a, b,
    `select (public.convert_quotation_to_event('${ORG}','${QUOTE}','d5000000-0000-0000-0000-000000000204')).id`,
    `select (public.convert_quotation_to_event('${ORG}','${QUOTE}','d5000000-0000-0000-0000-000000000205')).id`);
  check(converted.every((result) => result.status === "fulfilled"), "two conversion attempts return the same safe event", converted.map((x) => x.reason?.message).filter(Boolean).join(" | "));
  const eventCount = await db.query("select count(*)::int count from public.events where accepted_quotation_id=$1", [QUOTE]);
  check(eventCount.rows[0].count === 1, `conversion race creates exactly one event (got ${eventCount.rows[0].count})`);
  const conversionState = await db.query("select status::text,converted_event_id from public.quotations where id=$1", [QUOTE]);
  check(conversionState.rows[0]?.status === "CONVERTED" && conversionState.rows[0]?.converted_event_id, "quotation stores one immutable conversion result");

  await a.end(); await b.end(); await db.end();
  if (failures) { console.error(`\nQUOTATION CONCURRENCY PROOF: FAILED (${failures})`); process.exit(1); }
  console.log("\nQUOTATION CONCURRENCY PROOF: PASSED");
}
main().catch((error) => { console.error(error); process.exit(1); });
