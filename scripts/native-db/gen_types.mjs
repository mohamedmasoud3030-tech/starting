#!/usr/bin/env node
/**
 * SUPPLEMENTARY (Layer A) — byte-exact TypeScript type generation for
 * `src/lib/database.types.ts`, against a native PostgreSQL database (no
 * Docker). Faithfully replicates the supabase `pg-meta` TypeScript generator
 * (schema introspection + view-relationship inference + prettier@3.3.3
 * formatting, `semi: false`) so the committed file matches what CI's
 * `supabase gen types typescript --local --schema public` produces.
 *
 * Usage (after `make_types_db.mjs`):
 *   node scripts/native-db/gen_types.mjs postgres://postgres:postgres@127.0.0.1:5433/hospitality_types > src/lib/database.types.ts
 *
 * The authoritative acceptance environment remains the official Supabase
 * stack in CI (Layer B).
 */
import pg from "pg";
import prettier from "prettier";

pg.types.setTypeParser(pg.types.builtins.INT8, (x) => {
  const asNumber = Number(x);
  if (Number.isSafeInteger(asNumber)) return asNumber;
  return x;
});
pg.types.setTypeParser(pg.types.builtins.DATE, (x) => x);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (x) => x);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (x) => x);

const dbUrl = process.argv[2] ?? "postgres://postgres@127.0.0.1:5433/hospitality_types";
const schemaFilter = "= 'public'";

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const SCHEMAS_SQL = `
select n.oid::int8 as id, n.nspname as name, u.rolname as owner
from pg_namespace n, pg_roles u
where n.nspowner = u.oid
  and not pg_catalog.starts_with(n.nspname, 'pg_')
  and (pg_has_role(n.nspowner, 'USAGE') or has_schema_privilege(n.oid, 'CREATE, USAGE'))
  and not pg_catalog.starts_with(n.nspname, 'pg_temp_')
  and not pg_catalog.starts_with(n.nspname, 'pg_toast_temp_')`;

const TABLES_SQL = `
SELECT c.oid::int8 AS id, nc.nspname AS schema, c.relname AS name
FROM pg_namespace nc JOIN pg_class c ON nc.oid = c.relnamespace
WHERE nc.nspname ${schemaFilter} AND c.relkind IN ('r','p')
  AND NOT pg_is_other_temp_schema(nc.oid)
  AND (pg_has_role(c.relowner,'USAGE') OR has_table_privilege(c.oid,'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') OR has_any_column_privilege(c.oid,'SELECT, INSERT, UPDATE, REFERENCES'))`;

const FOREIGN_TABLES_SQL = `
SELECT c.oid::int8 AS id, nc.nspname AS schema, c.relname AS name
FROM pg_namespace nc JOIN pg_class c ON nc.oid = c.relnamespace
WHERE nc.nspname ${schemaFilter} AND c.relkind IN ('f') AND NOT pg_is_other_temp_schema(nc.oid)`;

const VIEWS_SQL = `
SELECT c.oid::int8 AS id, n.nspname AS schema, c.relname AS name,
  (pg_relation_is_updatable(c.oid, false) & 20) = 20 AS is_updatable
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname ${schemaFilter} AND c.relkind = 'v'`;

const MATERIALIZED_VIEWS_SQL = `
SELECT c.oid::int8 AS id, n.nspname AS schema, c.relname AS name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname ${schemaFilter} AND c.relkind = 'm'`;

const COLUMNS_SQL = `
SELECT
  c.oid::int8 AS table_id, nc.nspname AS schema, c.relname AS table,
  (c.oid || '.' || a.attnum) AS id, a.attnum AS ordinal_position, a.attname AS name,
  CASE WHEN a.atthasdef THEN pg_get_expr(ad.adbin, ad.adrelid) ELSE NULL END AS default_value,
  COALESCE(bt.typname, t.typname) AS format,
  a.attidentity IN ('a','d') AS is_identity,
  CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' ELSE NULL END AS identity_generation,
  a.attgenerated IN ('s') AS is_generated,
  NOT (a.attnotnull OR t.typtype = 'd' AND t.typnotnull) AS is_nullable,
  (c.relkind IN ('r','p') OR c.relkind IN ('v','f') AND pg_column_is_updatable(c.oid, a.attnum, FALSE)) AS is_updatable
FROM pg_attribute a
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  JOIN (pg_class c JOIN pg_namespace nc ON c.relnamespace = nc.oid) ON a.attrelid = c.oid
  JOIN (pg_type t JOIN pg_namespace nt ON t.typnamespace = nt.oid) ON a.atttypid = t.oid
  LEFT JOIN (pg_type bt JOIN pg_namespace nbt ON bt.typnamespace = nbt.oid) ON t.typtype = 'd' AND t.typbasetype = bt.oid
WHERE nc.nspname ${schemaFilter}
  AND NOT pg_is_other_temp_schema(nc.oid)
  AND a.attnum > 0 AND NOT a.attisdropped
  AND (c.relkind IN ('r','v','m','f','p'))
  AND (pg_has_role(c.relowner,'USAGE') OR has_column_privilege(c.oid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES'))`;

