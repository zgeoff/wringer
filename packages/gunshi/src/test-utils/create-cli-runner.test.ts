import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEnvelope } from '@wringer/core';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { probeProcess } from '../../../core/src/host/probe-process.ts';
import { createCleanupRegistry } from './create-cleanup-registry.ts';
import { createCLIRunner } from './create-cli-runner.ts';
import { readPIDFile } from './read-pid-file.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'cli-runner');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const script = join(directory, 'cli.ts');
  const cleanups = createCleanupRegistry();

  onTestFinished(() => {
    cleanups.runAll();
  });

  return {
    directory,
    runner: createCLIRunner({ script, cwd: directory, onCleanup: cleanups.register }),
    writeScript: (source: string) => writeFile(script, source),
    runCleanups: () => {
      cleanups.runAll();
    },
    readPID: (path: string) => readPIDFile(path),
  };
}

test('it returns the exit code and the envelope the CLI printed', async () => {
  const ctx = await setupTest();

  const envelope = buildEnvelope({
    command: 'restock',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error: null,
  });

  await ctx.writeScript(
    `console.log(${JSON.stringify(JSON.stringify(envelope))});\nprocess.exitCode = 2;\n`,
  );

  const result = await ctx.runner.run('restock');

  expect(result).toStrictEqual({ exitCode: 2, events: [], envelope, errors: [] });
});

test('it stops the process group a run left behind in the cleanup it registers', async () => {
  const ctx = await setupTest();

  const envelope = buildEnvelope({
    command: 'restock',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error: null,
  });

  const pidPath = join(ctx.directory, 'sleep.pid');

  await ctx.writeScript(
    [
      "const child = Bun.spawn(['sleep', '60'], { stdio: ['ignore', 'ignore', 'ignore'] });",
      `await Bun.write(${JSON.stringify(pidPath)}, String(child.pid));`,
      'child.unref();',
      `console.log(${JSON.stringify(JSON.stringify(envelope))});`,
      '',
    ].join('\n'),
  );

  await ctx.runner.run('restock');

  const pid = await ctx.readPID(pidPath);

  ctx.runCleanups();

  const stopped = await waitFor(() => {
    invariant(!probeProcess(pid), 'The CLI is still running.');

    return true;
  });

  expect(stopped).toBe(true);
});

test('it reads the envelope of a CLI that writes more to stderr than a pipe holds', async () => {
  const ctx = await setupTest();

  const envelope = buildEnvelope({
    command: 'restock',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error: null,
  });

  await ctx.writeScript(
    [
      String.raw`await Bun.write(Bun.stderr, 'shelf warning\n'.repeat(20_000));`,
      `console.log(${JSON.stringify(JSON.stringify(envelope))});`,
      '',
    ].join('\n'),
  );

  const result = await ctx.runner.run('restock');

  expect(result).toStrictEqual({ exitCode: 0, events: [], envelope, errors: [] });
});

test.each(['stdout', 'stderr'])(
  'it lets a CLI run to its end when it writes more to %s than a pipe holds',
  async (stream) => {
    const ctx = await setupTest();

    const donePath = join(ctx.directory, 'done');

    await ctx.writeScript(
      [
        `await Bun.write(Bun.${stream}, 'shelf warning\\n'.repeat(20_000));`,
        `await Bun.write(${JSON.stringify(donePath)}, 'done');`,
        '',
      ].join('\n'),
    );

    await ctx.runner.runToEnd(['down'], 3000);

    const done = await Bun.file(donePath).exists();

    expect(done).toBe(true);
  },
);

test('it ends a CLI that runs past the deadline of a run to its end', async () => {
  const ctx = await setupTest();

  await ctx.writeScript('await Bun.sleep(60_000);\n');

  const startedMs = performance.now();

  await ctx.runner.runToEnd(['down'], 100);

  expect(performance.now() - startedMs).toBeLessThan(5000);
});
