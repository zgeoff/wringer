import { WringerError } from '@wringer/core';
import type { ProcessResult } from '@wringer/core';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { ExecOutput } from './build-exec-query.ts';
import { DatabaseClientError } from './database-client-error.ts';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult, Row } from './db-result-schema.ts';
import { toSafeInteger } from './to-safe-integer.ts';

export interface ExecResultInput {
  readonly result: ProcessResult;
  readonly output: ExecOutput;
  readonly write: boolean;
}

const rowsSchema = z.array(rowSchema);
const columnsSchema = z.array(z.string());
const readSchema = z.strictObject({ columns: columnsSchema, rows: rowsSchema });
const columnLineSchema = z.array(z.strictObject({ wringer_columns: z.string() })).length(1);

// A client that exits non-zero failed the statement; its stderr and any SQLSTATE in it go to the
// caller, which reads them as a refusal, a fault of the environment or a bad statement.
export function parseExecResult(input: ExecResultInput): DbResult {
  if (input.result.exitCode !== 0) {
    throw new DatabaseClientError(
      input.result.stderr.trim() || `The database client exited with ${input.result.exitCode}.`,
      parseSQLState(input.result.stderr),
    );
  }

  return match(input.output)
    .with('command-tag', () => ({
      columns: [],
      rows: [],
      rowCount: parseCommandTag(input.result.stdout),
    }))
    .with('columns-and-rows', () => {
      const read = parseClientJSON(input.result.stdout, readSchema);

      return { columns: read.columns, rows: read.rows, rowCount: read.rows.length };
    })
    .with('columns-then-rows', () => {
      const [first = '', ...rest] = input.result.stdout.trim().split('\n');
      const [header] = parseClientJSON(first, columnLineSchema);
      const rows = parseRows(rest.join('\n'));

      return {
        columns: parseClientJSON(header?.wringer_columns ?? '[]', columnsSchema),
        rows: [...rows],
        rowCount: rows.length,
      };
    })
    .with('rows', () => {
      const rows = parseRows(input.result.stdout);

      return {
        columns: Object.keys(rows[0] ?? {}),
        rows: [...rows],
        rowCount: input.write ? null : rows.length,
      };
    })
    .exhaustive();
}

// psql with `VERBOSITY=verbose` prints `ERROR:  57014: canceling statement …`.
const sqlStatePattern = /^(?:ERROR|FATAL|PANIC):\s+(?<code>[0-9A-Z]{5}):/mu;

function parseSQLState(stderr: string): string | null {
  return sqlStatePattern.exec(stderr)?.groups?.['code'] ?? null;
}

const commandTagPattern = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|SELECT|COPY) (?<count>\d+)$/u;

function parseCommandTag(stdout: string): number | null {
  const lines = stdout.trim().split('\n');
  const tag = commandTagPattern.exec(lines.at(-1)?.trim() ?? '');
  const count = tag?.groups?.['count'];

  return count === undefined ? null : Number(count);
}

interface ReviverContext {
  readonly source?: string;
}

type JSONReviver = (key: string, value: unknown, context?: ReviverContext) => unknown;

function parseClientJSON<T>(text: string, schema: z.ZodType<T>, reviver?: JSONReviver): T {
  const parsed = schema.safeParse(parseJSON(text, reviver));

  if (!parsed.success) {
    throw new WringerError('environment', {
      message: 'The database client printed output the driver cannot read.',
      data: { stdout: text.slice(0, 2000) },
    });
  }

  return parsed.data;
}

function parseJSON(text: string, reviver?: JSONReviver): unknown {
  try {
    const parsed: unknown = JSON.parse(text, reviver);

    return parsed;
  } catch {
    return null;
  }
}

// sqlite3 prints nothing for no rows.
function parseRows(stdout: string): readonly Row[] {
  const text = stdout.trim();

  return text === '' ? [] : parseClientJSON(text, rowsSchema, reviveSafeInteger);
}

const integerLiteralPattern = /^-?\d+$/u;

// JSON.parse rounds an integer literal beyond 2^53 before a reviver sees it, so the reviver reads
// the literal's source text instead.
function reviveSafeInteger(_key: string, value: unknown, context?: ReviverContext): unknown {
  const source = context?.source;

  if (typeof value !== 'number' || source === undefined || !integerLiteralPattern.test(source)) {
    return value;
  }

  return toSafeInteger(BigInt(source));
}
