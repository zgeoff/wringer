import { WringerError } from '@wringer/core';
import type { ProcessResult } from '@wringer/core';
import { z } from 'zod';
import type { ExecOutput } from './build-exec-query.ts';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult, Row } from './db-result-schema.ts';

export interface ExecResultInput {
  readonly result: ProcessResult;
  readonly output: ExecOutput;
  readonly write: boolean;
}

// A client that exits non-zero failed the statement; its stderr goes to the caller as a plain
// error, which the driver then reads as a refusal, a fault of the environment or a bad statement.
export function parseExecResult(input: ExecResultInput): DbResult {
  if (input.result.exitCode !== 0) {
    throw new Error(
      input.result.stderr.trim() || `The database client exited with ${input.result.exitCode}.`,
    );
  }

  if (input.output === 'command-tag') {
    return { columns: [], rows: [], rowCount: parseCommandTag(input.result.stdout) };
  }

  const rows = parseRows(input.result.stdout);

  return {
    columns: Object.keys(rows[0] ?? {}),
    rows: [...rows],
    rowCount: input.write ? null : rows.length,
  };
}

const commandTagPattern = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|SELECT|COPY) (?<count>\d+)$/u;

function parseCommandTag(stdout: string): number | null {
  const lines = stdout.trim().split('\n');
  const tag = commandTagPattern.exec(lines.at(-1)?.trim() ?? '');
  const count = tag?.groups?.['count'];

  return count === undefined ? null : Number(count);
}

const rowsSchema = z.array(rowSchema);

// sqlite3 prints nothing for no rows, and psql prints `[]`; either is no rows.
function parseRows(stdout: string): readonly Row[] {
  const text = stdout.trim();

  if (text === '') {
    return [];
  }

  const parsed = rowsSchema.safeParse(parseJSON(text));

  if (!parsed.success) {
    throw new WringerError('environment', {
      message: 'The database client printed no JSON rows.',
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
