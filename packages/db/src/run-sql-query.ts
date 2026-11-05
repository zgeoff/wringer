import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { WringerError } from '@wringer/core';
import type { SQL } from 'bun';
import { z } from 'zod';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult } from './db-result-schema.ts';

// A write opens an existing file read-write, so a mistyped path fails, never makes a new database.
export type SqliteMode = 'readonly' | 'readwrite';

export interface SQLClients {
  readonly openSqlite: (file: string, mode: SqliteMode) => Database;
  readonly openPostgres: (url: string, sessionName: string) => SQL;
  readonly reportCancelFailure: (message: string) => void;
}

export interface SQLQueryInput {
  readonly adapter: 'sqlite' | 'postgres';
  readonly url: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;
  readonly signal: AbortSignal;
}

// A read opens SQLite read-only with `query_only` on, and runs on Postgres in a read-only
// transaction, so the database refuses a statement that writes whatever the caller claimed.
export function runSQLQuery(input: SQLQueryInput, clients: SQLClients): Promise<DbResult> {
  // The cancel below listens for an abort that has yet to come; one that came already never fires.
  if (input.signal.aborted) {
    return Promise.reject(
      new WringerError('timeout', {
        message: 'The query ran past its deadline before it started.',
      }),
    );
  }

  if (input.adapter === 'sqlite') {
    return Promise.try(() => runSqliteQuery(input, clients));
  }

  return runPostgresQuery(input, clients);
}

const rowsSchema = z.array(rowSchema);

// bun:sqlite runs a statement to the end in one call, so the deadline cannot stop it part-way; the
// statement's own column names survive an empty result.
function runSqliteQuery(input: SQLQueryInput, clients: SQLClients): DbResult {
  const params = parseSqliteParams(input.params);
  const mode = input.write ? 'readwrite' : 'readonly';
  const database = clients.openSqlite(input.url, mode);

  try {
    if (!input.write) {
      database.run('pragma query_only = 1');
    }

    const statement = database.query(input.sql);
    const rows = rowsSchema.parse(statement.all(...params));

    return {
      columns: [...statement.columnNames],
      rows,
      rowCount: input.write ? readChanges(database) : rows.length,
    };
  } finally {
    database.close();
  }
}

const sqliteParamsSchema = z.array(
  z.union([z.string(), z.number(), z.bigint(), z.boolean(), z.null(), z.instanceof(Uint8Array)]),
);

function parseSqliteParams(params: readonly unknown[]): SQLQueryBindings[] {
  const parsed = sqliteParamsSchema.safeParse(params);

  if (!parsed.success) {
    throw new WringerError('usage', {
      message: 'A SQLite parameter is a string, a number, a bigint, a boolean, null or bytes.',
    });
  }

  return parsed.data;
}

const changesSchema = z.strictObject({ count: z.number() });

function readChanges(database: Database): number {
  return changesSchema.parse(database.query('select changes() as count').get()).count;
}

interface QueryProgress {
  settled: boolean;
}

// A Postgres query the deadline cuts off is cancelled in the database, so a write that timed out
// can never commit after the caller has moved on. Bun.SQL reports no column names for an empty
// result, so the columns come from the first row.
async function runPostgresQuery(input: SQLQueryInput, clients: SQLClients): Promise<DbResult> {
  const sessionName = `wringer-${randomUUID()}`;
  const client = clients.openPostgres(input.url, sessionName);
  const progress: QueryProgress = { settled: false };

  const cancel = (): void => {
    void runCancelLoop(clients, input.url, sessionName, progress);
  };

  input.signal.addEventListener('abort', cancel, { once: true });

  try {
    const result: unknown = await runPostgresStatement(client, input);

    const rows = rowsSchema.parse(result);
    const count = readAffectedCount(result);

    return {
      columns: Object.keys(rows[0] ?? {}),
      rows,
      rowCount: input.write && count !== null ? count : rows.length,
    };
  } finally {
    progress.settled = true;

    input.signal.removeEventListener('abort', cancel);

    await client.close();
  }
}

const cancelSQL = 'select pg_cancel_backend(pid) from pg_stat_activity where application_name = $1';
const cancelRetryMs = 100;

// Bun.SQL's `cancel()` never reaches a running query, so a second session cancels it by name. A
// cancel that lands early, or that the server refuses, stops nothing, so the loop tries again on a
// fresh session until the statement settles, and reports each failure to the caller's operator.
async function runCancelLoop(
  clients: SQLClients,
  url: string,
  sessionName: string,
  progress: Readonly<QueryProgress>,
): Promise<void> {
  let canceller: SQL | null = null;
  let failing = false;

  while (!progress.settled) {
    try {
      canceller ??= clients.openPostgres(url, `${sessionName}-cancel`);

      await canceller.unsafe(cancelSQL, [sessionName]);

      failing = false;
    } catch (error) {
      // One report per run of failures, so a server that refuses for a while is named once.
      if (!failing) {
        clients.reportCancelFailure(
          `The query could not be cancelled yet, and runs on until it can be: ${String(error)}`,
        );
      }

      failing = true;

      await closeSession(clients, canceller);

      canceller = null;
    }

    await Bun.sleep(cancelRetryMs);
  }

  await closeSession(clients, canceller);
}

// Nothing awaits the loop, so a failed close is reported, never thrown.
async function closeSession(clients: SQLClients, session: SQL | null): Promise<void> {
  try {
    await session?.close();
  } catch (error) {
    clients.reportCancelFailure(`The cancel session could not be closed: ${String(error)}`);
  }
}

function runPostgresStatement(client: SQL, input: SQLQueryInput): Promise<unknown> {
  // Bun.SQL sends `unsafe` with no parameters as a simple query, which runs every statement in the
  // text, so `COMMIT; DELETE …` would end the read-only transaction. A tagged query always takes the
  // extended protocol, where Postgres refuses a second statement.
  const start = (sql: SQL): SQL.Query<unknown> =>
    input.params.length === 0
      ? sql<unknown>(Object.assign([input.sql], { raw: [input.sql] }))
      : sql.unsafe<unknown>(input.sql, [...input.params]);

  if (input.write) {
    return start(client);
  }

  return client.begin('read only', (transaction) => start(transaction));
}

// Bun.SQL puts the count of rows a write changed on the result array as `count`.
function readAffectedCount(result: unknown): number | null {
  const count: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'count') : null;

  return typeof count === 'number' ? count : null;
}
