import { expect, test } from 'bun:test';
import { dbResultSchema } from './db-result-schema.ts';

test('it accepts a result with its columns, rows and count', () => {
  const result = dbResultSchema.safeParse({
    columns: ['id'],
    rows: [{ id: 1 }],
    rowCount: 1,
  });

  expect(result.data).toStrictEqual({ columns: ['id'], rows: [{ id: 1 }], rowCount: 1 });
});

test('it rejects a negative row count', () => {
  const result = dbResultSchema.safeParse({ columns: ['id'], rows: [{ id: 1 }], rowCount: -1 });

  expect(result.error?.issues).toPartiallyContain({ path: ['rowCount'] });
});
