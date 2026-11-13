import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createTestRepo } from '@wringer/core/test-utils/create-test-repo.ts';
import { readTemplateHash } from './read-template-hash.ts';
import { createCLIRunner } from './test-utils/create-cli-runner.ts';
import { createCoverWringer } from './test-utils/create-cover-wringer.ts';
import { writeLintSkill } from './test-utils/write-lint-skill.ts';

// These tests start the demo repo's verify script as a process, so `up` and `attach` start the real
// supervisor process, detached, as they do for a repo. Each event line and the final envelope the
// script prints are checked against the published schema.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  const cli = createCLIRunner({
    script: join(import.meta.dir, 'test-utils', 'demo-cli.ts'),
    cwd: repo.root,
    onCleanup: onTestFinished,
  });

  onTestFinished(async () => {
    await cli.runToEnd(['down', '--target', 'local'], 10_000);
    await cli.runToEnd(['detach', '--target', 'prod'], 10_000);
    await repo.remove();
  });

  return {
    run: cli.run,
    root: repo.root,
    createRunner: (script: string) =>
      createCLIRunner({ script, cwd: repo.root, onCleanup: onTestFinished }),
  };
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

test('it lints the cover of the registry file in its `registry` option', async () => {
  const ctx = await setupTest();

  // The script is a shared glob and the option's file is not, so only the option can fail the lint.
  await Bun.write(
    join(ctx.root, 'verify/run.ts'),
    [
      `import { runVerify } from ${JSON.stringify(join(import.meta.dir, 'run-verify.ts'))};`,
      `import { createCoverWringer } from ${JSON.stringify(join(import.meta.dir, 'test-utils/create-cover-wringer.ts'))};`,
      "await runVerify(createCoverWringer({ shared: ['verify/run.ts'] }), { skill: 'docs/verify', registry: 'verify/registry.ts' });",
    ].join('\n'),
  );

  await Bun.write(join(ctx.root, 'verify/registry.ts'), 'export const registry = 1;\n');
  await Bun.write(join(ctx.root, 'src/cart.ts'), 'export const cart = 1;\n');

  await writeLintSkill(
    ctx.root,
    createCoverWringer(),
    `---\nmetadata:\n  wringer-template: ${await readTemplateHash()}\n  wringer-command: bun verify\n---\n`,
  );

  const result = await ctx.createRunner(join(ctx.root, 'verify/run.ts')).run('lint', '--json');

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: expect.objectContaining({
      failures: [expect.objectContaining({ check: 'registry', where: 'verify/registry.ts' })],
    }),
  });
});

test('it lints the cover of the running script when no `registry` option is given', async () => {
  const ctx = await setupTest();

  await Bun.write(
    join(ctx.root, 'verify/run.ts'),
    [
      `import { runVerify } from ${JSON.stringify(join(import.meta.dir, 'run-verify.ts'))};`,
      `import { createCoverWringer } from ${JSON.stringify(join(import.meta.dir, 'test-utils/create-cover-wringer.ts'))};`,
      "await runVerify(createCoverWringer(), { skill: 'docs/verify' });",
    ].join('\n'),
  );

  await Bun.write(join(ctx.root, 'src/cart.ts'), 'export const cart = 1;\n');

  await writeLintSkill(
    ctx.root,
    createCoverWringer(),
    `---\nmetadata:\n  wringer-template: ${await readTemplateHash()}\n  wringer-command: bun verify\n---\n`,
  );

  const result = await ctx.createRunner(join(ctx.root, 'verify/run.ts')).run('lint', '--json');

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: expect.objectContaining({
      failures: [expect.objectContaining({ check: 'registry', where: 'verify/run.ts' })],
    }),
  });
});