const RELATIONSHIPS_SQL = `
WITH pks_uniques_cols AS (
  SELECT connamespace, conrelid, jsonb_agg(column_info.cols) as cols
  FROM pg_constraint
  JOIN lateral (
    SELECT array_agg(cols.attname order by cols.attnum) as cols
    FROM (select unnest(conkey) as col) _
    JOIN pg_attribute cols on cols.attrelid = conrelid and cols.attnum = col
  ) column_info ON TRUE
  WHERE contype IN ('p','u') and connamespace::regnamespace::text <> 'pg_catalog'
    and connamespace::regnamespace::text ${schemaFilter}
  GROUP BY connamespace, conrelid
)
SELECT traint.conname AS foreign_key_name, ns1.nspname AS schema, tab.relname AS relation,
  column_info.cols AS columns, ns2.nspname AS referenced_schema, other.relname AS referenced_relation,
  column_info.refs AS referenced_columns,
  (column_info.cols IN (SELECT * FROM jsonb_array_elements(pks_uqs.cols))) AS is_one_to_one
FROM pg_constraint traint
JOIN LATERAL (
  SELECT jsonb_agg(cols.attname order by ord) AS cols, jsonb_agg(refs.attname order by ord) AS refs
  FROM unnest(traint.conkey, traint.confkey) WITH ORDINALITY AS _(col, ref, ord)
  JOIN pg_attribute cols ON cols.attrelid = traint.conrelid AND cols.attnum = col
  JOIN pg_attribute refs ON refs.attrelid = traint.confrelid AND refs.attnum = ref
  WHERE traint.connamespace::regnamespace::text ${schemaFilter}
) AS column_info ON TRUE
JOIN pg_namespace ns1 ON ns1.oid = traint.connamespace
JOIN pg_class tab ON tab.oid = traint.conrelid
JOIN pg_class other ON other.oid = traint.confrelid
JOIN pg_namespace ns2 ON ns2.oid = other.relnamespace
LEFT JOIN pks_uniques_cols pks_uqs ON pks_uqs.connamespace = traint.connamespace AND pks_uqs.conrelid = traint.conrelid
WHERE traint.contype = 'f' AND traint.conparentid = 0 AND ns1.nspname ${schemaFilter}`;

const FUNCTIONS_SQL = `
with functions as (
  select p.*,
    coalesce(p.proargmodes, array_fill('i'::text, array[cardinality(coalesce(p.proallargtypes, p.proargtypes))])) as arg_modes,
    coalesce(p.proargnames, array_fill(''::text, array[cardinality(coalesce(p.proallargtypes, p.proargtypes))])) as arg_names,
    coalesce(p.proallargtypes, p.proargtypes) as arg_types,
    array_cat(array_fill(false, array[pronargs - pronargdefaults]), array_fill(true, array[pronargdefaults])) as arg_has_defaults
  from pg_proc as p
  join pg_namespace n on p.pronamespace = n.oid
  where n.nspname ${schemaFilter} and p.prokind = 'f'
)
select f.oid::int8 as id, n.nspname as schema, f.proname as name,
  coalesce(f_args.args, '[]') as args,
  pg_get_function_arguments(f.oid) as argument_types,
  f.prorettype::int8 as return_type_id,
  pg_get_function_result(f.oid) as return_type,
  nullif(rt.typrelid::int8, 0) as return_type_relation_id,
  f.proretset as is_set_returning_function,
  case when f.proretset then nullif(f.prorows, 0) else null end as prorows
from functions f
  left join pg_namespace n on f.pronamespace = n.oid
  left join pg_type rt on rt.oid = f.prorettype
  left join (
    select oid, jsonb_agg(jsonb_build_object('mode', t2.mode, 'name', name, 'type_id', type_id, 'has_default', has_default)) as args
    from (
      select oid, unnest(arg_modes) as mode, unnest(arg_names) as name, unnest(arg_types)::int8 as type_id, unnest(arg_has_defaults) as has_default
      from functions
    ) as t1,
    lateral (select case when t1.mode='i' then 'in' when t1.mode='o' then 'out' when t1.mode='b' then 'inout' when t1.mode='v' then 'variadic' else 'table' end as mode) as t2
    group by t1.oid
  ) f_args on f_args.oid = f.oid`;

