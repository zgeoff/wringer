import { expect, test } from 'bun:test';
import { buildSpawnError } from './build-spawn-error.ts';

test('it builds an environment error that names the command and the reason', () => {
  const error = buildSpawnError('sqlite3', new Error('ENOENT: no such file or directory'));

  expect({ code: error.code, message: error.message }).toStrictEqual({
    code: 'environment',
    message: 'sqlite3 did not start: ENOENT: no such file or directory',
  });
});

test('it builds the reason from a thrown value that is not an Error', () => {
  const error = buildSpawnError('sqlite3', 'spawn failed');

  expect(error.message).toBe('sqlite3 did not start: spawn failed');
});
