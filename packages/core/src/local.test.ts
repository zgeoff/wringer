import { expect, test } from 'bun:test';
import { local } from './local.ts';

test('it runs the argv on this machine without a shell', async () => {
  const result = await local().run({
    argv: ['printf', '%s|', 'a b', '$HOME'],
    access: 'read-write',
  });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'a b|$HOME|', stderr: '' });
});
