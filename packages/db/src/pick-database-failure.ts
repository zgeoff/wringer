export type DatabaseFailure = 'read-only' | 'environment' | 'statement';

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

const environmentMessagePattern =
  /unable to open database|could not connect|connection to server|connection refused|no such file|password authentication failed|database "[^"]*" does not exist/iu;

// SQLite and Postgres each report a failure with their own code, from a driver, or text, from the
// database's own client. A refused write in a read-only session is the target's to answer; a
// failure to reach or open the database is the environment's; anything else is the statement's.
export function pickDatabaseFailure(code: string | null, message: string): DatabaseFailure {
  if ((code !== null && readOnlyCodes.has(code)) || readOnlyMessagePattern.test(message)) {
    return 'read-only';
  }

  const environmentCode =
    code !== null && (environmentCodes.has(code) || environmentStatePattern.test(code));

  if (environmentCode || environmentMessagePattern.test(message)) {
    return 'environment';
  }

  return 'statement';
}
