import { findWrappableStatement } from './find-wrappable-statement.ts';

// Bun.SQL reports no column names, so a read that returned no rows runs again in this probe. The
// left join gives one row of nulls, and `to_json` of that row names each column, in order. A read
// no subquery can hold, such as SHOW, always returns a row.
export function buildColumnProbe(sql: string, rowCount: number): string | null {
  const statement = rowCount === 0 ? findWrappableStatement('postgres', sql) : null;

  if (statement === null) {
    return null;
  }

  return `select to_json(r) as wringer_row from (select q.* from (values (1)) d(x) left join (\n${statement}\n) q on true limit 1) r`;
}
