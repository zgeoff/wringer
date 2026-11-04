import { findLeadingWord } from './find-leading-word.ts';

type Dialect = 'sqlite' | 'postgres';

type Via = 'sql' | 'exec';

const sqliteEscapePattern = /\b(?:attach|vacuum|query_only)\b/iu;

const postgresReadWords = new Set(['select', 'with', 'values', 'table', 'show', 'explain']);

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

  return !postgresReadWords.has(findLeadingWord(sql) ?? '');
}
