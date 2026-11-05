import { expect, test } from 'bun:test';
import { buildPostgresResult } from './build-postgres-result.ts';

test('#buildPostgresResult takes the columns from the first row and counts the rows of a read', () => {
  const result = buildPostgresResult(
    [
      { id: 1, text: 'pay' },
      { id: 2, text: 'ship' },
    ],
    false,
    null,
  );

  expect(result).toStrictEqual({
    columns: ['id', 'text'],
    rows: [
      { id: 1, text: 'pay' },
      { id: 2, text: 'ship' },
    ],
    rowCount: 2,
  });
});

test('#buildPostgresResult takes the columns of an empty read from its probe', () => {
  const result = buildPostgresResult([], false, [{ wringer_columns: ['id', 'text'] }]);

  expect(result).toStrictEqual({ columns: ['id', 'text'], rows: [], rowCount: 0 });
});

test('#buildPostgresResult keeps the probe’s order for columns named like array indexes', () => {
  const result = buildPostgresResult([{ 1: 2, 2: 1 }], false, [{ wringer_columns: ['2', '1'] }]);

  expect(result).toStrictEqual({ columns: ['2', '1'], rows: [{ 1: 2, 2: 1 }], rowCount: 1 });
});

test('#buildPostgresResult gives a write the count of rows it changed', () => {
  const result = buildPostgresResult(Object.assign([], { count: 3 }), true, null);

  expect(result).toStrictEqual({ columns: [], rows: [], rowCount: 3 });
});

test('#buildPostgresResult counts the returned rows of a write that reports no count', () => {
  const result = buildPostgresResult([{ id: 7 }], true, null);

  expect(result).toStrictEqual({ columns: ['id'], rows: [{ id: 7 }], rowCount: 1 });
});
