import { WringerError } from '@wringer/core';
import type { ProcessResult } from '@wringer/core';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { ExecOutput } from './build-exec-query.ts';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult, Row } from './db-result-schema.ts';

export interface ExecResultInput {
  readonly result: ProcessResult;
  readonly output: ExecOutput;
  readonly write: boolean;
}

const rowsSchema = z.array(rowSchema);
const columnsSchema = z.array(z.string());
const readSchema = z.strictObject({ columns: columnsSchema, rows: rowsSchema });
const columnLineSchema = z.array(z.strictObject({ wringer_columns: z.string() })).length(1);

// A client that exits non-zero failed the statement; its stderr goes to the caller as a plain
// error, which the driver then reads as a refusal, a fault of the environment or a bad statement.
export function parseExecResult(input: ExecResultInput): DbResult {
  if (input.result.exitCode !== 0) {
    throw new Error(
      input.result.stderr.trim() || `The database client exited with ${input.result.exitCode}.`,
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

const commandTagPattern = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|SELECT|COPY) (?<count>\d+)$/u;

function parseCommandTag(stdout: string): number | null {
  const lines = stdout.trim().split('\n');
  const tag = commandTagPattern.exec(lines.at(-1)?.trim() ?? '');
  const count = tag?.groups?.['count'];

  return count === undefined ? null : Number(count);
}

function parseClientJSON<T>(text: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(parseJSON(text));

  if (!parsed.success) {
    throw new WringerError('environment', {
      message: 'The database client printed output the driver cannot read.',
      data: { stdout: text.slice(0, 2000) },
    });
  }

  return parsed.data;
}

function parseJSON(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return null;
  }
}

// sqlite3 prints nothing for no rows.
function parseRows(stdout: string): readonly Row[] {
  const text = stdout.trim();

  return text === '' ? [] : parseClientJSON(text, rowsSchema);
}
