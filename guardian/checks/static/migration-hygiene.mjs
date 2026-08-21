#!/usr/bin/env node
/**
 * Migration hygiene — deterministic file checks that need no database.
 *
 * Rules:
 *   - binary-float money declarations / casts                    → CRITICAL
 *   - destructive top-level DDL/DML on protected tables         → CRITICAL/HIGH
 *   - net explicit grants to anon after ordered grant/revoke     → CRITICAL
 *   - SECURITY DEFINER without pinned search_path                → HIGH
 *   - duplicate migration ordering tokens                        → HIGH
 *
 * Dynamic ACL/RLS/schema checks remain authoritative for final PostgreSQL
 * semantics; this check is the fast fail-safe available without a DB.
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

/** Remove comments and dollar-quoted bodies so only top-level SQL remains. */
function stripCommentsAndBodies(sql) {
  let s = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Match the SAME dollar delimiter on both ends.
  s = s.replace(/(\$[a-z_0-9]*\$)[\s\S]*?\1/gi, " $BODY$ ");
  return s;
}

/**
 * Extract CREATE FUNCTION/PROCEDURE headers up to their opening dollar quote.
 * This handles both common keyword orders:
 *   language plpgsql security definer set search_path ... as $$
 *   security definer language plpgsql set search_path ... as $$
 */
