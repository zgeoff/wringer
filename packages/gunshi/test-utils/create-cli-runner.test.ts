import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEnvelope } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { probeProcess } from '../../core/src/probe-process.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createCLIRunner } from './create-cli-runner.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'cli-runner');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const script = join(directory, 'cli.ts');
  const cleanups: (() => void)[] = [];

  onTestFinished(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  });

  return {
    directory,
    runner: createCLIRunner({
      script,
      cwd: directory,
      onCleanup: (cleanup) => {
        cleanups.push(cleanup);
      },
    }),
    writeScript: (source: string) => writeFile(script, source),
    runCleanups: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
    readPID: async (path: string) => {
      const text = await readFile(path, 'utf8');

      return Number(text);
    },
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

  const stopped = await waitFor(() => (probeProcess(pid) ? null : true));

  expect(stopped).toBe(true);
});

test('it ends a CLI that runs past the deadline of a run to its end', async () => {
  const ctx = await setupTest();

  await ctx.writeScript('await Bun.sleep(60_000);\n');

  const startedMs = performance.now();

  await ctx.runner.runToEnd(['down'], 100);

  expect(performance.now() - startedMs).toBeLessThan(5000);
});
