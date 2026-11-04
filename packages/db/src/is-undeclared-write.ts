type Dialect = 'sqlite' | 'postgres';

type Via = 'sql' | 'exec';

const sqliteEscapePattern = /\b(?:attach|vacuum|query_only)\b/iu;
const postgresReadPattern = /^(?:select|with|values|table|show|explain)\b/iu;
const leadingNoisePattern = /^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/|\()*/u;

// A read-only SQLite handle still runs `VACUUM INTO`, which copies the database to any path. A
// psql read runs inside a SELECT wrapper, where a write fails as a syntax error before the
// read-only transaction can refuse it, so the statement's first word decides.
export function isUndeclaredWrite(dialect: Dialect, via: Via, sql: string): boolean {
  if (dialect === 'sqlite') {
    return sqliteEscapePattern.test(sql);
  }

  if (via === 'sql') {
    return false;
  }

  return !postgresReadPattern.test(sql.replace(leadingNoisePattern, ''));
}
