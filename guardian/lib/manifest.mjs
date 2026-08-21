#!/usr/bin/env node
/**
 * Database Guardian — schema manifest extractor.
 *
 * Extracts a normalized, deterministic inventory from a PostgreSQL connection:
 * tables, columns/types, PK/FK/unique/check constraints, indexes, views
 * (incl. security_invoker + org filtering), triggers, functions/RPCs
 * (incl. SECURITY DEFINER + ACL + search_path), and RLS policies.
 *
 * The same extractor produces:
 *   - the canonical expected-schema.json (from a clean migration replay)
 *   - the manifest of ANY target database (e.g., the live Supabase project)
 * so schema drift can be computed as a pure JSON diff.
 */

const ORG_FILTER_RE = /is_org_member|has_org_role|can_read_cost|organization_id\s*=\s*(?:auth\.uid\(\)|\(?\s*select\s+auth\.uid\(\))|auth\.uid\(\)\s*=\s*organization_id/i;

export async function extractManifest(db) {
  const q = (sql) => db.query(sql);
  const tables = await q(
    `select c.relname name, obj_description(c.oid) comment,
            c.relrowsecurity rls, c.relforcerowsecurity rls_forced
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'
       and c.relname not like '\\_pgtap\\_%'
     order by c.relname`,
  );
  const columns = await q(
    `select t.table_name, c.column_name, c.data_type, c.udt_name,
            c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default,
            c.character_maximum_length
     from information_schema.tables t
     join information_schema.columns c on c.table_schema=t.table_schema and c.table_name=t.table_name
     where t.table_schema='public' and t.table_type='BASE TABLE'
     order by t.table_name, c.ordinal_position`,
  );
  const constraints = await q(
    `select tc.table_name, tc.constraint_name, tc.constraint_type,
            kcu.column_name, ccu.table_name ref_table, ccu.column_name ref_column
     from information_schema.table_constraints tc
     left join information_schema.key_column_usage kcu
       on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
     left join information_schema.constraint_column_usage ccu
       on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema
     where tc.table_schema='public' and tc.constraint_type in ('PRIMARY KEY','FOREIGN KEY','UNIQUE','CHECK')
     order by tc.table_name, tc.constraint_name, kcu.ordinal_position`,
  );
  const indexes = await q(
    `select tablename, indexname, indexdef
     from pg_indexes where schemaname='public'
     order by tablename, indexname`,
  );
  const views = await q(
    `select c.relname name, c.reloptions,
            (c.reloptions is not null and array_to_string(c.reloptions, ',') like '%security_invoker=true%') security_invoker,
            pg_get_viewdef(c.oid) def
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('v','m')
     order by c.relname`,
  );
  const funcs = await q(
    `select p.proname name, pg_get_function_identity_arguments(p.oid) args,
            p.prosecdef secdef, p.proconfig, p.proacl,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
            pg_get_functiondef(p.oid) def
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prokind in ('f','p')
     order by p.proname, pg_get_function_identity_arguments(p.oid)`,
  );
  const triggers = await q(
    `select event_object_table tbl, trigger_name, action_timing, string_agg(event_manipulation, ',') events, action_statement
     from information_schema.triggers
     where trigger_schema='public' and event_object_table is not null
     group by event_object_table, trigger_name, action_timing, action_statement
     order by event_object_table, trigger_name`,
  );
  const policies = await q(
    `select c.relname tbl, p.polname name, p.polcmd cmd,
            (select string_agg(rolname, ',') from pg_roles r where r.oid = any(p.polroles)) roles,
            pg_get_expr(p.polqual, p.polrelid) using_expr,
            pg_get_expr(p.polwithcheck, p.polrelid) check_expr
     from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' order by c.relname, p.polname`,
  );
  const enums = await q(
    `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
     from pg_type t join pg_enum e on e.enumtypid=t.oid
     where t.typnamespace='public'::regnamespace
     group by t.typname order by t.typname`,
  );

  const manifest = {
    extractedAt: new Date().toISOString(),
    tables: {},
    views: {},
    functions: {},
    triggers: [],
    policies: [],
    enums: {},
  };

  for (const r of tables.rows) {
    manifest.tables[r.name] = {
      comment: r.comment ?? null,
      rls: r.rls,
      rlsForced: r.rls_forced,
      columns: {},
      primaryKey: [],
      foreignKeys: [],
      uniques: [],
      checks: [],
      indexes: [],
    };
  }
  for (const r of columns.rows) {
    const t = manifest.tables[r.table_name];
    if (!t) continue;
    t.columns[r.column_name] = {
      type: r.data_type,
      udt: r.udt_name,
      precision: r.numeric_precision ?? null,
      scale: r.numeric_scale ?? null,
      maxLength: r.character_maximum_length ?? null,
      nullable: r.is_nullable === "YES",
      default: r.column_default ?? null,
    };
  }
  const fkByTable = new Map();
  for (const r of constraints.rows) {
    const t = manifest.tables[r.table_name];
    if (!t) continue;
    if (r.constraint_type === "PRIMARY KEY") {
      if (r.column_name) t.primaryKey.push(r.column_name);
    } else if (r.constraint_type === "FOREIGN KEY") {
      if (!fkByTable.has(r.table_name)) fkByTable.set(r.table_name, new Map());
      const m = fkByTable.get(r.table_name);
      const key = r.constraint_name;
      if (!m.has(key)) m.set(key, { name: key, cols: [], refTable: r.ref_table, refCols: [] });
      if (r.column_name) m.get(key).cols.push(r.column_name);
      if (r.ref_column) m.get(key).refCols.push(r.ref_column);
    } else if (r.constraint_type === "UNIQUE") {
      if (r.column_name) {
        const u = t.uniques.find((x) => x.name === r.constraint_name) ?? { name: r.constraint_name, cols: [] };
        if (!t.uniques.includes(u)) t.uniques.push(u);
        u.cols.push(r.column_name);
      }
    } else if (r.constraint_type === "CHECK") {
      if (!t.checks.includes(r.constraint_name)) t.checks.push(r.constraint_name);
    }
  }
  for (const [table, m] of fkByTable) {
    manifest.tables[table].foreignKeys = [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const r of indexes.rows) {
    const t = manifest.tables[r.tablename];
    if (!t) continue;
    t.indexes.push({ name: r.indexname, def: r.indexdef });
  }
  for (const r of views.rows) {
    manifest.views[r.name] = {
      securityInvoker: r.security_invoker,
      orgFiltered: ORG_FILTER_RE.test(r.def),
    };
  }
  for (const r of funcs.rows) {
    const key = `${r.name}(${r.args})`;
    const cfg = (r.proconfig ?? []).join(";");
    const def = r.def;
    manifest.functions[key] = {
      name: r.name,
      args: r.args,
      secdef: r.prosecdef,
      searchPathPinned: /search_path/i.test(cfg),
      aclNull: r.proacl === null,
      anonExec: r.anon_exec,
      authExec: r.auth_exec,
      bodyWrites: /(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:public\.)?[a-z_]+\b/i.test(def),
      bodyHasRoleGuard: /has_org_role|is_org_member|can_read_cost|auth\.uid\(\)/i.test(def),
    };
  }
  for (const r of triggers.rows) {
    manifest.triggers.push({
      table: r.tbl,
      name: r.trigger_name,
      timing: r.action_timing,
      events: r.events,
      statement: r.action_statement.slice(0, 200),
    });
  }
  for (const r of policies.rows) {
    manifest.policies.push({
      table: r.tbl,
      name: r.name,
      cmd: r.cmd,
      roles: r.roles ?? "ALL",
      using: (r.using_expr ?? "").slice(0, 300),
      check: (r.check_expr ?? "").slice(0, 300),
    });
  }
  for (const r of enums.rows) manifest.enums[r.typname] = r.labels.split(",");
  return manifest;
}

/** Normalizes a manifest for deterministic comparison (drops timestamps, volatile defs). */
export function normalizeForComparison(manifest) {
  const tables = {};
  for (const [name, t] of Object.entries(manifest.tables ?? {})) {
    tables[name] = {
      rls: t.rls,
      columns: t.columns,
      primaryKey: [...t.primaryKey].sort(),
      foreignKeys: t.foreignKeys.map((f) => ({
        cols: [...f.cols].sort(),
        refTable: f.refTable,
        refCols: [...f.refCols].sort(),
      })).sort((a, b) => `${a.cols.join(",")}->${a.refTable}`.localeCompare(`${b.cols.join(",")}->${b.refTable}`)),
      uniques: t.uniques.map((u) => ({ cols: [...u.cols].sort() })).sort((a, b) => a.cols.join(",").localeCompare(b.cols.join(","))),
      checks: [...t.checks].sort(),
      indexes: t.indexes.map((i) => i.name).sort(),
    };
  }
  const views = {};
  for (const [name, v] of Object.entries(manifest.views ?? {})) {
    views[name] = { securityInvoker: v.securityInvoker, orgFiltered: v.orgFiltered };
  }
  const functions = {};
  for (const [key, f] of Object.entries(manifest.functions ?? {})) {
    functions[key] = {
      secdef: f.secdef,
      searchPathPinned: f.searchPathPinned,
      aclNull: f.aclNull,
      anonExec: f.anonExec,
      authExec: f.authExec,
      bodyWrites: f.bodyWrites,
      bodyHasRoleGuard: f.bodyHasRoleGuard,
    };
  }
  return { tables, views, functions, enums: manifest.enums ?? {} };
}
