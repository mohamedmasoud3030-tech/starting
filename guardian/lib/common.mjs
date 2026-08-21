#!/usr/bin/env node
/**
 * Database Guardian — shared helpers.
 *
 * The Guardian is a permanent, code-based system in this repository that
 * detects and prevents database problems automatically:
 *   - deterministic checks (static file analysis + dynamic SQL probes)
 *   - PostgreSQL/Supabase tests (pgTAP under supabase/tests/)
 *   - CI/local gates that block CRITICAL/HIGH regressions
 *   - a machine-readable report (PASS/FAIL, severity, finding ID, evidence)
 *
 * Dynamic Guardian runs are intentionally scratch-only: this module will not
 * create/drop databases on a remote host. Live/production databases must never
 * be passed to withScratchDatabase().
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

export const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

export function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Collects findings for a single check run.
 */
export class Report {
  constructor({ runId, startedAt, cli }) {
    this.runId = runId;
    this.startedAt = startedAt;
    this.cli = cli;
    this.findings = [];
    this.meta = {};
  }

  add(check, { status = "FAIL", severity = "MEDIUM", id, title, evidence = "", detail = "" }) {
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
    this.add(check, { status: "PASS", severity: "INFO", id, title, evidence });
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

  /** Findings at or above the given severity (FAIL only). */
  failuresAtOrAbove(severity) {
    const rank = SEVERITY_RANK[severity];
    return this.findings.filter(
      (f) => f.status === "FAIL" && SEVERITY_RANK[f.severity] >= rank,
    );
  }
}

/**
 * Guardian scratch databases are destructive by design (CREATE/DROP DATABASE),
 * therefore only loopback/local PostgreSQL targets are allowed.
 */
export function assertLocalScratchDatabaseUrl(dbUrl) {
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("GUARDIAN_INVALID_DB_URL");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `GUARDIAN_REMOTE_DB_FORBIDDEN: scratch replay may only use a local PostgreSQL server (got ${parsed.hostname})`,
    );
  }
}

/**
 * Opens an isolated scratch database on a LOCAL target server. The database
 * name is unique per process/run and is removed afterwards. No fixed database
 * name is dropped, avoiding collisions between concurrent agents/runs.
 */
export async function withScratchDatabase(dbUrl, name, fn) {
  assertLocalScratchDatabaseUrl(dbUrl);

  const safePrefix = String(name).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30) || "guardian";
  const scratchName = `${safePrefix}_${process.pid}_${Date.now()}`;
  const quotedName = `"${scratchName}"`;

  const admin = new pg.Client({ connectionString: dbUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${quotedName}`);
  } finally {
    await admin.end();
  }

  const scratchUrl = dbUrl.replace(/\/[^/?]+(\?|$)/, `/${scratchName}$1`);
  const db = new pg.Client({ connectionString: scratchUrl });
  await db.connect();
  await db.query("set check_function_bodies = on");

  try {
    return await fn(db);
  } finally {
    await db.end();

    const cleanup = new pg.Client({ connectionString: dbUrl });
    try {
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${quotedName}`);
    } finally {
      await cleanup.end().catch(() => {});
    }
  }
}

/**
 * Replays the native harness bootstrap (auth replica + storage replica + pgTAP
 * shims) on a plain PostgreSQL server so the migrations and tests can run.
 * Skipped automatically when the local server already exposes an auth schema.
 */
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

/** Runs every migration file (sorted) on the given connection. */
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

/** Runs a subset of migration files (already filtered/sorted) on the connection. */
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

/** Git helpers — list changed paths vs a base ref (default: origin/main). */
export function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function changedPaths(baseRef = "origin/main") {
  return git(`diff --name-only ${baseRef}...HEAD`).split("\n").filter(Boolean);
}

export function currentBranch() {
  return git("branch --show-current") || "unknown";
}

export function shortHead() {
  return git("rev-parse --short HEAD") || "unknown";
}

export function listFiles(dir, ext = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
}
