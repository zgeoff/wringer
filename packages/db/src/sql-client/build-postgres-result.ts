import { z } from 'zod';
import { rowSchema } from '../db-result-schema.ts';
import type { DbResult } from '../db-result-schema.ts';

const rowsSchema = z.array(rowSchema);

// Bun.SQL puts the count of rows a write changed on the result array as `count`.
export function buildPostgresResult(result: unknown, write: boolean, probed: unknown): DbResult {
  const rows = rowsSchema.parse(result);
  const count = findAffectedCount(result);

  return {
    columns: probed === null ? Object.keys(rows[0] ?? {}) : getProbedColumns(probed),
    rows,
    rowCount: write && count !== null ? count : rows.length,
  };
}

function findAffectedCount(result: unknown): number | null {
  const count: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'count') : null;

  return typeof count === 'number' ? count : null;
}

// The probe always returns one row, which holds the column names in order.
const probedRowSchema = z.strictObject({ wringer_columns: z.array(z.string()) });
const probeSchema = z.tuple([probedRowSchema]);

function getProbedColumns(probed: unknown): string[] {
  const [probe] = probeSchema.parse(probed);

  return probe.wringer_columns;
}
