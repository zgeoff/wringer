import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';

// These tests start the demo repo's verify script as a process, so `up` and `attach` start the real
// supervisor process, detached, as they do for a repo.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  const script = join(import.meta.dir, '..', 'test-utils', 'demo-cli.ts');

  const run = async (...argv: readonly string[]) => {
    const child = Bun.spawn([process.execPath, script, ...argv], {
      cwd: repo.root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

    const lines = stdout.trimEnd().split('\n');

    return { exitCode, lines, envelope: envelopeSchema.parse(JSON.parse(lines.at(-1) ?? '')) };
  };

  onTestFinished(async () => {
    await run('down', '--target', 'local');
    await run('detach', '--target', 'prod');

    await repo.remove();
  });

  return { run };
}

test('it starts the app under a supervisor process with `up`, and stops it with `down`', async () => {
  const ctx = await setupTest();

  await ctx.run('up');

  const status = await ctx.run('status');
  const down = await ctx.run('down');

  expect({ status: status.envelope, down: down.envelope }).toMatchObject({
    status: { data: { status: 'running', endpoints: { web: 'http://127.0.0.1:4300' } } },
    down: { ok: true, data: { stopped: true } },
  });
});

test('it drives an action with each flag type on an attached target', async () => {
  const ctx = await setupTest();

  await ctx.run('attach', '--target', 'prod');
  await ctx.run('doctor', '--target', 'prod');

  const result = await ctx.run(
    'action',
    'greet',
    '--target',
    'prod',
    '--name',
    'Ines',
    '--times',
    '2',
    '--tags',
    'new',
    '--tags',
    'vip',
    '--loud',
  );

  expect({
    exitCode: result.exitCode,
    envelope: result.envelope,
  }).toMatchObject({
    exitCode: 0,
    envelope: { data: { greeting: 'HELLO Ines HELLO Ines', tags: ['new', 'vip'] } },
  });
});

test('it writes every line of a streaming command in the published schema', async () => {
  const ctx = await setupTest();

  await ctx.run('attach', '--target', 'prod');

  const result = await ctx.run('doctor', '--target', 'prod');

  expect(result.lines.map((line) => parsePublishedEnvelope(line).valid)).toSatisfyAll(
    (valid: boolean) => valid,
  );
});
