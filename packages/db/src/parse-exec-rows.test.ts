import { expect, test } from 'bun:test';
import { parseExecRows } from './parse-exec-rows.ts';

test('it parses the JSON rows a client printed', () => {
  expect(parseExecRows('[{"id":1,"text":"pay"}]\n')).toStrictEqual([{ id: 1, text: 'pay' }]);
});

test('it reads empty output as no rows', () => {
  expect(parseExecRows('\n')).toStrictEqual([]);
});

test('it fails with an environment error on output that is not JSON rows', () => {
  expect(() => parseExecRows('INSERT 0 1')).toThrow(
    expect.objectContaining({ code: 'environment' }),
  );
});
