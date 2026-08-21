#!/usr/bin/env node
/**
 * Database Guardian — shared helpers.
 *
 * Dynamic Guardian runs are intentionally scratch-only. Every destructive
 * CREATE/DROP DATABASE path is restricted to localhost/loopback, uses a unique
 * database name, and cleans it up in a finally block.
 */
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const { execSync } = require("node:child_process");

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GUARDIAN_DIR = join(ROOT, "guardian");
export const CONTRACT_DIR = join(GUARDIAN_DIR, "contract");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const TESTS_DIR = join(ROOT, "supabase", "tests");
export const NATIVE_DIR = join(ROOT, "scripts", "native-db");

export const SEVERITY_RANK = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/** Return a credential-free DB label safe for logs/artifacts. */
export function redactDatabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return "<invalid-db-url>";
  }
}

/**
 * Scratch replays are destructive by design, so only PostgreSQL loopback URLs
 * are accepted. This check must run BEFORE any network connection attempt.
 */
export function assertLocalScratchDatabaseUrl(dbUrl) {
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("GUARDIAN_INVALID_DB_URL");
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(`GUARDIAN_INVALID_DB_PROTOCOL: ${parsed.protocol}`);
  }

  const localHosts = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
  ]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `GUARDIAN_REMOTE_DB_FORBIDDEN: scratch replay may only use a local PostgreSQL server (got ${parsed.hostname})`,
    );
  }
}

function databaseUrlWithName(dbUrl, databaseName) {
  const parsed = new URL(dbUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

/** Collect findings for one Guardian run. */
export class Report {
  constructor({ runId, startedAt, cli }) {
    this.runId = runId;
    this.startedAt = startedAt;
    // Never persist DB credentials in machine-readable artifacts.
    this.cli = {
      ...cli,
      dbUrl: cli?.dbUrl ? redactDatabaseUrl(cli.dbUrl) : undefined,
      skip: cli?.skip instanceof Set ? [...cli.skip] : cli?.skip,
    };
    this.findings = [];
    this.meta = {};
  }

  add(
    check,
    {
      status = "FAIL",
      severity = "MEDIUM",
      id,
      title,
      evidence = "",
      detail = "",
    },
  ) {
    this.findings.push({
      id,
      check: check.id,
      category: check.category,
      severity,
      status,
      title,
      evidence: String(evidence).slice(0, 4000),
      detail: String(detail).slice(0, 4000),
      ts: new Date().toISOString(),
    });
  }

  pass(check, id, title, evidence = "") {
    this.add(check, {
      status: "PASS",
      severity: "INFO",
      id,
      title,
      evidence,
    });
  }

  fail(check, { severity, id, title, evidence, detail }) {
    this.add(check, { status: "FAIL", severity, id, title, evidence, detail });
  }

  get failed() {
    return this.findings.filter((f) => f.status === "FAIL");
  }

  get passed() {
    return this.findings.filter((f) => f.status === "PASS");
  }

  worstSeverity() {
    let worst = "INFO";
    for (const f of this.findings) {
      if (f.status !== "FAIL") continue;
      if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) worst = f.severity;
    }
    return worst;
  }

  failuresAtOrAbove(severity) {
    const rank = SEVERITY_RANK[severity];
    return this.findings.filter(
      (f) => f.status === "FAIL" && SEVERITY_RANK[f.severity] >= rank,
    );
  }
}

/**
 * Open an isolated scratch database on a LOCAL server. The unique DB is always
 * cleaned up, including connection/setup/check failures after creation.
 */
export async function withScratchDatabase(dbUrl, name, fn) {
  assertLocalScratchDatabaseUrl(dbUrl);

  const safePrefix =
    String(name).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30) || "guardian";
  const scratchName = `${safePrefix}_${process.pid}_${Date.now()}`;
  const quotedName = quoteIdent(scratchName);

  const admin = new pg.Client({ connectionString: dbUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${quotedName}`);
  } finally {
    await admin.end().catch(() => {});
  }

  let db;
  try {
    db = new pg.Client({
      connectionString: databaseUrlWithName(dbUrl, scratchName),
    });
    await db.connect();
    await db.query("set check_function_bodies = on");
    return await fn(db);
  } finally {
    if (db) await db.end().catch(() => {});

    const cleanup = new pg.Client({ connectionString: dbUrl });
    try {
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${quotedName}`);
    } finally {
      await cleanup.end().catch(() => {});
    }
  }
}

/** Apply the plain-Postgres auth/storage/pgTAP compatibility bootstrap. */
export async function applyNativeBootstrap(db) {
  const r = await db.query(
    `select exists (select 1 from pg_namespace where nspname='auth') as has_auth`,
  );
  if (r.rows[0].has_auth) return false;

  for (const f of ["setup_auth.sql", "setup_storage.sql", "pgtap_shims.sql"]) {
    const p = join(NATIVE_DIR, f);
    if (existsSync(p)) await db.query(readFileSync(p, "utf8"));
  }
  return true;
}

/** Replay all migrations in lexicographic order on the supplied scratch DB. */
export async function replayMigrations(db) {
  const files = migrationFiles();
  for (const f of files) {
    try {
      await db.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    } catch (e) {
      return { ok: false, failedFile: f, error: e.message };
    }
  }
  return { ok: true, count: files.length };
}

/** Replay an explicit ordered migration subset on the supplied scratch DB. */
export async function replayMigrationSubset(db, files) {
  for (const f of files) {
    try {
      await db.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    } catch (e) {
      return { ok: false, failedFile: f, error: e.message };
    }
  }
  return { ok: true, count: files.length };
}

/** Git helpers. */
export function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function changedPaths(baseRef = "origin/main") {
  return git(`diff --name-only ${baseRef}...HEAD`)
    .split("\n")
    .filter(Boolean);
}

export function currentBranch() {
  return git("branch --show-current") || "unknown";
}

export function shortHead() {
  return git("rev-parse --short HEAD") || "unknown";
}

export function listFiles(dir, ext = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();
}
