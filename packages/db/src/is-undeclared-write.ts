import { findLeadingWord } from './find-leading-word.ts';
import { toBareSQL } from './to-bare-sql.ts';

type Dialect = 'sqlite' | 'postgres';

type Via = 'sql' | 'exec';

const sqliteEscapePattern = /\b(?:attach|vacuum|query_only)\b/iu;
const postgresEscapePattern = /\b(?:copy|lo_export)\b/iu;

const postgresReadWords = new Set(['select', 'with', 'values', 'table', 'show', 'explain']);

const writeWordPattern = /\b(?:insert|update|delete|merge)\b/iu;

// Read-only SQLite still runs `VACUUM INTO`, and a read-only Postgres transaction still runs
// `COPY … TO` and `lo_export`: each writes a file. A psql read runs inside a SELECT wrapper, where a
// write fails as a syntax error before the transaction can refuse it, so its words decide.
export function isUndeclaredWrite(dialect: Dialect, via: Via, sql: string): boolean {
  const bare = toBareSQL(sql);

  if (dialect === 'sqlite') {
    return sqliteEscapePattern.test(bare);
  }

  if (postgresEscapePattern.test(bare)) {
    return true;
  }

  if (via === 'sql') {
    return false;
  }

  const leading = findLeadingWord(sql) ?? '';

  return !postgresReadWords.has(leading) || (leading === 'with' && writeWordPattern.test(bare));
}
