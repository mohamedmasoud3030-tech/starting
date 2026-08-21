#!/usr/bin/env node
/**
 * Frontend → RPC → table → trigger → function write-path map.
 *
 * Deterministic static inventory of:
 *   - RPCs called by the SPA
 *   - direct table writes from the SPA
 *   - tables written by the FINAL migration definition of each called RPC
 *   - trigger helpers attached to those tables (best-effort artifact context)
 *
 * A table-level overlap between a sanctioned direct write and an RPC is not by
 * itself a defect: e.g. a table can allow ordinary field edits directly while
 * lifecycle transitions are command-only. The enforceable finding is a direct
 * client write outside the contract's allowed operation list.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, MIGRATIONS_DIR, migrationFiles } from "../../lib/common.mjs";
import { writeArtifact } from "../../lib/report.mjs";

export const id = "G-WRITE-PATHS";
export const title = "Frontend write paths must match the canonical contract";
export const category = "static";
export const defaultSeverity = "HIGH";
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

/**
 * Extract the dollar-quoted SQL/PLpgSQL body from CREATE FUNCTION statements.
 * Both `create function` and `create or replace function` are supported.
 * Migrations are processed in replay order and the latest definition of a
 * function name wins, matching final-schema behavior for normal RPC names.
 */
function loadRpcBodies() {
  const bodies = new Map(); // rpcName -> final body
  const startRe = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z_0-9]*)\s*\(/gi;

  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    startRe.lastIndex = 0;
    let m;
    while ((m = startRe.exec(sql)) !== null) {
      const name = m[1];
      const tail = sql.slice(startRe.lastIndex);
      const asMatch = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
      if (!asMatch) continue;

      const delimiter = asMatch[1];
      const openingAbsolute = startRe.lastIndex + asMatch.index + asMatch[0].lastIndexOf(delimiter);
      const bodyStart = openingAbsolute + delimiter.length;
      const bodyEnd = sql.indexOf(delimiter, bodyStart);
      if (bodyEnd < 0) continue;

      bodies.set(name, sql.slice(bodyStart, bodyEnd));
      startRe.lastIndex = bodyEnd + delimiter.length;
    }
  }

  return bodies;
}

const DML_RE = /\b(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:public\.)?([a-z_][a-z_0-9]*)/gi;

function tablesWritten(sqlBody) {
  const tables = new Set();
  DML_RE.lastIndex = 0;
  let m;
  while ((m = DML_RE.exec(sqlBody)) !== null) tables.add(m[2]);
  return [...tables].sort();
}

