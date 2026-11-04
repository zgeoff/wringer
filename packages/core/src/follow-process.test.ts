import { expect, mock, test } from 'bun:test';
import { followProcess } from './follow-process.ts';

test('it hands each stdout line to onLine and resolves with the exit code', async () => {
  const lines: string[] = [];

  const exitCode = await followProcess({
    argv: ['sh', '-c', String.raw`printf "first\nsecond\n"; exit 3`],
    signal: new AbortController().signal,
    onLine: (line) => {
      lines.push(line);
    },
  });

  expect({ exitCode, lines }).toStrictEqual({ exitCode: 3, lines: ['first', 'second'] });
});

test('it stops a command that never ends when the signal fires', () => {
  const controller = new AbortController();

  const onLine = mock<(line: string) => void>(() => {
    controller.abort();
  });

  const followed = followProcess({
    argv: ['sh', '-c', 'echo up; exec sleep 60'],
    signal: controller.signal,
    onLine,
  });

  expect(followed).resolves.toBeNumber();
});

test('it stops a child the command started when the signal fires', async () => {
  const controller = new AbortController();

  const onLine = mock<(line: string) => void>(() => {
    controller.abort();
  });

  const startedMs = performance.now();

  await followProcess({
    argv: ['sh', '-c', 'echo up; sleep 30 & wait'],
    signal: controller.signal,
    onLine,
  });

  expect(performance.now() - startedMs).toBeLessThan(5000);
});

test('it rejects a command that is not on the PATH', () => {
  expect(
    followProcess({
      argv: ['wringer-no-such-command'],
      signal: new AbortController().signal,
      onLine: mock<(line: string) => void>(),
    }),
  ).rejects.toMatchObject({ code: 'environment' });
});
