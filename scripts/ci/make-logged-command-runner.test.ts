import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStubOutputSink } from '../../test-utils/build-stub-output-sink.ts';
import { createCommandStarter } from '../../test-utils/create-command-starter.ts';
import { makeLoggedCommandRunner } from './make-logged-command-runner.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-make-logged-command-runner-'));

  const stdout = buildStubOutputSink();
  const stderr = buildStubOutputSink();

  const starter = createCommandStarter(makeLoggedCommandRunner({ stdout, stderr }), {
    cwd: directory,
    env: { PATH: process.env['PATH'] },
  });

  onTestFinished(async () => {
    await starter.stopCommands();

    await rm(directory, { recursive: true, force: true });
  });

  return { directory, stdout, stderr, startCommand: starter.startCommand };
}

test('it copies the output while the command still runs', async () => {
  const ctx = await setupTest();

  const release = join(ctx.directory, 'release');

  // The command prints a line, then waits until the test creates the release file.
  const running = ctx.startCommand([
    'sh',
    '-c',
    'echo boiling; until [ -e "$1" ]; do sleep 0.01; done; echo boiled',
    'sh',
    release,
  ]);

  await ctx.stdout.firstWrite;

  const before = ctx.stdout.readText();

  await writeFile(release, '');

  const result = await running;

  expect(before).toBe('boiling\n');
  expect(result.stdout).toBe('boiling\nboiled\n');
  expect(ctx.stdout.readText()).toBe('boiling\nboiled\n');
});

test('it copies stdout and stderr to their own sinks and returns them captured, with the exit code', async () => {
  const ctx = await setupTest();
  const result = await ctx.startCommand(['sh', '-c', 'echo boiled; echo steam >&2; exit 3']);

  expect(result.exitCode).toBe(3);
  expect(result.stdout).toBe('boiled\n');
  expect(result.stderr).toBe('steam\n');
  expect(ctx.stdout.readText()).toBe('boiled\n');
  expect(ctx.stderr.readText()).toBe('steam\n');
});

test('it stops the command when its signal aborts, and returns the exit code of the stop', async () => {
  const ctx = await setupTest();

  const stopping = new AbortController();

  const running = ctx.startCommand(['sh', '-c', 'echo boiling; exec sleep 30'], stopping.signal);

  await ctx.stdout.firstWrite;

  stopping.abort();

  const result = await running;

  expect(result.exitCode).toBe(143);
  expect(result.stdout).toBe('boiling\n');
});