const VIEWS_KEY_DEPENDENCIES_SQL = `
with recursive
pks_fks as (
  select contype::text as contype, conname, array_length(conkey, 1) as ncol, conrelid as resorigtbl, col as resorigcol, ord
  from pg_constraint
  left join lateral unnest(conkey) with ordinality as _(col, ord) on true
  where contype IN ('p', 'f')
  union
  select concat(contype, '_ref') as contype, conname, array_length(confkey, 1) as ncol, confrelid, col, ord
  from pg_constraint
  left join lateral unnest(confkey) with ordinality as _(col, ord) on true
  where contype='f' and connamespace::regnamespace::text ${schemaFilter}
),
views as (
  select c.oid as view_id, n.nspname as view_schema, c.relname as view_name, r.ev_action as view_definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_rewrite r on r.ev_class = c.oid
  where c.relkind in ('v', 'm') and n.nspname ${schemaFilter}
),
transform_json as (
  select
    view_id, view_schema, view_name,
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    regexp_replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
      view_definition::text,
    '<>'              , '()'
    ), ','               , ''
    ), E'\\\\{'            , ''
    ), E'\\\\}'            , ''
    ), ' :targetList '   , ',"targetList":'
    ), ' :resno '        , ',"resno":'
    ), ' :resorigtbl '   , ',"resorigtbl":'
    ), ' :resorigcol '   , ',"resorigcol":'
    ), '{'               , '{ :'
    ), '(('              , '{(('
    ), '({'              , '{({'
    ), ' :[^}{,]+'       , ',"":'              , 'g'
    ), ',"":}'           , '}'
    ), ',"":,'           , ','
    ), '{('              , '('
    ), '{,'              , '{'
    ), '('               , '['
    ), ')'               , ']'
    ), ' '             , ','
  )::json as view_definition
  from views
),
target_entries as(
  select view_id, view_schema, view_name, json_array_elements(view_definition->0->'targetList') as entry
  from transform_json
),
results as(
  select view_id, view_schema, view_name, (entry->>'resno')::int as view_column, (entry->>'resorigtbl')::oid as resorigtbl, (entry->>'resorigcol')::int as resorigcol
  from target_entries
),
recursion(view_id, view_schema, view_name, view_column, resorigtbl, resorigcol, is_cycle, path) as(
  select r.*, false, ARRAY[resorigtbl] from results r
  where view_schema ${schemaFilter}
  union all
  select view.view_id, view.view_schema, view.view_name, view.view_column, tab.resorigtbl, tab.resorigcol, tab.resorigtbl = ANY(path), path || tab.resorigtbl
  from recursion view
  join results tab on view.resorigtbl=tab.view_id and view.resorigcol=tab.view_column
  where not is_cycle
),
repeated_references as(
  select view_id, view_schema, view_name, resorigtbl, resorigcol, array_agg(attname) as view_columns
  from recursion
  join pg_attribute vcol on vcol.attrelid = view_id and vcol.attnum = view_column
  group by view_id, view_schema, view_name, resorigtbl, resorigcol
)
select sch.nspname as table_schema, tbl.relname as table_name, rep.view_schema, rep.view_name, pks_fks.conname as constraint_name, pks_fks.contype as constraint_type,
  jsonb_agg(jsonb_build_object('table_column', col.attname, 'view_columns', view_columns) order by pks_fks.ord) as column_dependencies
from repeated_references rep
join pks_fks using (resorigtbl, resorigcol)
join pg_class tbl on tbl.oid = rep.resorigtbl
join pg_attribute col on col.attrelid = tbl.oid and col.attnum = rep.resorigcol
join pg_namespace sch on sch.oid = tbl.relnamespace
group by sch.nspname, tbl.relname, rep.view_schema, rep.view_name, pks_fks.conname, pks_fks.contype, pks_fks.ncol
having ncol = array_length(array_agg(row(col.attname, view_columns) order by pks_fks.ord), 1)`;

const TYPES_SQL = `
select t.oid::int8 as id, t.typname as name, n.nspname as schema, format_type(t.oid, null) as format,
  coalesce(t_enums.enums, '[]') as enums, coalesce(t_attributes.attributes, '[]') as attributes,
  nullif(t.typrelid::int8, 0) as type_relation_id
from pg_type t
  left join pg_namespace n on n.oid = t.typnamespace
  left join (select enumtypid, jsonb_agg(enumlabel order by enumsortorder) as enums from pg_enum group by enumtypid) as t_enums on t_enums.enumtypid = t.oid
  left join (
    select oid, jsonb_agg(jsonb_build_object('name', a.attname, 'type_id', a.atttypid::int8) order by a.attnum asc) as attributes
    from pg_class c join pg_attribute a on a.attrelid = c.oid
    where c.relkind = 'c' and not a.attisdropped group by c.oid
  ) as t_attributes on t_attributes.oid = t.typrelid
where (t.typrelid = 0 or (select c.relkind from pg_class c where c.oid = t.typrelid) in ('c','r','v','m','p'))`;

async function q(sql) {
  const r = await client.query(sql);
  return r.rows;
}

let schemas = (await q(SCHEMAS_SQL)).filter((s) => s.name === 'public');
const tables = await q(TABLES_SQL);
const foreignTables = await q(FOREIGN_TABLES_SQL);
const views = await q(VIEWS_SQL);
const materializedViews = await q(MATERIALIZED_VIEWS_SQL);
const columns = await q(COLUMNS_SQL);
const relationships = await q(RELATIONSHIPS_SQL);
const viewsKeyDependencies = await q(VIEWS_KEY_DEPENDENCIES_SQL);
const functions = (await q(FUNCTIONS_SQL)).filter(({ return_type }) => !['trigger', 'event_trigger'].includes(return_type));
const types = await q(TYPES_SQL);

