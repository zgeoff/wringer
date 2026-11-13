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

test.each([
  {
    name: 'psql columns and rows',
    stdout: '{"columns" : ["id","text"], "rows" : [{"id":1,"text":"pay"}]}\n',
    output: 'columns-and-rows',
    rows: [{ id: 1, text: 'pay' }],
  },
  {
    name: 'psql columns with no rows',
    stdout: '{"columns" : ["id","text"], "rows" : []}\n',
    output: 'columns-and-rows',
    rows: [],
  },
  {
    name: 'a sqlite3 column line, then rows',
    stdout: '[{"wringer_columns":"[\\"id\\",\\"text\\"]"}]\n[{"id":1,"text":"pay"}]\n',
    output: 'columns-then-rows',
    rows: [{ id: 1, text: 'pay' }],
  },
  {
    name: 'a sqlite3 column line with no rows after it',
    stdout: '[{"wringer_columns":"[\\"id\\",\\"text\\"]"}]\n',
    output: 'columns-then-rows',
    rows: [],
  },
] as const)('it names the columns of $name', (row) => {
  const parsed = parseExecResult({
    result: { exitCode: 0, stdout: row.stdout, stderr: '' },
    output: row.output,
    write: false,
  });

  expect(parsed).toStrictEqual({
    columns: ['id', 'text'],
    rows: [...row.rows],
    rowCount: row.rows.length,
  });
});

test('it fails with an environment error on a sqlite3 column line it cannot read', () => {
  expect(() =>
    parseExecResult({
      result: { exitCode: 0, stdout: '[{"id":1}]\n', stderr: '' },
      output: 'columns-then-rows',
      write: false,
    }),
  ).toThrow(expect.objectContaining({ code: 'environment' }));
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

test.each([
  {
    name: 'the SQLSTATE psql printed',
    stderr:
      'ERROR:  53300: sorry, too many clients already\nLOCATION:  InitProcessPhase2, proc.c:404\n',
    errno: '53300',
  },
  { name: 'no SQLSTATE for sqlite3', stderr: 'Error: no such table: notes\n', errno: null },
])("it fails with the client's stderr and $name when the client exits non-zero", (row) => {
  expect(() =>
    parseExecResult({
      result: { exitCode: 3, stdout: '', stderr: row.stderr },
      output: 'columns-and-rows',
      write: false,
    }),
  ).toThrow(expect.objectContaining({ message: row.stderr.trim(), errno: row.errno }));
});

test('it keeps the digits of a sqlite3 integer beyond 2^53 and a small integer as a number', () => {
  const parsed = parseExecResult({
    result: {
      exitCode: 0,
      stdout:
        '[{"big":9007199254740993,"low":-9007199254740993,"small":5,"real":1.5,"text":"12345678901234567890"}]\n',
      stderr: '',
    },
    output: 'rows',
    write: false,
  });

  expect(parsed.rows).toStrictEqual([
    {
      big: '9007199254740993',
      low: '-9007199254740993',
      small: 5,
      real: 1.5,
      text: '12345678901234567890',
    },
  ]);
});
