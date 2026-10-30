import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { createStubNPM } from './create-stub-npm.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-create-stub-npm-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, npmPath: join(directory, 'npm'), log: join(directory, 'calls') };
}

test('it records each call with its arguments, and succeeds silently on a subcommand with no answer', async () => {
  const ctx = await setupTest();

  await createStubNPM(ctx.directory, ctx.log);

  const view = await $`${ctx.npmPath} view @acme/kettle@1.0.0 version`.nothrow().quiet();
  const publish = await $`${ctx.npmPath} publish ./acme-kettle-1.0.0.tgz`.nothrow().quiet();
  const calls = await readFile(ctx.log, 'utf8');

  expect([view.exitCode, view.stdout.toString()]).toStrictEqual([0, '']);
  expect([publish.exitCode, publish.stdout.toString()]).toStrictEqual([0, '']);
  expect(calls).toBe('npm view @acme/kettle@1.0.0 version\nnpm publish ./acme-kettle-1.0.0.tgz\n');
});

test('it answers a subcommand with its given output and exit code, and leaves the others alone', async () => {
  const ctx = await setupTest();

  await createStubNPM(ctx.directory, ctx.log, {
    view: { output: '1.0.0\n' },
    publish: { output: "it's refused\n", exitCode: 1 },
  });

  const view = await $`${ctx.npmPath} view @acme/kettle version`.nothrow().quiet();
  const publish = await $`${ctx.npmPath} publish ./acme-kettle-1.0.0.tgz`.nothrow().quiet();
  const whoami = await $`${ctx.npmPath} whoami`.nothrow().quiet();

  expect([view.exitCode, view.stdout.toString()]).toStrictEqual([0, '1.0.0\n']);
  expect([publish.exitCode, publish.stdout.toString()]).toStrictEqual([1, "it's refused\n"]);
  expect([whoami.exitCode, whoami.stdout.toString()]).toStrictEqual([0, '']);
});
