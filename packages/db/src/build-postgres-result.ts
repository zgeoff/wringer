import { z } from 'zod';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult } from './db-result-schema.ts';

const rowsSchema = z.array(rowSchema);

// Bun.SQL reports no column names for an empty result, so the columns come from the first row, and
// it puts the count of rows a write changed on the result array as `count`.
export function buildPostgresResult(result: unknown, write: boolean): DbResult {
  const rows = rowsSchema.parse(result);
  const count = findAffectedCount(result);

  return {
    columns: Object.keys(rows[0] ?? {}),
    rows,
    rowCount: write && count !== null ? count : rows.length,
  };
}

function findAffectedCount(result: unknown): number | null {
  const count: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'count') : null;

  return typeof count === 'number' ? count : null;
}