// ---- view relationships expansion (port of PostgresMetaRelationships.list) ----
const allTableM2oAndO2oRelationships = relationships;
{
  const expandKeyDepCols = (colDeps) => {
    const tableColumns = colDeps.map(({ table_column }) => table_column);
    const cartesianProduct = (allEntries) =>
      allEntries.reduce((results, entries) => results.map((result) => entries.map((entry) => result.concat(entry))).reduce((subResults, result) => subResults.concat(result), []), [[]]);
    const viewColumnsPermutations = cartesianProduct(colDeps.map((cd) => cd.view_columns));
    return viewColumnsPermutations.map((viewColumns) => ({ tableColumns, viewColumns }));
  };

  const viewRelationships = allTableM2oAndO2oRelationships.flatMap((r) => {
    const viewToTableKeyDeps = viewsKeyDependencies.filter((vkd) => vkd.table_schema === r.schema && vkd.table_name === r.relation && vkd.constraint_name === r.foreign_key_name && vkd.constraint_type === 'f');
    const tableToViewKeyDeps = viewsKeyDependencies.filter((vkd) => vkd.table_schema === r.referenced_schema && vkd.table_name === r.referenced_relation && vkd.constraint_name === r.foreign_key_name && vkd.constraint_type === 'f_ref');

    const viewToTableRelationships = viewToTableKeyDeps.flatMap((vtkd) =>
      expandKeyDepCols(vtkd.column_dependencies).map(({ viewColumns }) => ({
        foreign_key_name: r.foreign_key_name, schema: vtkd.view_schema, relation: vtkd.view_name, columns: viewColumns, is_one_to_one: r.is_one_to_one, referenced_schema: r.referenced_schema, referenced_relation: r.referenced_relation, referenced_columns: r.referenced_columns,
      })),
    );
    const tableToViewRelationships = tableToViewKeyDeps.flatMap((tvkd) =>
      expandKeyDepCols(tvkd.column_dependencies).map(({ viewColumns }) => ({
        foreign_key_name: r.foreign_key_name, schema: r.schema, relation: r.relation, columns: r.columns, is_one_to_one: r.is_one_to_one, referenced_schema: tvkd.view_schema, referenced_relation: tvkd.view_name, referenced_columns: viewColumns,
      })),
    );
    const viewToViewRelationships = viewToTableKeyDeps.flatMap((vtkd) =>
      expandKeyDepCols(vtkd.column_dependencies).flatMap(({ viewColumns }) =>
        tableToViewKeyDeps.flatMap((tvkd) =>
          expandKeyDepCols(tvkd.column_dependencies).map(({ viewColumns: referencedViewColumns }) => ({
            foreign_key_name: r.foreign_key_name, schema: vtkd.view_schema, relation: vtkd.view_name, columns: viewColumns, is_one_to_one: r.is_one_to_one, referenced_schema: tvkd.view_schema, referenced_relation: tvkd.view_name, referenced_columns: referencedViewColumns,
          })),
        ),
      ),
    );
    return [...viewToTableRelationships, ...tableToViewRelationships, ...viewToViewRelationships];
  });

  relationships.push(...viewRelationships);
}

// ---- port of template.ts apply() ----
const detectOneToOneRelationships = true;
const postgrestVersion = undefined;

schemas.sort((a, b) => a.name.localeCompare(b.name));
relationships.sort(
  (a, b) =>
    a.foreign_key_name.localeCompare(b.foreign_key_name) ||
    a.referenced_relation.localeCompare(b.referenced_relation) ||
    JSON.stringify(a.referenced_columns).localeCompare(JSON.stringify(b.referenced_columns)),
);

const introspectionBySchema = Object.fromEntries(
  schemas.map((s) => [s.name, { tables: [], views: [], functions: [], enums: [], compositeTypes: [] }]),
);

const columnsByTableId = {};
const tablesNamesByTableId = {};
const relationTypeByIds = new Map();
const typesById = new Map();
const tablesLike = [...tables, ...foreignTables, ...views, ...materializedViews];

for (const tableLike of tablesLike) {
  columnsByTableId[tableLike.id] = [];
  tablesNamesByTableId[tableLike.id] = tableLike.name;
}
for (const column of columns) {
  if (column.table_id in columnsByTableId) {
    columnsByTableId[column.table_id].push(column);
  }
}
for (const tableId in columnsByTableId) {
  columnsByTableId[tableId].sort((a, b) => a.name.localeCompare(b.name));
}

for (const type of types) {
  typesById.set(type.id, type);
  if (type.type_relation_id) relationTypeByIds.set(type.id, type);
  if (type.schema in introspectionBySchema) {
    if (type.enums.length > 0) introspectionBySchema[type.schema].enums.push(type);
    if (type.attributes.length > 0) introspectionBySchema[type.schema].compositeTypes.push(type);
  }
}

const relationshipsByRelation = new Map();
for (const relationship of relationships) {
  const key = `${relationship.schema}.${relationship.relation}`;
  let bucket = relationshipsByRelation.get(key);
  if (!bucket) { bucket = []; relationshipsByRelation.set(key, bucket); }
  bucket.push(relationship);
}

