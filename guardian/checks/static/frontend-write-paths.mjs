#!/usr/bin/env node
/**
 * Frontend → RPC → table → trigger → function write-path map.
 *
 * Builds a real map of every write path from the SPA into the database:
 *   - RPCs the frontend calls (supabase.rpc('name', …))
 *   - direct client writes (supabase.from('table').insert/update/delete/upsert)
 *   - which tables each RPC writes (parsed from its SQL body in migrations)
 *   - which triggers fire on those tables and which functions they call
 *
 * Findings:
 *   - a direct client write to a table outside the contract's allowed list
 *   - a table that is written BOTH directly by the client AND by an RPC
 *     (more than one write path for the same operation class)
 *
 * Artifacts: guardian/reports/latest/write-paths.md / write-paths.json
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, MIGRATIONS_DIR, migrationFiles } from "../../lib/common.mjs";
import { writeArtifact } from "../../lib/report.mjs";

export const id = "G-WRITE-PATHS";
export const title = "Business operations must have exactly one write path";
export const category = "static";
export const defaultSeverity = "MEDIUM";
export const mode = "static";

const SRC_DIR = join(ROOT, "src");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Find every RPC body (create or replace function public.name(args)) across migrations. */
function loadRpcBodies() {
  const bodies = new Map(); // key: name + "(" + normalized args
  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const re = /create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(([^)]*)\)\s*([\s\S]*?)\$[a-z_]*\$/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1];
      const args = m[2].trim();
      const body = m[3] + m[0].slice(m[0].lastIndexOf("$"));
      const key = `${name}(${args})`;
      if (!bodies.has(key)) bodies.set(key, body);
    }
  }
  return bodies;
}

const DML_RE = /\b(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:public\.)?([a-z_][a-z_0-9]*)/gi;

function tablesWritten(sqlBody) {
  const tables = new Set();
  let m;
  while ((m = DML_RE.exec(sqlBody)) !== null) tables.add(m[2]);
  return [...tables].sort();
}

