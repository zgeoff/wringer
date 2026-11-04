import { expect, test } from 'bun:test';
import { parseExecResult } from './parse-exec-result.ts';

test('it parses the JSON rows a client printed, with their columns and count', () => {
  const parsed = parseExecResult({
    result: { exitCode: 0, stdout: '[{"id":1,"text":"pay"},{"id":2,"text":"ship"}]\n', stderr: '' },
    output: 'rows',
    write: false,
  });

  expect(parsed).toStrictEqual({
    columns: ['id', 'text'],
    rows: [
      { id: 1, text: 'pay' },
      { id: 2, text: 'ship' },
    ],
    rowCount: 2,
  });
});

test('it reads empty output as no rows', () => {
  const parsed = parseExecResult({
    result: { exitCode: 0, stdout: '\n', stderr: '' },
    output: 'rows',
    write: false,
  });

  expect(parsed).toStrictEqual({ columns: [], rows: [], rowCount: 0 });
});

test('it leaves the count of a write through sqlite3 unknown', () => {
  const parsed = parseExecResult({
    result: { exitCode: 0, stdout: '[{"id":7}]\n', stderr: '' },
    output: 'rows',
    write: true,
  });

  expect(parsed).toStrictEqual({ columns: ['id'], rows: [{ id: 7 }], rowCount: null });
});

test.each([
  { stdout: 'UPDATE 3\n', rowCount: 3 },
  { stdout: 'INSERT 0 2\n', rowCount: 2 },
  { stdout: 'BEGIN\nDELETE 1\nCOMMIT\n', rowCount: null },
  { stdout: 'CREATE TABLE\n', rowCount: null },
])('it reads the psql command tag $stdout as $rowCount rows', (row) => {
  const parsed = parseExecResult({
    result: { exitCode: 0, stdout: row.stdout, stderr: '' },
    output: 'command-tag',
    write: true,
  });

  expect(parsed).toStrictEqual({ columns: [], rows: [], rowCount: row.rowCount });
});

test('it fails with an environment error on output that is not JSON rows', () => {
  expect(() =>
    parseExecResult({
      result: { exitCode: 0, stdout: 'INSERT 0 1', stderr: '' },
      output: 'rows',
      write: false,
    }),
  ).toThrow(expect.objectContaining({ code: 'environment' }));
});

test("it fails with the client's stderr when the client exits non-zero", () => {
  expect(() =>
    parseExecResult({
      result: { exitCode: 1, stdout: '', stderr: 'Error: no such table: notes\n' },
      output: 'rows',
      write: false,
    }),
  ).toThrow('Error: no such table: notes');
});
