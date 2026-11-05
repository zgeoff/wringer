import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import type { SQLClients } from './run-sql-query.ts';

// The real database clients, clock and timer, which only the driver's entry point creates.
export function createSQLClients(): SQLClients {
  return {
    openSqlite: (file, mode) => new Database(file, { [mode]: true }),

    // Each session runs one statement or one transaction, so it needs one connection. With more,
    // Bun.SQL retries a refused connection on each spare slot before the call fails.
    openPostgres: (url, sessionName) =>
      new SQL(url, { max: 1, connection: { application_name: sessionName } }),

    // The command's envelope has gone to stdout by the time a late cancel fails.
    reportCancelFailure: (message) => {
      process.stderr.write(`${message}\n`);
    },
    now: () => Date.now(),
    wait: (delayMs) => Bun.sleep(delayMs),
  };
}