export async function run(ctx) {
  const { report, contract } = ctx;
  const rpcCalls = new Map(); // rpcName -> Set<frontendFile>
  const directWrites = new Map(); // table -> Set<frontendFile>
  const fromReads = new Set();

  for (const file of walk(SRC_DIR)) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/gi)) {
      if (!rpcCalls.has(m[1])) rpcCalls.set(m[1], new Set());
      rpcCalls.get(m[1]).add(rel);
    }
    for (const m of src.matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)\s*\.(insert|update|delete|upsert)/gi)) {
      const table = m[1];
      const op = m[2].toUpperCase();
      if (!directWrites.has(table)) directWrites.set(table, new Map());
      if (!directWrites.get(table).has(rel)) directWrites.get(table).set(rel, new Set());
      directWrites.get(table).get(rel).add(op);
    }
    for (const m of src.matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]/gi)) {
      fromReads.add(m[1]);
    }
  }

  // RPC → tables written (from SQL bodies)
  const rpcBodies = loadRpcBodies();
  const rpcToTables = new Map();
  for (const [rpcName, files] of rpcCalls) {
    const candidates = [...rpcBodies.entries()].filter(([k]) => k.startsWith(`${rpcName}(`));
    const tables = new Set();
    for (const [, body] of candidates) for (const t of tablesWritten(body)) tables.add(t);
    rpcToTables.set(rpcName, { files: [...files].sort(), tables: [...tables].sort() });
  }

  // Triggers on written tables (schema-level info from migration SQL, best-effort)
  const triggerMap = new Map();
  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const re = /create\s+trigger\s+([a-z_0-9]+)[\s\S]*?on\s+(?:public\.)?([a-z_0-9]+)[\s\S]*?execute\s+function\s+(?:public\.)?([a-z_0-9]+)\(\)/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      if (!triggerMap.has(m[2])) triggerMap.set(m[2], []);
      triggerMap.get(m[2]).push({ trigger: m[1], fn: m[3] });
    }
  }

  // ---- Findings ------------------------------------------------------------
  const allowed = contract.writePaths?.allowedDirectClientWrites ?? {};
  const unauthorizedDirect = [];
  for (const [table, files] of directWrites) {
    const allowedOps = allowed[table];
    if (!allowedOps) {
      unauthorizedDirect.push(`${table} (${[...files.values()].flatMap((s) => [...s]).join(", ")})`);
      continue;
    }
    const ops = new Set([...files.values()].flatMap((s) => [...s]));
    const disallowed = [...ops].filter((op) => !allowedOps.includes(op));
    if (disallowed.length > 0) {
      unauthorizedDirect.push(`${table} ${disallowed.join("/")} (outside contract) — ${[...files.keys()].join(", ")}`);
    }
  }
  if (unauthorizedDirect.length > 0) {
    report.fail(this, {
      severity: "MEDIUM",
      id: `${id}-UNAUTHORIZED-DIRECT`,
      title: "Direct client writes outside the canonical contract allowed list",
      evidence: unauthorizedDirect.join("\n"),
      detail: "Allowed direct client writes are listed in guardian/contract/canonical-contract.json → writePaths.allowedDirectClientWrites.",
    });
  } else {
    report.pass(this, `${id}-UNAUTHORIZED-DIRECT`, "All direct client writes are inside the contract allowed list", [...directWrites.keys()].sort().join(", ") || "(none)");
  }

  // Multiple write paths: table written by an RPC AND directly by the client
  const directTables = new Set(directWrites.keys());
  const multi = [];
  for (const [rpcName, info] of rpcToTables) {
    for (const t of info.tables) {
      if (directTables.has(t)) {
        multi.push(`${rpcName}() → ${t} (also written directly by client: ${[...directWrites.get(t).keys()].join(", ")})`);
      }
    }
  }
  if (multi.length > 0) {
    report.fail(this, {
      severity: "MEDIUM",
      id: `${id}-MULTI-PATH`,
      title: "Tables written by both RPC commands and the client directly",
      evidence: multi.join("\n"),
      detail: "Each business operation must have exactly one write path; direct client writes on command-owned tables increase bypass risk.",
    });
  } else {
    report.pass(this, `${id}-MULTI-PATH`, "No table is written by both an RPC and the client directly", "(none)");
  }

  // ---- Artifacts -----------------------------------------------------------
  const rpcSummary = [...rpcToTables.entries()].map(([name, info]) => ({
    rpc: name,
    calledFrom: info.files,
    writesTables: info.tables,
    triggers: info.tables.flatMap((t) => (triggerMap.get(t) ?? []).map((tr) => `${t}.${tr.trigger}→${tr.fn}`)),
  }));

  const directSummary = [...directWrites.entries()].map(([table, files]) => ({
    table,
    ops: [...new Set([...files.values()].flatMap((s) => [...s]))],
    fromFiles: [...files.keys()],
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    rpcCount: rpcSummary.length,
    directWriteTables: directSummary,
    rpcs: rpcSummary.sort((a, b) => a.rpc.localeCompare(b.rpc)),
  };
  const reportDir = ctx.cli.reportDir;
  writeArtifact(reportDir, "write-paths.json", JSON.stringify(payload, null, 2) + "\n");

  const md = [`# Write-path map — Frontend → RPC → table → trigger → function`, ""];
  md.push(`Generated ${payload.generatedAt} · ${rpcSummary.length} RPCs called from the SPA · ${directSummary.length} direct client writes`, "");
  md.push("## RPC commands", "", "| RPC | Called from | Writes tables | Triggers on those tables |");
  md.push("| --- | --- | --- | --- |");
  for (const r of rpcSummary.sort((a, b) => a.rpc.localeCompare(b.rpc))) {
    md.push(`| \`${r.rpc}()\` | ${r.calledFrom.map((f) => `\`${f}\``).join("<br>")} | ${r.writesTables.map((t) => `\`${t}\``).join(", ")} | ${r.triggers.join("<br>") || "—"} |`);
  }
  md.push("", "## Direct client writes (allowed list in canonical-contract.json)", "", "| Table | Ops | Files |");
  md.push("| --- | --- | --- |");
  for (const d of directSummary) {
    md.push(`| \`${d.table}\` | ${d.ops.join(", ")} | ${d.fromFiles.map((f) => `\`${f}\``).join("<br>")} |`);
  }
  writeArtifact(reportDir, "write-paths.md", md.join("\n") + "\n");

  report.pass(this, `${id}-ARTIFACT`, "Write-path map generated", `write-paths.md / write-paths.json (${rpcSummary.length} RPCs, ${directSummary.length} direct writes)`);
}
