import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../scripts/ci/run-command.ts';
import { runCommand } from '../scripts/ci/run-command.ts';
import { createCommandStarter } from './create-command-starter.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-create-command-starter-'));

  const starter = createCommandStarter(runCommand, {
    cwd: directory,
    env: { PATH: process.env['PATH'] },
  });

  onTestFinished(async () => {
    await starter.stopCommands();

    await rm(directory, { recursive: true, force: true });
  });

  return { starter };
}

test('it runs a command in the given folder and returns its result', async () => {
  const ctx = await setupTest();
  const result = await ctx.starter.startCommand(['sh', '-c', 'basename "$PWD"; exit 3']);

  expect(result.exitCode).toBe(3);
  expect(result.stdout).toStartWith('.test-create-command-starter-');
});

test('it stops every started command and settles once each has exited', async () => {
  const ctx = await setupTest();

  const first = ctx.starter.startCommand(['sh', '-c', 'exec sleep 30']);
  const second = ctx.starter.startCommand(['sh', '-c', 'exec sleep 30']);

  await ctx.starter.stopCommands();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  expect(firstResult.exitCode).toBe(143);
  expect(secondResult.exitCode).toBe(143);
});

test('it stops only the command whose own signal aborts', async () => {
  const ctx = await setupTest();

  const stopping = new AbortController();

  const stopped = ctx.starter.startCommand(['sh', '-c', 'exec sleep 30'], stopping.signal);
  const finishing = ctx.starter.startCommand(['sh', '-c', 'sleep 0.2; echo boiled']);

  stopping.abort();

  const [stoppedResult, finishedResult] = await Promise.all([stopped, finishing]);

  expect(stoppedResult.exitCode).toBe(143);
  expect([finishedResult.exitCode, finishedResult.stdout]).toStrictEqual([0, 'boiled\n']);
});

test('it settles the stop only once a stopped command has settled', async () => {
  const command = Promise.withResolvers<CommandResult>();
  const signals: (AbortSignal | undefined)[] = [];

  const starter = createCommandStarter(
    (_argv, options) => {
      signals.push(options.signal);

      return command.promise;
    },
    { cwd: '/repo', env: {} },
  );

  const running = starter.startCommand(['sleep', '30']);
  const stopping = starter.stopCommands();

  // A race against a settled promise answers whether the stop has settled by now, with no delay.
  const pending = Symbol('pending');

  const beforeSettle = await Promise.race([stopping, Promise.resolve(pending)]);

  expect(signals[0]?.aborted).toBeTrue();
  expect(beforeSettle).toBe(pending);

  command.resolve({ exitCode: 143, stdout: '', stderr: '' });

  await stopping;

  const result = await running;

  expect(result.exitCode).toBe(143);
});
