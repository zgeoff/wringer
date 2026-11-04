import { WringerError } from '@wringer/core';
import { z } from 'zod';

const rowsSchema = z.array(z.record(z.string(), z.unknown()));

export type Row = z.infer<typeof rowsSchema>[number];

// sqlite3 prints nothing for no rows, and psql prints nothing for a write; either is no rows.
export function parseExecRows(stdout: string): readonly Row[] {
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
