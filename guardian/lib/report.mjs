#!/usr/bin/env node
/**
 * Database Guardian — report rendering (JSON / Markdown / CSV).
 *
 * Every run produces a machine-readable JSON report plus human summaries.
 * Each finding carries: id, check, category, severity, status (PASS/FAIL),
 * title, evidence, detail.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEVERITY_RANK } from "./common.mjs";

export function renderSummaryMd(report, { durationMs, dbTarget, modes }) {
  const failed = report.failed;
  const lines = [];
  lines.push(`# Database Guardian Report — ${report.runId}`);
  lines.push("");
  lines.push(`- **Started**: ${report.startedAt}`);
  lines.push(`- **Duration**: ${(durationMs / 1000).toFixed(1)}s`);
  lines.push(`- **DB target**: ${dbTarget ?? "n/a"}`);
  lines.push(`- **Modes**: ${(modes ?? []).join(", ")}`);
  lines.push(`- **Branch**: ${report.meta.branch ?? "n/a"} @ ${report.meta.head ?? "n/a"}`);
  lines.push(`- **Checks run**: ${report.meta.checksRun ?? 0}`);
  lines.push(`- **Findings**: ${report.findings.length} (PASS ${report.passed.length} / FAIL ${failed.length})`);
  lines.push(`- **Worst severity**: ${report.worstSeverity()}`);
  lines.push("");
  lines.push("## Summary by severity");
  lines.push("");
  lines.push("| Severity | FAIL | PASS |");
  lines.push("| --- | --- | --- |");
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]) {
    const fails = failed.filter((f) => f.severity === sev).length;
    const passes = report.passed.filter((f) => f.severity === sev).length;
    if (fails + passes > 0) lines.push(`| ${sev} | ${fails} | ${passes} |`);
  }
  lines.push("");
  if (failed.length === 0) {
    lines.push("## All checks PASSED ✅");
    lines.push("");
  } else {
    lines.push("## Failed findings");
    lines.push("");
    lines.push("| ID | Severity | Check | Title |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of [...failed].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
      lines.push(`| ${f.id} | **${f.severity}** | ${f.check} | ${f.title.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
    lines.push("### Details");
    lines.push("");
    for (const f of [...failed].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
      lines.push(`#### ${f.id} [${f.severity}] — ${f.title}`);
      lines.push("");
      lines.push(`- **Check**: \`${f.check}\``);
      lines.push(`- **Category**: ${f.category}`);
      lines.push(`- **Evidence**:`);
      lines.push("");
      lines.push("```text");
      lines.push(f.evidence.slice(0, 2000));
      lines.push("```");
      if (f.detail) {
        lines.push(`- **Detail**: ${f.detail.slice(0, 2000)}`);
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("Machine-readable: `report.json` · Full inventory: `inventory.md` · Write-path map: `write-paths.md`");
  return lines.join("\n");
}

export function renderCsv(report) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["id", "check", "category", "severity", "status", "title", "evidence", "detail"]];
  for (const f of report.findings) {
    rows.push([f.id, f.check, f.category, f.severity, f.status, f.title, f.evidence, f.detail].map(esc).join(","));
  }
  return rows.join("\n") + "\n";
}

export function writeReport(reportDir, report, { durationMs, dbTarget, modes, extra = {} }) {
  mkdirSync(reportDir, { recursive: true });
  const payload = {
    schemaVersion: "1.0.0",
    runId: report.runId,
    startedAt: report.startedAt,
    durationMs,
    dbTarget,
    modes,
    meta: report.meta,
    worstSeverity: report.worstSeverity(),
    summary: {
      total: report.findings.length,
      passed: report.passed.length,
      failed: report.failed.length,
      bySeverity: Object.fromEntries(
        ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => [
          s,
          {
            failed: report.failed.filter((f) => f.severity === s).length,
            passed: report.passed.filter((f) => f.severity === s).length,
          },
        ]),
      ),
    },
    findings: report.findings,
    ...extra,
  };
  writeFileSync(join(reportDir, "report.json"), JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(join(reportDir, "summary.md"), renderSummaryMd(report, { durationMs, dbTarget, modes }));
  writeFileSync(join(reportDir, "findings.csv"), renderCsv(report));
  return payload;
}

export function writeArtifact(reportDir, name, data) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, name), data);
}