function securityDefinerHeaders(rawSql) {
  const findings = [];
  const startRe = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(/gi;
  startRe.lastIndex = 0;
  let m;

  while ((m = startRe.exec(rawSql)) !== null) {
    const tail = rawSql.slice(startRe.lastIndex);
    const asMatch = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
    if (!asMatch) continue;

    const delimiter = asMatch[1];
    const openingAbsolute =
      startRe.lastIndex + asMatch.index + asMatch[0].lastIndexOf(delimiter);
    const header = rawSql.slice(m.index, openingAbsolute);
    const bodyStart = openingAbsolute + delimiter.length;
    const bodyEnd = rawSql.indexOf(delimiter, bodyStart);

    if (/\bsecurity\s+definer\b/i.test(header)) {
      findings.push({
        name: m[1],
        header,
        searchPathPinned: /\bset\s+search_path\s*=/i.test(header),
      });
    }

    if (bodyEnd >= 0) startRe.lastIndex = bodyEnd + delimiter.length;
  }

  return findings;
}

export async function run(ctx) {
  const { report, contract } = ctx;
  const files = migrationFiles();
  const financial = new Set(contract.financial?.financialTables ?? []);
  const master = new Set([
    "catalog_categories",
    "catalog_items",
    "packages",
    "package_items",
    "suppliers",
    "customers",
    "organizations",
  ]);
  const protectedTables = new Set([...financial, ...master]);

  const sources = files.map((file) => {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    return { file, raw, top: stripCommentsAndBodies(raw) };
  });

  // ---- exact money -----------------------------------------------------------
  const floatMoney = [];
  const floatCast = [];
  for (const { file, top } of sources) {
    MONEY_COL_RE.lastIndex = 0;
    FLOAT_CAST_RE.lastIndex = 0;
    for (const m of top.matchAll(MONEY_COL_RE)) {
      floatMoney.push(
        `[${file}] money-like column "${m[1]}" declared as ${m[2]}`,
      );
    }
    for (const m of top.matchAll(FLOAT_CAST_RE)) {
      floatCast.push(`[${file}] ${m[0].trim()}`);
    }
  }

  // ---- destructive top-level SQL --------------------------------------------
  const dropProtected = [];
  const hardDelete = [];
  const dropColumnProtected = [];
  for (const { file, top } of sources) {
    for (const m of top.matchAll(
      /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi,
    )) {
      if (protectedTables.has(m[1])) {
        dropProtected.push(`[${file}] DROP TABLE ${m[1]}`);
      }
    }

    for (const m of top.matchAll(/delete\s+from\s+(?:public\.)?([a-z_]+)/gi)) {
      if (protectedTables.has(m[1])) {
        hardDelete.push(`[${file}] DELETE FROM ${m[1]}`);
      }
    }

    for (const m of top.matchAll(
      /alter\s+table\s+(?:public\.)?([a-z_]+)\s+drop\s+column\b/gi,
    )) {
      if (protectedTables.has(m[1])) {
        dropColumnProtected.push(`[${file}] DROP COLUMN on ${m[1]}`);
      }
    }
  }

  // ---- ordered explicit anon grants -----------------------------------------
  // Track final state in migration/statement order. A revoke BEFORE a later
  // grant must not incorrectly cancel that later grant.
  const anonState = new Map(); // kind:name -> evidence of latest explicit grant
  for (const { file, top } of sources) {
    const statements = top.split(";").map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) {
      const target = /\bon\s+(table|sequence|function)\s+(?:public\.)?([a-z_0-9]+)/i.exec(
        statement,
      );
      if (!target) continue;

      const key = `${target[1].toLowerCase()}:${target[2].toLowerCase()}`;
      if (/^grant\b/i.test(statement) && /\bto\b[\s\S]*\banon\b/i.test(statement)) {
        anonState.set(key, {
          file,
          text: statement.replace(/\s+/g, " ").slice(0, 220),
        });
      }
      if (/^revoke\b/i.test(statement) && /\bfrom\b[\s\S]*\banon\b/i.test(statement)) {
        anonState.delete(key);
      }
    }
  }
  const netAnonGrants = [...anonState.values()];

  // ---- SECURITY DEFINER search_path -----------------------------------------
  const secdefNoPath = [];
  for (const { file, raw } of sources) {
    for (const fn of securityDefinerHeaders(raw)) {
      if (!fn.searchPathPinned) {
        secdefNoPath.push(
          `[${file}] ${fn.name}() SECURITY DEFINER without SET search_path`,
        );
      }
    }
  }

  // ---- migration ordering ----------------------------------------------------
  const seen = new Set();
  const dupes = [];
  for (const file of files) {
    const token = (file.match(/^(\d+)/) ?? [])[1];
    if (!token) continue;
    if (seen.has(token)) dupes.push(token);
    seen.add(token);
  }

  const failOrPass = (count, severity, key, titleText, evidence) => {
    if (count > 0) {
      report.fail(this, {
        severity,
        id: `${id}-${key}`,
        title: titleText,
        evidence: evidence.slice(0, 30).join("\n"),
      });
    } else {
      report.pass(
        this,
        `${id}-${key}`,
        titleText,
        "0 occurrences across all migration files",
      );
    }
  };

  failOrPass(
    floatMoney.length,
    "CRITICAL",
    "FLOAT-MONEY",
    "Money columns must never be binary float types",
    floatMoney,
  );
  failOrPass(
    floatCast.length,
    "CRITICAL",
    "FLOAT-CAST",
    "Float casts are banned by the persisted-money contract",
    floatCast,
  );
  failOrPass(
    dropProtected.length,
    "CRITICAL",
    "DROP-PROTECTED",
    "Protected tables must never be dropped in migrations",
    dropProtected,
  );
  failOrPass(
    hardDelete.length,
    "CRITICAL",
    "HARD-DELETE",
    "Protected tables must never be hard-deleted at migration time",
    hardDelete,
  );
  failOrPass(
    dropColumnProtected.length,
    "HIGH",
    "DROP-COLUMN-PROTECTED",
    "Columns on protected tables must not be dropped without an explicit retention migration",
    dropColumnProtected,
  );
  failOrPass(
    netAnonGrants.length,
    "CRITICAL",
    "ANON-GRANT",
    "Anonymous role must not retain explicit grants on protected DB objects",
    netAnonGrants.map((g) => `[${g.file}] ${g.text}`),
  );
  failOrPass(
    secdefNoPath.length,
    "HIGH",
    "SECDEF-SEARCH-PATH",
    "SECURITY DEFINER functions must pin search_path",
    secdefNoPath,
  );

  if (dupes.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-DUP-NUMBER`,
      title: "Duplicate migration ordering tokens detected",
      evidence: dupes.join(", "),
      detail:
        "Two migration files carry the same leading numeric ordering token; replay order becomes ambiguous.",
    });
  } else {
    report.pass(
      this,
      `${id}-DUP-NUMBER`,
      "Migration ordering tokens are unique",
      `${files.length} files`,
    );
  }
}
