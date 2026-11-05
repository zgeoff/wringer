import { z } from 'zod';
import { rowSchema } from './db-result-schema.ts';
import type { DbResult } from './db-result-schema.ts';

const rowsSchema = z.array(rowSchema);

// Bun.SQL puts the count of rows a write changed on the result array as `count`.
export function buildPostgresResult(result: unknown, write: boolean, probed: unknown): DbResult {
  const rows = rowsSchema.parse(result);
  const count = findAffectedCount(result);

  return {
    columns: probed === null ? Object.keys(rows[0] ?? {}) : collectProbedColumns(probed),
    rows,
    rowCount: write && count !== null ? count : rows.length,
  };
}

function findAffectedCount(result: unknown): number | null {
  const count: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'count') : null;

  return typeof count === 'number' ? count : null;
}

const probedRowSchema = z.record(z.string(), z.unknown());
const probeSchema = z.array(z.strictObject({ wringer_row: probedRowSchema }));

function collectProbedColumns(probed: unknown): string[] {
  const [probe] = probeSchema.parse(probed);

  return Object.keys(probe?.wringer_row ?? {});
}
