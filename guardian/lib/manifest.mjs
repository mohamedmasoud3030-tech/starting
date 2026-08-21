#!/usr/bin/env node
/**
 * Database Guardian — schema manifest extractor.
 *
 * Extracts a normalized, deterministic inventory from the isolated PostgreSQL
 * scratch replay: tables, columns/types, PK/FK/unique/check constraints,
 * indexes, views, triggers, functions/RPCs, RLS policies and enums.
 *
 * Composite foreign keys are read from pg_constraint using matching ordinality
 * for conkey/confkey. Do not use an information_schema cross join here: that
 * loses child→parent column pairing on multi-column tenant-safe FKs.
 */

const ORG_FILTER_RE = /\b(?:is_org_member|has_org_role|can_[a-z_][a-z_0-9]*)\s*\(|organization_memberships[\s\S]{0,800}auth\.uid\(\)|auth\.uid\(\)[\s\S]{0,800}organization_memberships/i;
const AUTHZ_GUARD_RE = /\b(?:is_org_member|has_org_role|can_[a-z_][a-z_0-9]*|require_[a-z_][a-z_0-9]*)\s*\(|organization_memberships[\s\S]{0,1200}auth\.uid\(\)|auth\.uid\(\)[\s\S]{0,1200}organization_memberships/i;

export async function extractManifest(db) {
  const q = (sql) => db.query(sql);

  const tables = await q(
    `select c.relname name, obj_description(c.oid) comment,
            c.relrowsecurity rls, c.relforcerowsecurity rls_forced
       from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
        and c.relkind='r'
        and c.relname not like '\\_pgtap\\_%'
      order by c.relname`,
  );

  const columns = await q(
    `select t.table_name, c.column_name, c.data_type, c.udt_name,
            c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default,
            c.character_maximum_length
       from information_schema.tables t
       join information_schema.columns c
         on c.table_schema=t.table_schema and c.table_name=t.table_name
      where t.table_schema='public' and t.table_type='BASE TABLE'
      order by t.table_name, c.ordinal_position`,
  );

  const constraints = await q(
    `select child_rel.relname table_name,
            con.conname constraint_name,
            case con.contype
              when 'p' then 'PRIMARY KEY'
              when 'f' then 'FOREIGN KEY'
              when 'u' then 'UNIQUE'
              when 'c' then 'CHECK'
            end constraint_type,
            child_att.attname column_name,
            parent_rel.relname ref_table,
            parent_att.attname ref_column,
            child_key.ord
       from pg_constraint con
       join pg_class child_rel on child_rel.oid=con.conrelid
       join pg_namespace child_ns on child_ns.oid=child_rel.relnamespace
       left join lateral unnest(con.conkey) with ordinality
         as child_key(attnum, ord) on true
       left join pg_attribute child_att
         on child_att.attrelid=child_rel.oid and child_att.attnum=child_key.attnum
       left join pg_class parent_rel on parent_rel.oid=con.confrelid
       left join lateral unnest(con.confkey) with ordinality
         as parent_key(attnum, ord) on con.contype='f' and parent_key.ord=child_key.ord
       left join pg_attribute parent_att
         on parent_att.attrelid=parent_rel.oid and parent_att.attnum=parent_key.attnum
      where child_ns.nspname='public'
        and con.contype in ('p','f','u','c')
      order by child_rel.relname, con.conname, child_key.ord nulls first`,
  );

  const indexes = await q(
    `select tablename, indexname, indexdef
       from pg_indexes
      where schemaname='public'
      order by tablename, indexname`,
  );

  const views = await q(
    `select c.relname name, c.reloptions,
            (c.reloptions is not null and array_to_string(c.reloptions, ',') like '%security_invoker=true%') security_invoker,
            pg_get_viewdef(c.oid) def
       from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('v','m')
      order by c.relname`,
  );

  const funcs = await q(
    `select p.proname name, pg_get_function_identity_arguments(p.oid) args,
            p.prosecdef secdef, p.proconfig, p.proacl,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
            pg_get_functiondef(p.oid) def
       from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind in ('f','p')
      order by p.proname, pg_get_function_identity_arguments(p.oid)`,
  );

  const triggers = await q(
    `select event_object_table tbl, trigger_name, action_timing,
            string_agg(event_manipulation, ',' order by event_manipulation) events,
            action_statement
       from information_schema.triggers
      where trigger_schema='public' and event_object_table is not null
      group by event_object_table, trigger_name, action_timing, action_statement
      order by event_object_table, trigger_name`,
  );

  const policies = await q(
    `select c.relname tbl, p.polname name, p.polcmd cmd,
            (select string_agg(rolname, ',' order by rolname)
               from pg_roles r where r.oid = any(p.polroles)) roles,
            pg_get_expr(p.polqual, p.polrelid) using_expr,
            pg_get_expr(p.polwithcheck, p.polrelid) check_expr
       from pg_policy p
       join pg_class c on c.oid=p.polrelid
       join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
      order by c.relname, p.polname`,
  );

  const enums = await q(
    `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
       from pg_type t
       join pg_enum e on e.enumtypid=t.oid
      where t.typnamespace='public'::regnamespace
      group by t.typname
      order by t.typname`,
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
      continue;
    }

    if (r.constraint_type === "FOREIGN KEY") {
      if (!fkByTable.has(r.table_name)) fkByTable.set(r.table_name, new Map());
      const byName = fkByTable.get(r.table_name);
      if (!byName.has(r.constraint_name)) {
        byName.set(r.constraint_name, {
          name: r.constraint_name,
          cols: [],
          refTable: r.ref_table,
          refCols: [],
        });
      }
      const fk = byName.get(r.constraint_name);
      if (r.column_name) fk.cols.push(r.column_name);
      if (r.ref_column) fk.refCols.push(r.ref_column);
      continue;
    }

    if (r.constraint_type === "UNIQUE") {
      if (!r.column_name) continue;
      let u = t.uniques.find((x) => x.name === r.constraint_name);
      if (!u) {
        u = { name: r.constraint_name, cols: [] };
        t.uniques.push(u);
      }
      u.cols.push(r.column_name);
      continue;
    }

    if (r.constraint_type === "CHECK" && !t.checks.includes(r.constraint_name)) {
      t.checks.push(r.constraint_name);
    }
  }

  for (const [table, byName] of fkByTable) {
    manifest.tables[table].foreignKeys = [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
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
      searchPathPinned: /(?:^|;)search_path\s*=/i.test(cfg),
      aclNull: r.proacl === null,
      anonExec: r.anon_exec,
      authExec: r.auth_exec,
      bodyWrites: /\b(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:public\.)?[a-z_]+\b/i.test(def),
      bodyHasRoleGuard: AUTHZ_GUARD_RE.test(def),
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

/** Normalize a manifest for deterministic schema comparison. */
export function normalizeForComparison(manifest) {
  const tables = {};
  for (const [name, t] of Object.entries(manifest.tables ?? {})) {
    tables[name] = {
      rls: t.rls,
      columns: t.columns,
      primaryKey: [...t.primaryKey].sort(),
      foreignKeys: t.foreignKeys
        .map((f) => {
          const pairs = f.cols
            .map((col, i) => [col, f.refCols[i] ?? null])
            .sort((a, b) => a[0].localeCompare(b[0]));
          return {
            cols: pairs.map(([col]) => col),
            refTable: f.refTable,
            refCols: pairs.map(([, refCol]) => refCol),
          };
        })
        .sort((a, b) =>
          `${a.cols.join(",")}->${a.refTable}:${a.refCols.join(",")}`.localeCompare(
            `${b.cols.join(",")}->${b.refTable}:${b.refCols.join(",")}`,
          ),
        ),
      uniques: t.uniques
        .map((u) => ({ cols: [...u.cols].sort() }))
        .sort((a, b) => a.cols.join(",").localeCompare(b.cols.join(","))),
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
