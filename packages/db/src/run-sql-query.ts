import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { WringerError } from '@wringer/core';
import type { SQL } from 'bun';
import { match } from 'ts-pattern';
import { z } from 'zod';
import { buildPostgresResult } from './build-postgres-result.ts';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult } from './db-result-schema.ts';
import { initialCancelState, pickCancelStep } from './pick-cancel-step.ts';
import type { CancelEvent } from './pick-cancel-step.ts';
import { pickStatementTimeoutStep } from './pick-statement-timeout-step.ts';

// A write opens an existing file read-write, so a mistyped path fails, never makes a new database.
type SqliteMode = 'readonly' | 'readwrite';

// The database clients, and the clock and timer the driver reads its deadlines and retries from.
export interface SQLClients {
  readonly openSqlite: (file: string, mode: SqliteMode) => Database;
  readonly openPostgres: (url: string, sessionName: string) => SQL;
  readonly reportCancelFailure: (message: string) => void;
  readonly now: () => number;
  readonly wait: (delayMs: number) => Promise<void>;
}

export interface SQLQueryInput {
  readonly adapter: 'sqlite' | 'postgres';
  readonly url: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;
  readonly signal: AbortSignal;
  readonly timeLeftMs: () => number;
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
// can never commit after the caller has moved on.
async function runPostgresQuery(input: SQLQueryInput, clients: SQLClients): Promise<DbResult> {
  const sessionName = `wringer-${randomUUID()}`;
  const client = clients.openPostgres(input.url, sessionName);
  const progress: QueryProgress = { settled: false };

  const cancel = (): void => {
    void runCancelLoop(clients, input.url, sessionName, progress);
  };

  try {
    // A statement queued while the connection opens runs once it is up, before a cancel could see
    // it, so the deadline is checked once the connection is up, and the cancel listens from then.
    await client.connect();

    input.signal.addEventListener('abort', cancel, { once: true });

    // A cancel needs a second connection, which a role's connection limit refuses while this one
    // runs, so the database also stops the statement at the deadline on this connection.
    let step = pickStatementTimeoutStep(null, input.signal.aborted, input.timeLeftMs());

    while (step.kind === 'set') {
      await client.unsafe("select set_config('statement_timeout', $1, false)", [
        String(step.timeoutMs),
      ]);

      step = pickStatementTimeoutStep(step, input.signal.aborted, input.timeLeftMs());
    }

    if (step.kind === 'expired') {
      throw new WringerError('timeout', {
        message: 'The query could not start under a timeout that ends by its deadline.',
      });
    }

    const result: unknown = await runPostgresStatement(client, input);

    return buildPostgresResult(result, input.write);
  } finally {
    progress.settled = true;

    input.signal.removeEventListener('abort', cancel);

    await client.close();
  }
}

const cancelRetryMs = 100;

interface CancelSession {
  canceller: SQL | null;
}

// Bun.SQL's `cancel()` never reaches a running query, so a second session cancels it by name. The
// loop only carries out the effects each step picks.
async function runCancelLoop(
  clients: SQLClients,
  url: string,
  sessionName: string,
  progress: Readonly<QueryProgress>,
): Promise<void> {
  const session: CancelSession = { canceller: null };
  let state = initialCancelState;
  let event: CancelEvent = { kind: 'tick', settled: progress.settled };

  for (;;) {
    const step = pickCancelStep(state, event);

    state = step.state;

    for (const effect of step.effects) {
      const next = await match(effect)
        .with({ kind: 'stop' }, () => Promise.resolve('stop' as const))
        .with({ kind: 'report' }, (report) => {
          clients.reportCancelFailure(report.message);

          return Promise.resolve(null);
        })
        .with({ kind: 'close' }, async () => {
          await closeSession(clients, session.canceller);

          session.canceller = null;

          return null;
        })
        .with({ kind: 'wait' }, async (): Promise<CancelEvent> => {
          await clients.wait(cancelRetryMs);

          return { kind: 'tick', settled: progress.settled };
        })
        .with({ kind: 'attempt' }, () => runCancelAttempt(clients, session, { url, sessionName }))
        .exhaustive();

      if (next === 'stop') {
        return;
      }

      event = next ?? event;
    }
  }
}

// Nothing awaits the loop, so a failed close is reported, never thrown.
async function closeSession(clients: SQLClients, session: SQL | null): Promise<void> {
  try {
    await session?.close();
  } catch (error) {
    clients.reportCancelFailure(`The cancel session could not be closed: ${String(error)}`);
  }
}

interface CancelTarget {
  readonly url: string;
  readonly sessionName: string;
}

const cancelSQL = 'select pg_cancel_backend(pid) from pg_stat_activity where application_name = $1';

async function runCancelAttempt(
  clients: SQLClients,
  session: CancelSession,
  target: CancelTarget,
): Promise<CancelEvent> {
  try {
    session.canceller ??= clients.openPostgres(target.url, `${target.sessionName}-cancel`);

    await session.canceller.unsafe(cancelSQL, [target.sessionName]);

    return { kind: 'cancelled' };
  } catch (error) {
    return { kind: 'failed', message: String(error) };
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
