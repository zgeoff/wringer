import { expect, test } from 'bun:test';
import { local } from './local.ts';

test('it runs the argv on this machine without a shell', async () => {
  const result = await local().run({
    argv: ['printf', '%s|', 'a b', '$HOME'],
    access: 'read-write',
  });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'a b|$HOME|', stderr: '' });
});

test('it follows the argv on this machine, line by line', async () => {
  const lines: string[] = [];

  const exitCode = await local().follow({
    argv: ['printf', '%s\n', 'a b', '$HOME'],
    access: 'read-only',
    signal: new AbortController().signal,
    onLine: (line) => {
      lines.push(line);
    },
  });

  expect({ exitCode, lines }).toStrictEqual({ exitCode: 0, lines: ['a b', '$HOME'] });
});
