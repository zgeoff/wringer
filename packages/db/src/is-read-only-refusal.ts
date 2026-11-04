// SQLite and Postgres each refuse a write in a read-only session with their own code and text:
// SQLITE_READONLY from a driver, "attempt to write a readonly database" from sqlite3, and SQLSTATE
// 25006 or "read-only transaction" from Postgres.
export function isReadOnlyRefusal(code: string | null, message: string): boolean {
  if (code === 'SQLITE_READONLY' || code === '25006') {
    return true;
  }

  return /attempt to write a readonly database|read-only transaction/iu.test(message);
}
