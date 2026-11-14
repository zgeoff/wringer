import { expect, test } from 'bun:test';
import { parseLaunchLine } from './parse-launch-line.ts';

test('it parses a JSON object line into its fields', () => {
  expect(parseLaunchLine('{"port":4100,"host":"127.0.0.1"}')).toStrictEqual({
    port: 4100,
    host: '127.0.0.1',
  });
});

test.each([
  { name: 'plain text', line: 'warming the kettle' },
  { name: 'a JSON array', line: '[4100]' },
  { name: 'a JSON number', line: '4100' },
  { name: 'JSON null', line: 'null' },
  { name: 'a cut-off JSON object', line: '{"port":41' },
])('it gives a line of $name as its text', (row) => {
  expect(parseLaunchLine(row.line)).toStrictEqual({ message: row.line });
});