function getRelationships(object) {
  const candidates = relationshipsByRelation.get(`${object.schema}.${object.name}`);
  if (!candidates) return [];
  return candidates.filter((relationship) => relationship.referenced_schema === object.schema);
}

for (const table of tables) {
  if (table.schema in introspectionBySchema) introspectionBySchema[table.schema].tables.push({ table, relationships: getRelationships(table) });
}
for (const table of foreignTables) {
  if (table.schema in introspectionBySchema) introspectionBySchema[table.schema].tables.push({ table, relationships: getRelationships(table) });
}
for (const view of views) {
  if (view.schema in introspectionBySchema) introspectionBySchema[view.schema].views.push({ view, relationships: getRelationships(view) });
}
for (const mv of materializedViews) {
  if (mv.schema in introspectionBySchema) introspectionBySchema[mv.schema].views.push({ view: { ...mv, is_updatable: false }, relationships: getRelationships(mv) });
}

function getTableNameFromRelationId(relationId, returnTypeId) {
  if (!relationId) return null;
  if (tablesNamesByTableId[relationId]) return tablesNamesByTableId[relationId];
  const reltype = returnTypeId ? relationTypeByIds.get(returnTypeId) : null;
  return reltype ? reltype.name : null;
}

const VALID_FUNCTION_ARGS_MODE = new Set(['in', 'inout', 'variadic']);
const VALID_UNNAMED_FUNCTION_ARG_TYPES = new Set([114, 3802, 25]);

for (const func of functions) {
  if (func.schema in introspectionBySchema) {
    func.args.sort((a, b) => a.name.localeCompare(b.name));
    const inArgs = func.args.filter(({ mode }) => VALID_FUNCTION_ARGS_MODE.has(mode));
    if (
      inArgs.length === 0 ||
      !inArgs.some(({ name }) => name === '') ||
      inArgs.every((arg) => {
        if (arg.name === '') return arg.has_default && VALID_UNNAMED_FUNCTION_ARG_TYPES.has(arg.type_id);
        return true;
      }) ||
      (inArgs.length === 1 && inArgs[0].name === '' &&
        (VALID_UNNAMED_FUNCTION_ARG_TYPES.has(inArgs[0].type_id) ||
          (relationTypeByIds.get(inArgs[0].type_id) && getTableNameFromRelationId(func.return_type_relation_id, func.return_type_id)) ||
          (relationTypeByIds.get(inArgs[0].type_id) && !getTableNameFromRelationId(func.return_type_relation_id, func.return_type_id))))
    ) {
      introspectionBySchema[func.schema].functions.push({ fn: func, inArgs });
    }
  }
}

for (const schema in introspectionBySchema) {
  introspectionBySchema[schema].tables.sort((a, b) => a.table.name.localeCompare(b.table.name));
  introspectionBySchema[schema].views.sort((a, b) => a.view.name.localeCompare(b.view.name));
  introspectionBySchema[schema].functions.sort((a, b) => a.fn.name.localeCompare(b.fn.name));
  introspectionBySchema[schema].enums.sort((a, b) => a.name.localeCompare(b.name));
  introspectionBySchema[schema].compositeTypes.sort((a, b) => a.name.localeCompare(b.name));
}

function pgTypeToTsType(schema, pgType, { types, schemas, tables, views }) {
  if (pgType === 'bool') return 'boolean';
  else if (['int2','int4','int8','float4','float8','numeric'].includes(pgType)) return 'number';
  else if (['bytea','bpchar','varchar','date','text','citext','time','timetz','timestamp','timestamptz','uuid','vector','interval'].includes(pgType)) return 'string';
  else if (['json','jsonb'].includes(pgType)) return 'Json';
  else if (pgType === 'void') return 'undefined';
  else if (pgType === 'record') return 'Record<string, unknown>';
  else if (pgType.startsWith('_')) return `(${pgTypeToTsType(schema, pgType.substring(1), { types, schemas, tables, views })})[]`;
  else {
    const enumTypes = types.filter((type) => type.name === pgType && type.enums.length > 0);
    if (enumTypes.length > 0) {
      const enumType = enumTypes.find((type) => type.schema === schema.name) || enumTypes[0];
      if (schemas.some(({ name }) => name === enumType.schema)) return `Database[${JSON.stringify(enumType.schema)}]['Enums'][${JSON.stringify(enumType.name)}]`;
      return enumType.enums.map((v) => JSON.stringify(v)).join('|');
    }
    const compositeTypes = types.filter((type) => type.name === pgType && type.attributes.length > 0);
    if (compositeTypes.length > 0) {
      const compositeType = compositeTypes.find((type) => type.schema === schema.name) || compositeTypes[0];
      if (schemas.some(({ name }) => name === compositeType.schema)) return `Database[${JSON.stringify(compositeType.schema)}]['CompositeTypes'][${JSON.stringify(compositeType.name)}]`;
      return 'unknown';
    }
    const tableRowTypes = tables.filter((table) => table.name === pgType);
    if (tableRowTypes.length > 0) {
      const tableRowType = tableRowTypes.find((type) => type.schema === schema.name) || tableRowTypes[0];
      if (schemas.some(({ name }) => name === tableRowType.schema)) return `Database[${JSON.stringify(tableRowType.schema)}]['Tables'][${JSON.stringify(tableRowType.name)}]['Row']`;
      return 'unknown';
    }
    const viewRowTypes = views.filter((view) => view.name === pgType);
    if (viewRowTypes.length > 0) {
      const viewRowType = viewRowTypes.find((type) => type.schema === schema.name) || viewRowTypes[0];
      if (schemas.some(({ name }) => name === viewRowType.schema)) return `Database[${JSON.stringify(viewRowType.schema)}]['Views'][${JSON.stringify(viewRowType.name)}]['Row']`;
      return 'unknown';
    }
    return 'unknown';
  }
}

