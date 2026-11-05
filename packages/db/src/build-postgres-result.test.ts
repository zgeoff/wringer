import { expect, test } from 'bun:test';
import { buildPostgresResult } from './build-postgres-result.ts';

test('#buildPostgresResult takes the columns from the first row and counts the rows of a read', () => {
  expect(
    buildPostgresResult(
      [
        { id: 1, text: 'pay' },
        { id: 2, text: 'ship' },
      ],
      false,
    ),
  ).toStrictEqual({
    columns: ['id', 'text'],
    rows: [
      { id: 1, text: 'pay' },
      { id: 2, text: 'ship' },
    ],
    rowCount: 2,
  });
});

test('#buildPostgresResult gives a write the count of rows it changed', () => {
  expect(buildPostgresResult(Object.assign([], { count: 3 }), true)).toStrictEqual({
    columns: [],
    rows: [],
    rowCount: 3,
  });
});

test('#buildPostgresResult counts the returned rows of a write that reports no count', () => {
  expect(buildPostgresResult([{ id: 7 }], true)).toStrictEqual({
    columns: ['id'],
    rows: [{ id: 7 }],
    rowCount: 1,
  });
});
