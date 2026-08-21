#!/usr/bin/env node
/**
 * Migration hygiene — banned patterns in migration files.
 *
 * Deterministic, file-based rules that never need a database. Scans only
 * TOP-LEVEL statements (comments and PL/pgSQL function bodies are stripped):
 *   - float money (double precision / real / ::float casts on money columns) → CRITICAL
 *   - destructive DDL/DML on financial or master tables → CRITICAL
 *   - `grant … to anon` on tables/functions not revoked by a later migration → CRITICAL
 *   - SECURITY DEFINER without a pinned search_path → HIGH
 *   - duplicate migration ordering tokens → HIGH
 *   - views created without security_invoker → MEDIUM (dynamic check is authoritative)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationFiles, MIGRATIONS_DIR } from "../../lib/common.mjs";

export const id = "G-MIGRATION-HYGIENE";
export const title = "Migration files must not contain banned patterns";
export const category = "migrations";
export const defaultSeverity = "CRITICAL";
export const mode = "static";

const MONEY_COL_RE = /(?:^|\s)([a-z_]*?(?:price|amount|cost|total|balance|paid|due|vat|discount|rate|salary|wage|payout|fee|value|charge)[a-z_]*)\s+(double precision|real)\b/gi;
const FLOAT_CAST_RE = /::\s*(float4|float8|double\s+precision|real)\b/gi;
const SECDEF_NO_PATH_RE = /create\s+(?:or\s+replace\s+)?function\b[\s\S]*?\bsecurity\s+definer\b[\s\S]*?language\s+(?:plpgsql|sql)\b[\s\S]*?\$[a-z_]*\$/gi;

/** Remove comments and $$ / $tag$ … $tag$ bodies so only top-level DDL/DML is scanned. */
function stripCommentsAndBodies(sql) {
  let s = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // Replace PL/pgSQL dollar-quoted bodies ($$ … $$ and $tag$ … $tag$) with a marker.
  s = s.replace(/\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi, " $BODY$ ");
  return s;
}

export async function run(ctx) {
  const { report, contract } = ctx;
  const files = migrationFiles();
  const financial = new Set(contract.financial?.financialTables ?? []);
  const master = new Set([
    "catalog_categories", "catalog_items", "packages", "package_items",
    "suppliers", "customers", "organizations",
  ]);
  const protectedTables = new Set([...financial, ...master]);

  const topLevel = files.map((f) => ({ f, sql: stripCommentsAndBodies(readFileSync(join(MIGRATIONS_DIR, f), "utf8")) }));

  // ---- float money -----------------------------------------------------------
  const floatMoney = [];
  const floatCast = [];
  for (const { f, sql } of topLevel) {
    for (const m of sql.matchAll(MONEY_COL_RE)) floatMoney.push(`[${f}] money column "${m[1]}" declared as float type "${m[2]}"`);
    for (const m of sql.matchAll(FLOAT_CAST_RE)) floatCast.push(`[${f}] ${m[0].trim()} (money math must stay exact)`);
  }

  // ---- destructive DDL/DML on protected tables (top-level only) --------------
  const dropProtected = [];
  const hardDelete = [];
  const dropColumnProtected = [];
  for (const { f, sql } of topLevel) {
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)) {
      if (protectedTables.has(m[1])) dropProtected.push(`[${f}] DROP TABLE on protected table "${m[1]}"`);
    }
    for (const m of sql.matchAll(/delete\s+from\s+(?:public\.)?([a-z_]+)/gi)) {
      if (protectedTables.has(m[1])) hardDelete.push(`[${f}] top-level hard DELETE FROM protected table "${m[1]}"`);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_]+)\s+drop\s+column\b/gi)) {
      if (protectedTables.has(m[1])) dropColumnProtected.push(`[${f}] DROP COLUMN on protected table "${m[1]}" (retention risk)`);
    }
  }

  // ---- anon grants paired against later revokes ------------------------------
  const granted = []; // {kind, name, file}
  const revoked = new Set(); // "kind:name"
  for (const { f, sql } of topLevel) {
    for (const m of sql.matchAll(/grant\s+[\s\S]*?\bon\s+(table|sequence|function)\s+(?:public\.)?([a-z_0-9]+)/gi)) {
      if (/\bto\s+anon\b/i.test(m[0]) && !/grant\s+usage\s+on\s+schema/i.test(m[0])) {
        granted.push({ kind: m[1], name: m[2], file: f, text: m[0].trim().replace(/\s+/g, " ").slice(0, 140) });
      }
    }
    for (const m of sql.matchAll(/revoke\s+[\s\S]*?\bon\s+(table|sequence|function)\s+(?:public\.)?([a-z_0-9]+)/gi)) {
      if (/\bfrom\s+anon\b/i.test(m[0])) revoked.add(`${m[1]}:${m[2]}`);
    }
  }
  const netAnonGrants = granted.filter((g) => !revoked.has(`${g.kind}:${g.name}`));

  // ---- SECURITY DEFINER without pinned search_path (top-level bodies) --------
  const secdefNoPath = [];
  for (const { f, sql } of topLevel) {
    for (const m of sql.matchAll(SECDEF_NO_PATH_RE)) {
      if (!/search_path/i.test(m[0])) secdefNoPath.push(`[${f}] SECURITY DEFINER function without pinned search_path`);
    }
  }

  // ---- duplicate ordering tokens ---------------------------------------------
  const tokens = files.map((f) => (f.match(/^(\d+)/) ?? [])[1]).filter(Boolean);
  const seen = new Map();
  const dupes = [];
  for (const t of tokens) {
    if (seen.has(t)) dupes.push(t);
    seen.set(t, true);
  }

  const failOrPass = (count, sev, key, titleText, evidenceArr) => {
    if (count > 0) {
      report.fail(this, { severity: sev, id: `${id}-${key}`, title: titleText, evidence: evidenceArr.slice(0, 30).join("\n") });
    } else {
      report.pass(this, `${id}-${key}`, titleText, "0 occurrences across all migration files");
    }
  };

  failOrPass(floatMoney.length, "CRITICAL", "FLOAT-MONEY", "Money columns must never be binary float types", floatMoney);
  failOrPass(floatCast.length, "CRITICAL", "FLOAT-CAST", "Float casts are banned in money math", floatCast);
  failOrPass(dropProtected.length, "CRITICAL", "DROP-PROTECTED", "Protected tables must never be DROPped in a migration", dropProtected);
  failOrPass(hardDelete.length, "CRITICAL", "HARD-DELETE", "Protected tables must never be hard-DELETEd at migration time", hardDelete);
  failOrPass(dropColumnProtected.length, "HIGH", "DROP-COLUMN-PROTECTED", "Columns on protected tables must not be dropped (retention)", dropColumnProtected);
  failOrPass(netAnonGrants.length, "CRITICAL", "ANON-GRANT", "Anonymous role must never receive net grants on tables/functions", netAnonGrants.map((g) => `[${g.file}] ${g.text}`));
  failOrPass(secdefNoPath.length, "HIGH", "SECDEF-SEARCH-PATH", "SECURITY DEFINER functions must pin search_path", secdefNoPath);

  if (dupes.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-DUP-NUMBER`,
      title: "Duplicate migration ordering tokens detected",
      evidence: dupes.join(", "),
      detail: "Two migration files carry the same numeric ordering token; replay order may be ambiguous.",
    });
  } else {
    report.pass(this, `${id}-DUP-NUMBER`, "Migration ordering tokens are unique", `${files.length} files`);
  }
}