function generateNullableUnionTsType(tsType, isNullable) {
  if (tsType === 'unknown' || tsType === 'any' || !isNullable) return tsType;
  return `${tsType} | null`;
}

function generateColumnTsDefinition(schema, column, context) {
  return `${JSON.stringify(column.name)}${column.is_optional ? '?' : ''}: ${generateNullableUnionTsType(pgTypeToTsType(schema, column.format, context), column.is_nullable)}`;
}

function generateRelationshiptTsDefinition(relationship) {
  return `{
      foreignKeyName: ${JSON.stringify(relationship.foreign_key_name)}
      columns: ${JSON.stringify(relationship.columns)}${detectOneToOneRelationships ? `\nisOneToOne: ${relationship.is_one_to_one}` : ''}
      referencedRelation: ${JSON.stringify(relationship.referenced_relation)}
      referencedColumns: ${JSON.stringify(relationship.referenced_columns)}
    }`;
}

function getFunctionTsReturnType(fn, returnType) {
  let setofOptionsInfo = '';
  const returnTableName = getTableNameFromRelationId(fn.return_type_relation_id, fn.return_type_id);
  const returnsSetOfTable = fn.is_set_returning_function && fn.return_type_relation_id !== null;
  const returnsMultipleRows = fn.prorows !== null && fn.prorows > 1;
  if (returnTableName) {
    setofOptionsInfo = `SetofOptions: {
        from: "*"
        to: ${JSON.stringify(returnTableName)}
        isOneToOne: ${Boolean(!returnsMultipleRows)}
        isSetofReturn: ${fn.is_set_returning_function}
      }`;
  }
  if (fn.args.length === 1) {
    const relationType = relationTypeByIds.get(fn.args[0].type_id);
    if (relationType) {
      const sourceTable = relationType.format;
      if (returnsSetOfTable && returnTableName) {
        setofOptionsInfo = `SetofOptions: {
          from: ${JSON.stringify(sourceTable)}
          to: ${JSON.stringify(returnTableName)}
          isOneToOne: ${Boolean(!returnsMultipleRows)}
          isSetofReturn: true
        }`;
      } else if (returnTableName && !returnsSetOfTable) {
        const targetTable = returnTableName;
        setofOptionsInfo = `SetofOptions: {
            from: ${JSON.stringify(sourceTable)}
            to: ${JSON.stringify(targetTable)}
            isOneToOne: true
            isSetofReturn: false
          }`;
      }
    }
  }
  const collapsibleSingleRow = !returnsMultipleRows && returnTableName !== null;
  return `${returnType}${fn.is_set_returning_function && !collapsibleSingleRow ? '[]' : ''}
                          ${setofOptionsInfo ? `${setofOptionsInfo}` : ''}`;
}

function getFunctionReturnType(schema, fn) {
  const tableArgs = fn.args.filter(({ mode }) => mode === 'table');
  if (tableArgs.length > 0) {
    const argsNameAndType = tableArgs.map(({ name, type_id }) => {
      const type = typesById.get(type_id);
      let tsType = 'unknown';
      if (type) tsType = pgTypeToTsType(schema, type.name, { types, schemas, tables, views });
      return { name, type: tsType };
    });
    return `{
              ${argsNameAndType.map(({ name, type }) => `${JSON.stringify(name)}: ${type}`)}
            }`;
  }
  const relation =
    introspectionBySchema[schema.name]?.tables.find(({ table: { id } }) => id === fn.return_type_relation_id)?.table ||
    introspectionBySchema[schema.name]?.views.find(({ view: { id } }) => id === fn.return_type_relation_id)?.view;
  if (relation) {
    return `{
              ${columnsByTableId[relation.id].map((column) => generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: column.is_nullable, is_optional: false }, { types, schemas, tables, views })).join(',\n')}
            }`;
  }
  const type = typesById.get(fn.return_type_id);
  if (type) return pgTypeToTsType(schema, type.name, { types, schemas, tables, views });
  return 'unknown';
}

function hasTableRowError(fn, inArgs) {
  if (inArgs.length === 1 && inArgs[0].name === '' && relationTypeByIds.get(inArgs[0].type_id) && !getTableNameFromRelationId(fn.return_type_relation_id, fn.return_type_id)) return true;
  return false;
}

