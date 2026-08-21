#!/usr/bin/env node
/**
 * Database Guardian — check registry.
 *
 * Every check is a module exporting:
 *   {
 *     id:        "G-CHECK-NAME"          (stable identifier)
 *     title:     human-readable title
 *     category:  "static" | "schema" | "security" | "data" | "financial" | "migrations" | "rls" | "inventory"
 *     defaultSeverity: severity when the check fails without a more specific one
 *     mode:      "static" | "dynamic"
 *     run(ctx)   async — adds PASS/FAIL findings to ctx.report
 *   }
 *
 * ctx = {
 *   report,           Report instance
 *   cli,              parsed CLI args
 *   contract,         canonical-contract.json contents
 *   db,               open connection to the replayed scratch DB (dynamic only)
 *   scratchName,      scratch DB name
 *   paths,            git-changed paths (PR context)
 * }
 */
import * as migrationImmutability from "./static/migration-immutability.mjs";
import * as migrationHygiene from "./static/migration-hygiene.mjs";
import * as frontendWritePaths from "./static/frontend-write-paths.mjs";

import * as inventory from "./dynamic/inventory.mjs";
import * as schemaDrift from "./dynamic/schema-drift.mjs";
import * as functionAcl from "./dynamic/function-acl.mjs";
import * as viewSecurity from "./dynamic/view-security.mjs";
import * as rlsIntegrity from "./dynamic/rls-integrity.mjs";
import * as dataIntegrity from "./dynamic/data-integrity.mjs";
import * as financialIntegrity from "./dynamic/financial-integrity.mjs";
import * as migrationGuardian from "./dynamic/migration-guardian.mjs";
import * as tenantIsolation from "./dynamic/tenant-isolation.mjs";

export const CHECKS = [
  migrationImmutability,
  migrationHygiene,
  frontendWritePaths,
  inventory,
  schemaDrift,
  functionAcl,
  viewSecurity,
  rlsIntegrity,
  dataIntegrity,
  financialIntegrity,
  migrationGuardian,
  tenantIsolation,
];

export function checksFor(mode) {
  if (mode === "all") return CHECKS;
  return CHECKS.filter((c) => c.mode === mode);
}
