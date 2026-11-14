import { WringerError, defineDriver } from '@wringer/core';
import type { DriverSession, Fence } from '@wringer/core';
import { match } from 'ts-pattern';
import { z } from 'zod';
import { dbResultSchema } from './db-result-schema.ts';
import type { DbResult } from './db-result-schema.ts';
import { parseExecResult } from './exec-client/parse-exec-result.ts';
import { pickDatabaseFailure } from './pick-database-failure.ts';
import type { DatabaseFailure } from './pick-database-failure.ts';
import { dbConfigSchema, pickQueryEffect } from './pick-query-effect.ts';
import type { DbConfig } from './pick-query-effect.ts';
import { pickQueryPlan } from './pick-query-plan.ts';
import type { QueryPlan } from './pick-query-plan.ts';
import { createSQLClients } from './sql-client/create-sql-clients.ts';
import { runSQLQuery } from './sql-client/run-sql-query.ts';
import type { SQLClients } from './sql-client/run-sql-query.ts';

export const dbQuerySchema = z.strictObject({
  sql: z.string().min(1),
  params: z.array(z.unknown()).default([]),
  write: z.boolean().default(false),
});

export type DbQuery = z.input<typeof dbQuerySchema>;

export interface DbClient {
  readonly query: (query: DbQuery) => Promise<DbResult>;
}

const queryArgsSchema = z.strictObject({
  sql: z.string().min(1),
  write: z.boolean().default(false),
});

// A read runs read-only in the database too, so a statement that writes without asking is refused
// there. The client is the driver's entry point, so it opens the real database connections.
export const db = defineDriver({
  name: 'db',
  options: z.strictObject({}),
  targetConfig: dbConfigSchema,
  client: (session, fence): DbClient => {
    const clients = createSQLClients();

    return {
      query: fence({
        effect: (query: DbQuery) =>
          pickQueryEffect(query.sql, query.write ?? false, session.config),
        describe: (query) => `The statement \`${summarize(query.sql)}\``,
        run: (query) => runQuery(session, fence, clients, dbQuerySchema.parse(query)),
      }),
    };
  },
  commands: (command) => [
    command({
      path: ['db', 'query'],
      summary: 'Run one SQL statement; add --write for a statement that writes',
      args: queryArgsSchema,
      positionals: ['sql'],
      data: dbResultSchema,
      decideEffect: (args, config) => pickQueryEffect(args.sql, args.write, config),
      run: (args, ctx) => ctx.client.query({ sql: args.sql, write: args.write }),
    }),
  ],
  checks: [
    {
      name: 'connect',
      timeoutMs: 10_000,
      run: async (ctx) => {
        await ctx.client.query({ sql: 'select 1 as ok' });
      },
    },
  ],
});

function summarize(sql: string): string {
  const flat = sql.trim().replaceAll(/\s+/gu, ' ');

  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

type DbSession = DriverSession<Record<string, never>, DbConfig>;

type ParsedQuery = z.infer<typeof dbQuerySchema>;

async function runQuery(
  session: DbSession,
  fence: Fence,
  clients: SQLClients,
  query: ParsedQuery,
): Promise<DbResult> {
  const plan = pickQueryPlan(session.config, query, clients.now() + session.timeLeftMs());

  if (plan.kind === 'undeclared-write') {
    return rejectUndeclaredWrite(fence, query.sql);
  }

  try {
    return await readResult(session, clients, plan);
  } catch (error) {
    return rejectDatabaseError(error, fence, query);
  }
}

function rejectUndeclaredWrite(fence: Fence, sql: string): Promise<never> {
  const undeclared = new WringerError('usage', {
    message: `The statement \`${summarize(sql)}\` writes, but the query did not ask to write.`,
    hint: 'Add `--write`, or `write: true`, to a statement that writes.',
  });

  const declare = fence({
    effect: () => 'write',
    describe: () => `The statement \`${summarize(sql)}\``,
    run: () => Promise.reject(undeclared),
  });

  return declare(null);
}

type RunnablePlan = Exclude<QueryPlan, { readonly kind: 'undeclared-write' }>;

async function readResult(
  session: DbSession,
  clients: SQLClients,
  plan: RunnablePlan,
): Promise<DbResult> {
  if (plan.kind === 'sql') {
    return runSQLQuery(
      { ...plan, signal: session.signal, timeLeftMs: session.timeLeftMs },
      clients,
    );
  }

  const result = await session.exec(plan.exec.argv, plan.effect, { stdin: plan.exec.stdin });

  return parseExecResult({ result, output: plan.exec.output, write: plan.write });
}

function rejectDatabaseError(error: unknown, fence: Fence, query: ParsedQuery): Promise<never> {
  if (error instanceof WringerError) {
    return Promise.reject(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  const failure = pickDatabaseFailure({ code: pickErrorCode(error), message, write: query.write });

  if (failure === 'read-only') {
    return rejectUndeclaredWrite(fence, query.sql);
  }

  return Promise.reject(buildDatabaseError(failure, message));
}

function pickErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const sqlState = 'errno' in error && typeof error.errno === 'string' ? error.errno : null;
  const named = 'code' in error && typeof error.code === 'string' ? error.code : null;

  return sqlState ?? named;
}

function buildDatabaseError(
  failure: Exclude<DatabaseFailure, 'read-only'>,
  message: string,
): WringerError {
  return match(failure)
    .with(
      'write-refused',
      () =>
        new WringerError('environment', {
          message: `The database refused a write the query declared: ${message}`,
          hint: 'Point the target at a database that takes writes, such as the primary over a replica.',
        }),
    )
    .with(
      'timeout',
      () =>
        new WringerError('timeout', {
          message: `The database stopped the statement at the command's deadline: ${message}`,
        }),
    )
    .with(
      'environment',
      () =>
        new WringerError('environment', {
          message: `The database could not run the statement: ${message}`,
          hint: 'Check that the database is up and its url or file is right, then run `doctor`.',
        }),
    )
    .with(
      'statement',
      () =>
        new WringerError('usage', { message: `The database refused the statement: ${message}` }),
    )
    .exhaustive();
}
