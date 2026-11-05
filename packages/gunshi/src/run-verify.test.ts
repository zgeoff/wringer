import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';
import { z } from 'zod';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { parsePublishedEvent } from '../../../test-utils/parse-published-event.ts';
import { killProcessGroup } from '../../core/src/kill-process-group.ts';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';

// These tests start the demo repo's verify script as a process, so `up` and `attach` start the real
// supervisor process, detached, as they do for a repo. Each event line and the final envelope the
// script prints are checked against the published schema.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  const script = join(import.meta.dir, '..', 'test-utils', 'demo-cli.ts');
  const eventLineSchema = z.object({ event: z.string() });

  // The CLI runs in a process group of its own, so the cleanup stops it and anything it started
  // in that group when it hangs past the test.
  const startCLI = (argv: readonly string[]) =>
    Bun.spawn([process.execPath, script, ...argv], {
      cwd: repo.root,
      detached: true,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

  const run = async (...argv: readonly string[]) => {
    const child = startCLI(argv);

    onTestFinished(() => {
      killProcessGroup(child.pid);
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
      events: lines.slice(0, -1).map((line) => eventLineSchema.parse(JSON.parse(line)).event),
      envelope: envelopeSchema.parse(JSON.parse(last)),
    };
  };

  // The stops run inside the cleanup, where no further cleanup can be registered, so each one has a
  // deadline that kills its group instead.
  const stopCLI = async (argv: readonly string[]) => {
    const child = startCLI(argv);

    const deadline = setTimeout(() => {
      killProcessGroup(child.pid);
    }, 10_000);

    await child.exited;

    clearTimeout(deadline);
  };

  onTestFinished(async () => {
    await stopCLI(['down', '--target', 'local']);
    await stopCLI(['detach', '--target', 'prod']);

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

test('it exits with code 2 and a usage envelope for an unknown command', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('restock-everything');

  expect({
    exitCode: result.exitCode,
    ok: result.envelope.ok,
    code: result.envelope.error?.code,
    errors: result.errors,
  }).toStrictEqual({ exitCode: 2, ok: false, code: 'usage', errors: [] });
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

  expect({
    events: result.events,
    last: result.envelope.command,
    errors: result.errors,
  }).toStrictEqual({ events: ['check'], last: 'doctor', errors: [] });
});
