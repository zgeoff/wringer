import type { SQLToken } from './parse-sql-tokens.ts';

// SQL keywords that stand before a parenthesis without calling a function, and the type names that
// take a modifier, such as `numeric(10, 2)`.
const parenthesisWords = new Set([
  'all',
  'and',
  'any',
  'array',
  'as',
  'between',
  'bit',
  'by',
  'case',
  'cast',
  'char',
  'character',
  'decimal',
  'distinct',
  'else',
  'except',
  'exists',
  'explain',
  'filter',
  'from',
  'group',
  'having',
  'ilike',
  'in',
  'intersect',
  'interval',
  'join',
  'lateral',
  'like',
  'limit',
  'not',
  'numeric',
  'offset',
  'on',
  'or',
  'over',
  'row',
  'select',
  'some',
  'then',
  'time',
  'timestamp',
  'timestamptz',
  'timetz',
  'union',
  'using',
  'values',
  'varchar',
  'varying',
  'when',
  'where',
  'with',
]);

// Each function here only computes a value from its arguments or the rows it reads. A read-only
// transaction still runs a function that ends other sessions, such as `pg_terminate_backend`,
// changes a setting, such as `set_config`, or holds the connection, such as `pg_sleep`.
const readFunctions = new Set([
  'abs',
  'age',
  'array_agg',
  'array_length',
  'array_to_string',
  'avg',
  'bool_and',
  'bool_or',
  'btrim',
  'cardinality',
  'ceil',
  'ceiling',
  'char_length',
  'coalesce',
  'concat',
  'concat_ws',
  'count',
  'cume_dist',
  'date_part',
  'date_trunc',
  'dense_rank',
  'every',
  'extract',
  'first_value',
  'floor',
  'format',
  'generate_series',
  'greatest',
  'initcap',
  'json_agg',
  'json_array_elements',
  'json_array_length',
  'json_build_array',
  'json_build_object',
  'json_extract_path_text',
  'json_object_agg',
  'jsonb_agg',
  'jsonb_array_elements',
  'jsonb_array_length',
  'jsonb_build_array',
  'jsonb_build_object',
  'jsonb_extract_path_text',
  'jsonb_object_agg',
  'jsonb_typeof',
  'lag',
  'last_value',
  'lead',
  'least',
  'left',
  'length',
  'lower',
  'lpad',
  'ltrim',
  'make_date',
  'max',
  'md5',
  'min',
  'mod',
  'now',
  'nth_value',
  'ntile',
  'nullif',
  'octet_length',
  'overlay',
  'percent_rank',
  'position',
  'power',
  'rank',
  'regexp_match',
  'regexp_replace',
  'replace',
  'reverse',
  'right',
  'round',
  'row_number',
  'rpad',
  'rtrim',
  'sign',
  'split_part',
  'sqrt',
  'starts_with',
  'string_agg',
  'strpos',
  'substr',
  'substring',
  'sum',
  'to_char',
  'to_date',
  'to_json',
  'to_jsonb',
  'to_number',
  'to_timestamp',
  'trim',
  'trunc',
  'unnest',
  'upper',
]);

// A word or quoted name before `(` calls a function, unless the word is a keyword. A name off the
// list, through a schema other than `pg_catalog`, or quoted unlike the listed one, is returned. A
// column list after a name, such as a CTE's `totals(day, sum)`, reads as a call too.
export function findUnlistedPostgresCall(tokens: readonly SQLToken[]): string | null {
  for (const [index, token] of tokens.entries()) {
    const callee = tokens[index - 1];

    if (token.kind !== 'symbol' || token.text !== '(' || callee === undefined) {
      continue;
    }

    if (callee.kind === 'word' && parenthesisWords.has(callee.text.toLowerCase())) {
      continue;
    }

    if (callee.kind !== 'word' && callee.kind !== 'name') {
      continue;
    }

    const name = callee.kind === 'word' ? callee.text.toLowerCase() : callee.text;

    if (!readFunctions.has(name) || !isCatalogSchema(tokens, index - 1)) {
      return name;
    }
  }

  return null;
}

// An unqualified name resolves to `pg_catalog` first, so only another schema's name differs.
function isCatalogSchema(tokens: readonly SQLToken[], calleeIndex: number): boolean {
  const dot = tokens[calleeIndex - 1];

  if (dot?.kind !== 'symbol' || dot.text !== '.') {
    return true;
  }

  const schema = tokens[calleeIndex - 2];
  const schemaName = schema?.kind === 'word' ? schema.text.toLowerCase() : schema?.text;

  return schemaName === 'pg_catalog';
}
