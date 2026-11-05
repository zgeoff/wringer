import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEnvelope } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createCLIRunner } from './create-cli-runner.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'cli-runner');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const script = join(directory, 'cli.ts');

  return {
    runner: createCLIRunner({ script, cwd: directory }),
    writeScript: (source: string) => writeFile(script, source),
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

test('it ends a CLI that runs past the deadline of a run to its end', async () => {
  const ctx = await setupTest();

  await ctx.writeScript('await Bun.sleep(60_000);\n');

  const startedMs = performance.now();

  await ctx.runner.runToEnd(['down'], 100);

  expect(performance.now() - startedMs).toBeLessThan(5000);
});
