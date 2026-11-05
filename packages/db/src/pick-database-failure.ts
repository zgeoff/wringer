export type DatabaseFailure = 'read-only' | 'timeout' | 'environment' | 'statement';

// Postgres cancels a statement past its `statement_timeout` with SQLSTATE 57014, and psql prints only
// the message. The driver's own deadline check raises the second message before the statement runs.
const timeoutCode = '57014';

const timeoutMessagePattern =
  /canceling statement due to statement timeout|deadline passed before the statement started/iu;

const readOnlyCodes = new Set(['SQLITE_READONLY', '25006']);

const environmentCodes = new Set([
  'SQLITE_CANTOPEN',
  'SQLITE_NOTADB',
  'SQLITE_IOERR',
  'SQLITE_FULL',
  'SQLITE_PERM',
  'SQLITE_BUSY',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ERR_POSTGRES_CONNECTION_CLOSED',
  'ERR_POSTGRES_CONNECTION_TIMEOUT',
]);

// SQLSTATE classes 08 (connection), 28 (authorization), 3D (unknown database), 53 (resources) and
// 57 (operator intervention) are faults of where the statement ran, never of the statement.
const environmentStatePattern = /^(?:08|28|3D|53|57)[0-9A-Z]{3}$/u;
const readOnlyMessagePattern = /attempt to write a readonly database|read-only transaction/iu;

// The sqlite3 shell prints only the message of each SQLite code above, never the code.
const environmentMessagePattern =
  /unable to open database|database is locked|file is not a database|disk I\/O error|database or disk is full|access permission denied|could not connect|connection to server|connection refused|no such file|password authentication failed|database "[^"]*" does not exist/iu;

export function pickDatabaseFailure(code: string | null, message: string): DatabaseFailure {
  if ((code !== null && readOnlyCodes.has(code)) || readOnlyMessagePattern.test(message)) {
    return 'read-only';
  }

  if (code === timeoutCode || timeoutMessagePattern.test(message)) {
    return 'timeout';
  }

  const environmentCode =
    code !== null && (environmentCodes.has(code) || environmentStatePattern.test(code));

  if (environmentCode || environmentMessagePattern.test(message)) {
    return 'environment';
  }

  return 'statement';
}
