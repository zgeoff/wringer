import { findWrappableStatement } from './find-wrappable-statement.ts';

// Bun.SQL names no columns, and a row object moves a key such as `"2"` first, so a read with no rows
// or such a key runs again here: the left join gives one row, whose keys name each column in order.
// A read no subquery can hold, such as SHOW, always returns a row.
export function buildColumnProbe(sql: string, rows: readonly unknown[]): string | null {
  const statement = isColumnOrderLost(rows) ? findWrappableStatement(sql) : null;

  if (statement === null) {
    return null;
  }

  return `select array(select key from json_object_keys(to_json(r)) with ordinality c(key, position) order by position) as wringer_columns from (select q.* from (values (1)) d(x) left join (\n${statement}\n) q on true limit 1) r`;
}

const maxArrayIndex = 2 ** 32 - 2;

function isColumnOrderLost(rows: readonly unknown[]): boolean {
  const [first] = rows;

  if (typeof first !== 'object' || first === null) {
    return true;
  }

  return Object.keys(first).some(
    (key) => /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) <= maxArrayIndex,
  );
}