export async function run(ctx) {
  const { report, contract } = ctx;
  const rpcCalls = new Map(); // rpcName -> Set<frontendFile>
  const directWrites = new Map(); // table -> Map<frontendFile, Set<op>>

  for (const file of walk(SRC_DIR)) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);

    for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/gi)) {
      if (!rpcCalls.has(m[1])) rpcCalls.set(m[1], new Set());
      rpcCalls.get(m[1]).add(rel);
    }

    for (const m of src.matchAll(
      /\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)\s*\.(insert|update|delete|upsert)/gi,
    )) {
      const table = m[1];
      const op = m[2].toUpperCase();
      if (!directWrites.has(table)) directWrites.set(table, new Map());
      if (!directWrites.get(table).has(rel)) directWrites.get(table).set(rel, new Set());
      directWrites.get(table).get(rel).add(op);
    }
  }

  // RPC → tables written from the final migration body.
  const rpcBodies = loadRpcBodies();
  const rpcToTables = new Map();
  const missingRpcBodies = [];
  for (const [rpcName, files] of rpcCalls) {
    const body = rpcBodies.get(rpcName);
    if (!body) {
      missingRpcBodies.push(`${rpcName}() — called from ${[...files].sort().join(", ")}`);
      rpcToTables.set(rpcName, { files: [...files].sort(), tables: [] });
      continue;
    }
    rpcToTables.set(rpcName, {
      files: [...files].sort(),
      tables: tablesWritten(body),
    });
  }

  if (missingRpcBodies.length > 0) {
    report.fail(this, {
      severity: "MEDIUM",
      id: `${id}-RPC-BODY-MISSING`,
      title: "Frontend RPC calls could not be mapped to a migration function body",
      evidence: missingRpcBodies.join("\n"),
      detail:
        "This makes the static write-path artifact incomplete. Verify whether the RPC is extension/external or improve the parser before treating the map as complete.",
    });
  } else {
    report.pass(
      this,
      `${id}-RPC-BODY-MISSING`,
      "Every frontend RPC call maps to a migration function body",
      `${rpcCalls.size} RPC names`,
    );
  }

  // Trigger context for the artifact (best-effort; dynamic inventory is the
  // authority for final trigger existence).
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

  // Enforce direct writes against the canonical allowlist.
  const allowed = contract.writePaths?.allowedDirectClientWrites ?? {};
  const unauthorizedDirect = [];
  for (const [table, files] of directWrites) {
    const allowedOps = allowed[table];
    const ops = new Set([...files.values()].flatMap((s) => [...s]));
    if (!allowedOps) {
      unauthorizedDirect.push(
        `${table} ${[...ops].join("/")} — ${[...files.keys()].join(", ")}`,
      );
      continue;
    }
    const disallowed = [...ops].filter((op) => !allowedOps.includes(op));
    if (disallowed.length > 0) {
      unauthorizedDirect.push(
        `${table} ${disallowed.join("/")} (outside contract) — ${[...files.keys()].join(", ")}`,
      );
    }
  }

  if (unauthorizedDirect.length > 0) {
    report.fail(this, {
      severity: "HIGH",
      id: `${id}-UNAUTHORIZED-DIRECT`,
      title: "Direct client writes outside the canonical contract allowed list",
      evidence: unauthorizedDirect.join("\n"),
      detail:
        "Allowed direct writes are explicit in canonical-contract.json → writePaths.allowedDirectClientWrites. Command-owned tables must stay RPC-only.",
    });
  } else {
    report.pass(
      this,
      `${id}-UNAUTHORIZED-DIRECT`,
      "All direct client writes are inside the contract allowed operation list",
      [...directWrites.keys()].sort().join(", ") || "(none)",
    );
  }

  // Record table-level overlaps for review, but do not call them defects. The
  // contract/RLS layer decides which operations are allowed directly.
  const overlaps = [];
  for (const [rpcName, info] of rpcToTables) {
    for (const table of info.tables) {
      if (directWrites.has(table)) {
        overlaps.push(
          `${rpcName}() → ${table} + sanctioned direct path(s): ${[...directWrites.get(table).keys()].join(", ")}`,
        );
      }
    }
  }
  report.pass(
    this,
    `${id}-OVERLAP-INVENTORY`,
    "Table-level RPC/direct overlaps inventoried; operation-level allowlist remains authoritative",
    overlaps.join("\n") || "(none)",
  );

  // Artifacts -----------------------------------------------------------------
  const rpcSummary = [...rpcToTables.entries()].map(([name, info]) => ({
    rpc: name,
    calledFrom: info.files,
    writesTables: info.tables,
    triggers: info.tables.flatMap((t) =>
      (triggerMap.get(t) ?? []).map((tr) => `${t}.${tr.trigger}→${tr.fn}`),
    ),
  }));

  const directSummary = [...directWrites.entries()].map(([table, files]) => ({
    table,
    ops: [...new Set([...files.values()].flatMap((s) => [...s]))].sort(),
    fromFiles: [...files.keys()].sort(),
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    rpcCount: rpcSummary.length,
    unmappedRpcCount: missingRpcBodies.length,
    directWriteTables: directSummary,
    overlaps,
    rpcs: rpcSummary.sort((a, b) => a.rpc.localeCompare(b.rpc)),
  };
  const reportDir = ctx.cli.reportDir;
  writeArtifact(reportDir, "write-paths.json", JSON.stringify(payload, null, 2) + "\n");

  const md = ["# Write-path map — Frontend → RPC → table → trigger → function", ""];
  md.push(
    `Generated ${payload.generatedAt} · ${rpcSummary.length} RPCs called from the SPA · ${directSummary.length} direct-write tables · ${missingRpcBodies.length} unmapped RPCs`,
    "",
  );
  md.push("## RPC commands", "", "| RPC | Called from | Writes tables | Triggers on those tables |");
  md.push("| --- | --- | --- | --- |");
  for (const r of rpcSummary) {
    md.push(
      `| \`${r.rpc}()\` | ${r.calledFrom.map((f) => `\`${f}\``).join("<br>")} | ${r.writesTables.map((t) => `\`${t}\``).join(", ") || "—"} | ${r.triggers.join("<br>") || "—"} |`,
    );
  }
  md.push("", "## Direct client writes", "", "| Table | Ops | Files |");
  md.push("| --- | --- | --- |");
  for (const d of directSummary) {
    md.push(
      `| \`${d.table}\` | ${d.ops.join(", ")} | ${d.fromFiles.map((f) => `\`${f}\``).join("<br>")} |`,
    );
  }
  writeArtifact(reportDir, "write-paths.md", md.join("\n") + "\n");

  report.pass(
    this,
    `${id}-ARTIFACT`,
    "Write-path map generated",
    `write-paths.md / write-paths.json (${rpcSummary.length} RPCs, ${directSummary.length} direct-write tables)`,
  );
}
