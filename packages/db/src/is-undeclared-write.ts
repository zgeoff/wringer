import { findLeadingWord } from './find-leading-word.ts';
import { findUnlistedPostgresCall } from './find-unlisted-postgres-call.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';
import type { SQLToken } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

const sqliteEscapeWords = new Set(['attach', 'vacuum', 'query_only']);

// A SQLite read starts with one of these words, and the read-only handle refuses a write inside it.
const sqliteReadWords = new Set(['select', 'with', 'values', 'explain', 'pragma']);

// A read-only Postgres transaction still runs `NOTIFY`, `LISTEN`, `SET` and `PREPARE`, so a read
// starts with one of these words or counts as a write.
const postgresReadWords = new Set(['select', 'with', 'values', 'table', 'show', 'explain']);

// Each word that makes a read statement run something else: a data-changing `WITH` or `EXPLAIN
// ANALYZE` target, `SELECT … INTO`, which creates a table, or a prepared or declared statement.
const nestedWriteWords = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'into',
  'create',
  'execute',
  'declare',
]);

// Read-only SQLite still runs `VACUUM INTO`, and a read-only Postgres transaction still runs
// `COPY … TO` and `lo_export`: each writes a file.
export function isUndeclaredWrite(dialect: Dialect, sql: string): boolean {
  const lex = parseSQLTokens(dialect, sql);

  // The database refuses SQL whose string or comment never closes; this check refuses it first.
  if (!lex.closed) {
    return true;
  }

  const words = lex.tokens.flatMap((token) =>
    token.kind === 'word' ? [token.text.toLowerCase()] : [],
  );

  if (dialect === 'sqlite') {
    return (
      !sqliteReadWords.has(findLeadingWord(lex.tokens) ?? '') ||
      words.some((word) => sqliteEscapeWords.has(word))
    );
  }

  return (
    lex.tokens.some((token) => isPostgresEscape(token)) ||
    findUnlistedPostgresCall(lex.tokens) !== null ||
    !postgresReadWords.has(findLeadingWord(lex.tokens) ?? '') ||
    words.some((word) => nestedWriteWords.has(word))
  );
}

// `COPY … TO` and `lo_export` write a file inside a read-only transaction. A `DO` block, the
// `query_to_xml` family and `dblink` run SQL held in a string, which a string built at run time,
// such as `'CO' || 'PY …'`, hides from any search; `dblink` runs it outside the transaction.
const postgresEscapeWords = new Set(['copy', 'lo_export', 'do']);

const postgresStringRunnerPattern = /^(?:query_to_xml|dblink)/u;

// A function may run the SQL a string holds, so a string that names one of these counts too.
const postgresStringEscapePattern = /\b(?:copy|lo_export|query_to_xml\w*|dblink\w*)\b/iu;

// A quoted name is the same name as the word, so `"lo_export"` calls `lo_export`, and a `U&"…"`
// name can spell any word in escapes.
function isPostgresEscape(token: SQLToken): boolean {
  if (token.kind === 'string') {
    return postgresStringEscapePattern.test(token.text);
  }

  if (token.kind === 'name' && token.escaped) {
    return true;
  }

  if (token.kind === 'symbol') {
    return false;
  }

  const name = token.text.toLowerCase();

  return postgresEscapeWords.has(name) || postgresStringRunnerPattern.test(name);
}