function getConflictError(schema, fns, fn, inArgs) {
  if (fns.length <= 1) return null;
  if (inArgs.length === 0) {
    const conflictingFns = fns.filter(({ fn: otherFn, inArgs: otherInArgs }) => otherFn !== fn && otherInArgs.length === 1 && otherInArgs[0].name === '' && otherInArgs[0].has_default);
    if (conflictingFns.length > 0) {
      const conflictingFn = conflictingFns[0];
      const returnTypeName = typesById.get(conflictingFn.fn.return_type_id)?.name || 'unknown';
      return `Could not choose the best candidate function between: ${schema.name}.${fn.name}(), ${schema.name}.${fn.name}( => ${returnTypeName}). Try renaming the parameters or the function itself in the database so function overloading can be resolved`;
    }
  }
  if (inArgs.length === 1 && inArgs[0].name !== '') {
    const conflictingFns = fns.filter(({ fn: otherFn, inArgs: otherInArgs }) => otherFn !== fn && otherInArgs.length === 1 && otherInArgs[0].name === inArgs[0].name && otherInArgs[0].type_id !== inArgs[0].type_id);
    if (conflictingFns.length > 0) {
      const allConflictingFunctions = [{ fn, inArgs }, ...conflictingFns];
      const conflictList = allConflictingFunctions.sort((a, b) => (a.inArgs[0]?.type_id || 0) - (b.inArgs[0]?.type_id || 0)).map((f) => `${schema.name}.${fn.name}(${f.inArgs.map((a) => `${a.name || ''} => ${typesById.get(a.type_id)?.name || 'unknown'}`).join(', ')})`).join(', ');
      return `Could not choose the best candidate function between: ${conflictList}. Try renaming the parameters or the function itself in the database so function overloading can be resolved`;
    }
  }
  return null;
}

function getFunctionSignatures(schema, fns) {
  return fns.map(({ fn, inArgs }) => {
    let argsType = 'never';
    let returnType = getFunctionReturnType(schema, fn);
    const conflictError = getConflictError(schema, fns, fn, inArgs);
    if (conflictError) {
      if (inArgs.length > 0) {
        const argsNameAndType = inArgs.map(({ name, type_id, has_default }) => {
          const type = typesById.get(type_id);
          let tsType = 'unknown';
          if (type) tsType = pgTypeToTsType(schema, type.name, { types, schemas, tables, views });
          return { name, type: tsType, has_default };
        });
        argsType = `{ ${argsNameAndType.map(({ name, type, has_default }) => `${JSON.stringify(name)}${has_default ? '?' : ''}: ${type}`)} }`;
      }
      returnType = `{ error: true } & ${JSON.stringify(conflictError)}`;
    } else if (hasTableRowError(fn, inArgs)) {
      if (inArgs.length > 0) {
        const argsNameAndType = inArgs.map(({ name, type_id, has_default }) => {
          const type = typesById.get(type_id);
          let tsType = 'unknown';
          if (type) tsType = pgTypeToTsType(schema, type.name, { types, schemas, tables, views });
          return { name, type: tsType, has_default };
        });
        argsType = `{ ${argsNameAndType.map(({ name, type, has_default }) => `${JSON.stringify(name)}${has_default ? '?' : ''}: ${type}`)} }`;
      }
      returnType = `{ error: true } & ${JSON.stringify(`the function ${schema.name}.${fn.name} with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache`)}`;
    } else if (inArgs.length > 0) {
      const argsNameAndType = inArgs.map(({ name, type_id, has_default }) => {
        const type = typesById.get(type_id);
        let tsType = 'unknown';
        if (type) tsType = pgTypeToTsType(schema, type.name, { types, schemas, tables, views });
        return { name, type: tsType, has_default };
      });
      argsType = `{ ${argsNameAndType.map(({ name, type, has_default }) => `${JSON.stringify(name)}${has_default ? '?' : ''}: ${type}`)} }`;
    }
    return `{ Args: ${argsType}; Returns: ${getFunctionTsReturnType(fn, returnType)} }`;
  }).join(' |\n');
}

const internal_supabase_schema = postgrestVersion
  ? `// Allows to automatically instantiate createClient with right options\n  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)\n  __InternalSupabase: {\n    PostgrestVersion: '${postgrestVersion}'\n  }`
  : '';

const GENERATE_TYPES_DEFAULT_SCHEMA = 'public';

