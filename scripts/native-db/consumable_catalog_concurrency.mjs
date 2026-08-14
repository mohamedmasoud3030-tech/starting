#!/usr/bin/env node
/**
 * TWO-SESSION CONSUMABLE CATALOG/PROFILE CONCURRENCY PROOF.
 *
 * Proves the cross-table invariant that a consumable_stock_items row can never
 * coexist with a catalog item whose item_type is not CONSUMABLE, even when
 * profile creation and catalog re-typing race in opposite directions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dbUrl = process.env.DB_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const dbName = "hospitality_consumable_catalog_race";

const ORG = "84000000-0000-0000-0000-0000000000a1";
const USER = "84000000-0000-0000-0000-000000000001";
const ITEM_PROFILE_WINS = "84000000-0000-0000-0000-0000000000d1";
const ITEM_RETYPE_WINS = "84000000-0000-0000-0000-0000000000d2";
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

async function seed(db) {
  await db.query(`
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
      email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
    values('00000000-0000-0000-0000-000000000000','${USER}','authenticated','authenticated',
      'consumable-catalog-race@test.local','x',now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{}',false);

    insert into public.organizations(id,name)
      values('${ORG}','Consumable Catalog Race Org');
    insert into public.organization_memberships(organization_id,user_id,role)
      values('${ORG}','${USER}','OWNER');

    insert into public.catalog_items(
      id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price
    ) values
      ('${ITEM_PROFILE_WINS}','${ORG}','Coffee race A','CONSUMABLE','kg','PER_UNIT',1.000,2.000),
      ('${ITEM_RETYPE_WINS}','${ORG}','Coffee race B','CONSUMABLE','kg','PER_UNIT',1.000,2.000);
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
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.query(
      readFileSync(join(root, "supabase", "migrations", migration), "utf8"),
    );
  }
  await seed(db);

  const a = connect();
  const b = connect();
  await a.connect();
  await b.connect();

  console.log("\n== Consumable catalog/profile concurrency proof ==\n");

  // -----------------------------------------------------------------------
  // 1. Stock profile INSERT wins first and remains uncommitted.
  //    The concurrent catalog re-type MUST block on the catalog row, then
  //    reject after the profile commits.
  // -----------------------------------------------------------------------
  console.log("[1] profile wins: concurrent re-type must wait then reject");
  await beginAuth(a);
  await a.query(
    `select public.save_consumable_stock_item('${ORG}','${ITEM_PROFILE_WINS}',0,true)`,
  );

  await beginAuth(b);
  const retypeAfterProfile = b.query(
    `update public.catalog_items
        set item_type='SERVICE'
      where organization_id='${ORG}' and id='${ITEM_PROFILE_WINS}'`,
  );

  check(
    await isStillPending(retypeAfterProfile),
    "catalog re-type blocks while profile creation owns the shared catalog lock",
  );

  await a.query("commit");
  let retypeError = null;
  try {
    await retypeAfterProfile;
    await b.query("commit");
  } catch (error) {
    retypeError = error;
    await b.query("rollback");
  }

  check(
    /CATALOG_ITEM_HAS_CONSUMABLE_STOCK/i.test(retypeError?.message ?? ""),
    "re-type loses with the catalog/profile invariant",
    retypeError?.message,
  );

  const profileWinsState = await db.query(
    `select ci.item_type::text as item_type,
            count(s.id)::int as profile_count
       from public.catalog_items ci
       left join public.consumable_stock_items s
         on s.organization_id=ci.organization_id and s.catalog_item_id=ci.id
      where ci.organization_id=$1 and ci.id=$2
      group by ci.item_type`,
    [ORG, ITEM_PROFILE_WINS],
  );
  check(
    profileWinsState.rows[0]?.item_type === "CONSUMABLE" &&
      profileWinsState.rows[0]?.profile_count === 1,
    "profile-wins final state is CONSUMABLE + exactly one stock profile",
    JSON.stringify(profileWinsState.rows[0]),
  );

  // -----------------------------------------------------------------------
  // 2. Catalog re-type wins first and remains uncommitted.
  //    The stock-profile command MUST block on the same catalog row, then
  //    reject after the re-type commits.
  // -----------------------------------------------------------------------
  console.log("\n[2] re-type wins: concurrent profile creation must wait then reject");
  await beginAuth(b);
  await b.query(
    `update public.catalog_items
        set item_type='SERVICE'
      where organization_id='${ORG}' and id='${ITEM_RETYPE_WINS}'`,
  );

  await beginAuth(a);
  const profileAfterRetype = a.query(
    `select public.save_consumable_stock_item('${ORG}','${ITEM_RETYPE_WINS}',0,true)`,
  );

  check(
    await isStillPending(profileAfterRetype),
    "profile creation blocks while catalog re-type owns the shared catalog lock",
  );

  await b.query("commit");
  let profileError = null;
  try {
    await profileAfterRetype;
    await a.query("commit");
  } catch (error) {
    profileError = error;
    await a.query("rollback");
  }

  check(
    /CATALOG_ITEM_NOT_CONSUMABLE/i.test(profileError?.message ?? ""),
    "profile creation loses when the committed catalog type is no longer CONSUMABLE",
    profileError?.message,
  );

  const retypeWinsState = await db.query(
    `select ci.item_type::text as item_type,
            count(s.id)::int as profile_count
       from public.catalog_items ci
       left join public.consumable_stock_items s
         on s.organization_id=ci.organization_id and s.catalog_item_id=ci.id
      where ci.organization_id=$1 and ci.id=$2
      group by ci.item_type`,
    [ORG, ITEM_RETYPE_WINS],
  );
  check(
    retypeWinsState.rows[0]?.item_type === "SERVICE" &&
      retypeWinsState.rows[0]?.profile_count === 0,
    "retype-wins final state is SERVICE + zero consumable stock profiles",
    JSON.stringify(retypeWinsState.rows[0]),
  );

  const invalidPairs = await db.query(`
    select count(*)::int as n
      from public.consumable_stock_items s
      join public.catalog_items ci
        on ci.organization_id=s.organization_id and ci.id=s.catalog_item_id
     where ci.item_type <> 'CONSUMABLE'
  `);
  check(
    invalidPairs.rows[0].n === 0,
    "global invariant: no stock profile references a non-CONSUMABLE item",
    `invalid pairs=${invalidPairs.rows[0].n}`,
  );

  await a.end();
  await b.end();
  await db.end();

  if (failures > 0) {
    console.log(`\nCONSUMABLE CATALOG/PROFILE CONCURRENCY PROOF: ${failures} FAILED`);
    process.exit(1);
  }

  console.log("\nCONSUMABLE CATALOG/PROFILE CONCURRENCY PROOF: PASSED");

  // This script is the existing CI concurrency-suite entrypoint. Keep the
  // previously omitted S4B ledger proof and the new S5A procurement proof
  // chained here so every native harness is a required check without changing
  // the protected workflow file.
  for (const harness of [
    "consumable_concurrency.mjs",
    "procurement_concurrency.mjs",
  ]) {
    const child = spawnSync(process.execPath, [join(__dirname, harness)], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    if (child.status !== 0) {
      throw new Error(`${harness} failed with status ${child.status ?? "unknown"}`);
    }
  }
}

main().catch((error) => {
  console.error("CONSUMABLE CATALOG/PROFILE CONCURRENCY PROOF: FATAL");
  console.error(error);
  process.exit(1);
});
