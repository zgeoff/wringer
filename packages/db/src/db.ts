import { WringerError, defineDriver } from '@wringer/core';
import type { DriverSession, Effect, Fence } from '@wringer/core';
import { z } from 'zod';
import { buildExecQuery } from './build-exec-query.ts';
import { isReadOnlyRefusal } from './is-read-only-refusal.ts';
import { parseExecRows } from './parse-exec-rows.ts';
import type { Row } from './parse-exec-rows.ts';
import { runSQLQuery } from './run-sql-query.ts';

export const dbQuerySchema = z.strictObject({
  sql: z.string().min(1),
  params: z.array(z.unknown()).default([]),
  write: z.boolean().default(false),
});

export type DbQuery = z.input<typeof dbQuerySchema>;

const rowSchema = z.record(z.string(), z.unknown());

export const dbResultSchema = z.strictObject({
  columns: z.array(z.string()),
  rows: z.array(rowSchema),
});

export type DbResult = z.infer<typeof dbResultSchema>;

export interface DbClient {
  readonly query: (query: DbQuery) => Promise<DbResult>;
}

const grantsSchema = z.strictObject({ allow: z.array(z.string().min(1)) });

const sqlConfigSchema = z.strictObject({
  via: z.literal('sql'),
  adapter: z.enum(['sqlite', 'postgres']),
  url: z.string().min(1),
  readOnly: grantsSchema.optional(),
});

const execConfigSchema = z.strictObject({
  via: z.literal('exec'),
  dialect: z.enum(['sqlite', 'postgres']),
  database: z.string().min(1),
  program: z.array(z.string().min(1)).min(1).optional(),
  readOnly: grantsSchema.optional(),
});

const targetConfigSchema = z.discriminatedUnion('via', [sqlConfigSchema, execConfigSchema]);

const queryArgsSchema = z.strictObject({
  sql: z.string().min(1),
  write: z.boolean().default(false),
});

// Runs SQL on the target's database, over Bun.SQL or with the database's own client on the target's
// host. A read runs read-only in the database, so a statement that writes without asking is refused
// there too. A read-only target refuses each write that `readOnly.allow` does not hold verbatim.
export const db = defineDriver({
  name: 'db',
  options: z.strictObject({}),
  targetConfig: targetConfigSchema,
  client: (session, fence): DbClient => ({
    query: fence({
      effect: (query: DbQuery) => pickQueryEffect(query.sql, query.write ?? false, session.config),
      describe: (query) => `The statement \`${summarize(query.sql)}\``,
      run: (query) => runQuery(session, fence, dbQuerySchema.parse(query)),
    }),
  }),
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

type DbConfig = z.infer<typeof targetConfigSchema>;

function pickQueryEffect(sql: string, write: boolean, config: DbConfig): Effect {
  const granted = config.readOnly?.allow.includes(sql.trim()) === true;

  return write && !granted ? 'write' : 'read';
}

function summarize(sql: string): string {
  const flat = sql.trim().replaceAll(/\s+/gu, ' ');

  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

type DbSession = DriverSession<Record<string, never>, DbConfig>;

type ParsedQuery = z.infer<typeof dbQuerySchema>;

async function runQuery(session: DbSession, fence: Fence, query: ParsedQuery): Promise<DbResult> {
  try {
    const rows = await readRows(session, query);

    return { columns: Object.keys(rows[0] ?? {}), rows: [...rows] };
  } catch (error) {
    return rejectDatabaseError(error, fence, query.sql);
  }
}

async function readRows(session: DbSession, query: ParsedQuery): Promise<readonly Row[]> {
  const config = session.config;

  if (config.via === 'sql') {
    return runSQLQuery({
      adapter: config.adapter,
      url: config.url,
      sql: query.sql,
      params: query.params,
      write: query.write,
    });
  }

  const exec = buildExecQuery({
    dialect: config.dialect,
    program: config.program ?? [config.dialect === 'sqlite' ? 'sqlite3' : 'psql'],
    database: config.database,
    sql: query.sql,
    params: query.params,
    write: query.write,
  });

  // The client call already checked this statement against the target's grants.
  const effect = pickQueryEffect(query.sql, query.write, config);

  const result = await session.exec(exec.argv, effect, { stdin: exec.stdin });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `The database client exited with ${result.exitCode}.`);
  }

  return exec.printsRows ? parseExecRows(result.stdout) : [];
}

// A read the database refused because it writes is an undeclared write, so the fence answers it as
// one: on a read-only target with the target's hint, elsewhere with a usage error.
function rejectDatabaseError(error: unknown, fence: Fence, sql: string): Promise<never> {
  if (error instanceof WringerError) {
    return Promise.reject(error);
  }

  const message = error instanceof Error ? error.message : String(error);

  if (!isReadOnlyRefusal(pickErrorCode(error), message)) {
    return Promise.reject(
      new WringerError('usage', { message: `The database refused the statement: ${message}` }),
    );
  }

  const undeclared = new WringerError('usage', {
    message: `The statement \`${summarize(sql)}\` writes, but the query did not ask to write.`,
    hint: 'Add `--write`, or `write: true`, to a statement that writes.',
  });

  const declare = fence({
    effect: () => 'write',
    describe: () => `The statement \`${summarize(sql)}\``,
    run: () => rejectWith(undeclared),
  });

  return declare(null);
}

function pickErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const sqlState = 'errno' in error && typeof error.errno === 'string' ? error.errno : null;
  const named = 'code' in error && typeof error.code === 'string' ? error.code : null;

  return sqlState ?? named;
}

function rejectWith(error: WringerError): Promise<never> {
  return Promise.reject(error);
}