let output = `
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  ${internal_supabase_schema}
  ${schemas.map((schema) => {
    const { tables: schemaTables, views: schemaViews, functions: schemaFunctions, enums: schemaEnums, compositeTypes: schemaCompositeTypes } = introspectionBySchema[schema.name];
    return `${JSON.stringify(schema.name)}: {
          Tables: {
            ${schemaTables.length === 0 ? '[_ in never]: never' : schemaTables.map(({ table, relationships: rels }) => `${JSON.stringify(table.name)}: {
                  Row: {
                    ${[...columnsByTableId[table.id].map((column) => generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: column.is_nullable, is_optional: false }, { types, schemas, tables, views })), ...schemaFunctions.filter(({ fn }) => fn.argument_types === table.name).map(({ fn }) => `${JSON.stringify(fn.name)}: ${generateNullableUnionTsType(getFunctionReturnType(schema, fn), true)}`)].join(',\n')}
                  }
                  Insert: {
                    ${columnsByTableId[table.id].map((column) => {
                      if (column.identity_generation === 'ALWAYS') return `${JSON.stringify(column.name)}?: never`;
                      return generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: column.is_nullable, is_optional: column.is_nullable || column.is_identity || column.default_value !== null }, { types, schemas, tables, views });
                    }).join(',\n')}
                  }
                  Update: {
                    ${columnsByTableId[table.id].map((column) => {
                      if (column.identity_generation === 'ALWAYS') return `${JSON.stringify(column.name)}?: never`;
                      return generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: column.is_nullable, is_optional: true }, { types, schemas, tables, views });
                    }).join(',\n')}
                  }
                  Relationships: [
                    ${rels.map(generateRelationshiptTsDefinition).join(',\n')}
                  ]
                }`)}
          }
          Views: {
            ${schemaViews.length === 0 ? '[_ in never]: never' : schemaViews.map(({ view, relationships: rels }) => `${JSON.stringify(view.name)}: {
                  Row: {
                    ${[...columnsByTableId[view.id].map((column) => generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: column.is_nullable, is_optional: false }, { types, schemas, tables, views })), ...schemaFunctions.filter(({ fn }) => fn.argument_types === view.name).map(({ fn }) => `${JSON.stringify(fn.name)}: ${generateNullableUnionTsType(getFunctionReturnType(schema, fn), true)}`)].join(',\n')}
                  }
                  ${view.is_updatable ? `Insert: {
                           ${columnsByTableId[view.id].map((column) => {
                             if (!column.is_updatable) return `${JSON.stringify(column.name)}?: never`;
                             return generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: true, is_optional: true }, { types, schemas, tables, views });
                           }).join(',\n')}
                         }
                         Update: {
                           ${columnsByTableId[view.id].map((column) => {
                             if (!column.is_updatable) return `${JSON.stringify(column.name)}?: never`;
                             return generateColumnTsDefinition(schema, { name: column.name, format: column.format, is_nullable: true, is_optional: true }, { types, schemas, tables, views });
                           }).join(',\n')}
                         }
                        ` : ''}Relationships: [
                    ${rels.map(generateRelationshiptTsDefinition).join(',\n')}
                  ]
                }`)}
          }
          Functions: {
            ${(() => {
              if (schemaFunctions.length === 0) return '[_ in never]: never';
              const schemaFunctionsGroupedByName = schemaFunctions.reduce((acc, curr) => {
                acc[curr.fn.name] ??= [];
                acc[curr.fn.name].push(curr);
                return acc;
              }, {});
              for (const fnName in schemaFunctionsGroupedByName) {
                schemaFunctionsGroupedByName[fnName].sort((a, b) => a.fn.argument_types.localeCompare(b.fn.argument_types) || a.fn.return_type.localeCompare(b.fn.return_type));
              }
              return Object.entries(schemaFunctionsGroupedByName).map(([fnName, fns]) => {
                const functionSignatures = getFunctionSignatures(schema, fns);
                return `${JSON.stringify(fnName)}:\n${functionSignatures}`;
              }).join(',\n');
            })()}
          }
          Enums: {
            ${schemaEnums.length === 0 ? '[_ in never]: never' : schemaEnums.map((enum_) => `${JSON.stringify(enum_.name)}: ${enum_.enums.map((variant) => JSON.stringify(variant)).join('|')}`).join(',\n')}
          }
          CompositeTypes: {
            ${schemaCompositeTypes.length === 0 ? '[_ in never]: never' : schemaCompositeTypes.map(({ name, attributes }) => `${JSON.stringify(name)}: {
                        ${attributes.map(({ name, type_id }) => {
                          const type = typesById.get(type_id);
                          let tsType = 'unknown';
                          if (type) tsType = `${generateNullableUnionTsType(pgTypeToTsType(schema, type.name, { types, schemas, tables, views }), true)}`;
                          return `${JSON.stringify(name)}: ${tsType}`;
                        }).join(',\n')}
                      }`).join(',\n')}
          }
        }`;
  }).join(',\n')}
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, ${JSON.stringify(GENERATE_TYPES_DEFAULT_SCHEMA)}>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  ${schemas.map((schema) => {
    const schemaEnums = introspectionBySchema[schema.name].enums;
    return `${JSON.stringify(schema.name)}: {
          Enums: {
            ${schemaEnums.map((enum_) => `${JSON.stringify(enum_.name)}: [${enum_.enums.map((variant) => JSON.stringify(variant)).join(', ')}]`).join(',\n')}
          }
        }`;
  }).join(',\n')}
} as const
`;

output = await prettier.format(output, { parser: 'typescript', semi: false });

// supabase CLI prints the result with an additional trailing newline (Println),
// so the committed file ends with a blank line.
process.stdout.write(output + '\n');
await client.end();
