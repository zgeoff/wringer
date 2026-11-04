import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';
import { z } from 'zod';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { parsePublishedEvent } from '../../../test-utils/parse-published-event.ts';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';

// These tests start the demo repo's verify script as a process, so `up` and `attach` start the real
// supervisor process, detached, as they do for a repo. Each event line and the final envelope the
// script prints are checked against the published schema.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  const script = join(import.meta.dir, '..', 'test-utils', 'demo-cli.ts');
  const eventLineSchema = z.object({ event: z.string() });

  const run = async (...argv: readonly string[]) => {
    const child = Bun.spawn([process.execPath, script, ...argv], {
      cwd: repo.root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

    const lines = stdout.trimEnd().split('\n');
    const last = lines.at(-1) ?? '';

    return {
      exitCode,
      errors: [
        ...lines.slice(0, -1).flatMap((line) => parsePublishedEvent(line).errors),
        ...parsePublishedEnvelope(last).errors,
      ],
      kinds: lines.map((line) => {
        const parsed = eventLineSchema.safeParse(JSON.parse(line));

        return parsed.success ? parsed.data.event : 'envelope';
      }),
      envelope: envelopeSchema.parse(JSON.parse(last)),
    };
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

  expect({
    status: status.envelope.data,
    down: down.envelope.data,
    errors: [...status.errors, ...down.errors],
  }).toStrictEqual({
    status: expect.objectContaining({
      status: 'running',
      endpoints: { web: 'http://127.0.0.1:4300' },
    }),
    down: { run: expect.any(String), stopped: true },
    errors: [],
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
    data: result.envelope.data,
    errors: result.errors,
  }).toStrictEqual({
    exitCode: 0,
    data: { greeting: 'HELLO Ines HELLO Ines', tags: ['new', 'vip'] },
    errors: [],
  });
});

test("it streams the doctor's check event before its envelope, each in the published schema", async () => {
  const ctx = await setupTest();

  await ctx.run('attach', '--target', 'prod');

  const result = await ctx.run('doctor', '--target', 'prod');

  expect({ kinds: result.kinds, errors: result.errors }).toStrictEqual({
    kinds: ['check', 'envelope'],
    errors: [],
  });
});
