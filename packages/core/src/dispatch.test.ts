import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { dispatch } from './dispatch.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
    lines: shop.lines,
    state: shop.state,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
    runOnPointers: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, shop.session),
    runAsFeature: (feature: string, path: readonly string[], args: unknown) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local', feature }),
  };
}

test('it answers an unknown command with a usage error and exit code 2', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['teleport']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: { code: 'usage', message: 'There is no command `teleport`.', hint: null },
  });
});

test('it answers arguments that fail the schema with a usage error', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['use'], { feature: 7 });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it refuses a feature flag the feature map lacks before the command runs', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runAsFeature('../../escape', ['notes', 'add'], { text: 'pay' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    feature: result.envelope.feature,
  }).toStrictEqual({ exitCode: 2, code: 'usage', feature: null });
});

test('it names no run in the envelope of a move to a target with none', async () => {
  const ctx = await setupTest();

  await ctx.runOnPointers(['up']);

  const result = await ctx.runOnPointers(['use'], { target: 'prod' });

  expect({
    target: result.envelope.target,
    instance: result.envelope.instance,
    cursors: result.envelope.cursors,
  }).toStrictEqual({ target: 'prod', instance: null, cursors: {} });
});

test('it writes an envelope that parses against the published schema', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['status']);

  expect(parsePublishedEnvelope(JSON.stringify(result.envelope))).toStrictEqual({
    valid: true,
    errors: [],
  });
});

test('it refuses a drive command on a target with no running run, with exit code 3', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['notes', 'list']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'not-running',
      message: 'Target local has no running run.',
      hint: 'Run `up --target local` first.',
    },
  });
});

test('it refuses a drive command until the doctor passes on the run', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);

  const result = await ctx.run('local', ['notes', 'list']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('it runs a driver command through the run supervisor once the doctor passed', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['notes', 'add'], { text: 'buy milk' });

  const result = await ctx.run('local', ['notes', 'list']);

  expect({ ok: result.envelope.ok, data: result.envelope.data }).toStrictEqual({
    ok: true,
    data: { notes: ['buy milk'] },
  });
});

test('it refuses drives once the working tree changed, with the hint to restart', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await writeFile(join(ctx.root, 'cart.ts'), 'export const total = 0;\n');

  const result = await ctx.run('local', ['notes', 'list']);

  expect(result.envelope.error).toStrictEqual({
    code: 'doctor-required',
    message: 'The working tree changed since this run started, so its doctor pass no longer holds.',
    hint: 'Run `up --restart`, then `doctor`.',
  });
});

test('it streams one NDJSON event per doctor check, each in the published schema', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  expect(ctx.lines.map((line): unknown => JSON.parse(line))).toStrictEqual([
    {
      wringer: 1,
      event: 'check',
      data: {
        name: 'notes.store',
        status: 'passed',
        durationMs: expect.any(Number),
        code: null,
        message: null,
      },
    },
  ]);
});

test('it times out a command past its deadline with exit code 5', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'hang']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 5,
    code: 'timeout',
  });
});

test('it turns a plain thrown error into an internal error with exit code 4', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 4,
    error: {
      code: 'internal',
      message: 'wringer failed with an internal error: cannot read the cart',
      hint: null,
    },
  });
});

test('it keeps the evidence of a drive that failed in its envelope', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);

  expect(result.envelope.evidence).toStrictEqual([
    { kind: 'note', path: expect.stringMatching(/cart\.txt$/u), sha256: expect.any(String) },
  ]);
});

test('it answers with an internal error when the envelope is too large for the log', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'hoard']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    evidence: result.envelope.evidence.length,
  }).toStrictEqual({ exitCode: 4, code: 'internal', evidence: 400 });
});

test('it answers with an internal error when the data has no JSON form', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'tally']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    data: result.envelope.data,
  }).toStrictEqual({ exitCode: 4, code: 'internal', data: null });
});

test("it writes an internal error's stack to the run's log", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);
  const events = await ctx.state.readRunEvents(result.envelope.instance ?? '');

  expect(events).toPartiallyContain({
    type: 'internal-error',
    command: 'action.crash',
    stack: expect.stringContaining('TypeError: cannot read the cart'),
  });
});

test('it moves data over the cap to an evidence file and marks the envelope truncated', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'flood']);

  const payload: unknown = await Bun.file(
    join(ctx.root, result.envelope.truncatedPath ?? ''),
  ).json();

  expect({
    truncated: result.envelope.truncated,
    data: result.envelope.data,
    payload,
  }).toStrictEqual({ truncated: true, data: null, payload: { text: 'x'.repeat(40 * 1024) } });
});

test('it refuses an action on a target it does not run on, with exit code 3', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'local-only']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'target-not-allowed',
  });
});

test('it fails a raw exec that exits non-zero with check-failed and exit code 1', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], { argv: ['sh', '-c', 'echo nope; exit 3'] });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    data: result.envelope.data,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    data: { exitCode: 3, stdout: 'nope\n', stderr: '' },
  });
});

test('it caps the data of a failed exec and still answers with its envelope', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], {
    argv: ['sh', '-c', 'yes x | head -c 100000; exit 2'],
  });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    truncated: result.envelope.truncated,
    data: result.envelope.data,
  }).toStrictEqual({ exitCode: 1, code: 'check-failed', truncated: true, data: null });
});

test('it keeps a drive under the feature it started with when `use` moves on meanwhile', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.root, '.wringer');

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['use'], { feature: 'checkout' });

  Bun.spawnSync(['mkfifo', join(directory, 'entered'), join(directory, 'gate')]);

  const paused = ctx.run('local', ['action', 'pause'], { directory });

  await readFile(join(directory, 'entered'), 'utf8');

  await ctx.run('local', ['use'], { feature: 'search' });

  await writeFile(join(directory, 'gate'), 'go\n');

  const result = await paused;

  expect({ exitCode: result.exitCode, feature: result.envelope.feature }).toStrictEqual({
    exitCode: 0,
    feature: 'checkout',
  });
});

test('it fails an exec of a missing command with an environment error and exit code 4', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], { argv: ['shop-no-such-tool'] });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
  });
});

test('it refuses a write action on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'seed']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`action seed` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it refuses a repo command with no declared effect on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['restock']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`restock` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it runs a repo command that needs no run on a target with no run', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['stock']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { text: '12' },
  });
});

test("it gives a repo command that needs no run the running run's services", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'seed']);

  const result = await ctx.run('local', ['shelf']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 1 },
  });
});

test('it refuses a driver call from a repo command that needs no run while no run is up', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['shelf']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'not-running',
  });
});

test('it runs a declared read-only action on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'count']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 0 },
  });
});

test('it refuses a write inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'notes add sneaky is a write, and the target is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it refuses a raw exec on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['exec'], { argv: ['ls'] });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`exec` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it runs a driver call the read-only target grants', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['notes', 'add'], { text: 'granted' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 1 },
  });
});

test('it gives the package hint when a read-only target sets none', async () => {
  const ctx = await setupTest();

  await ctx.run('archive', ['attach']);
  await ctx.run('archive', ['doctor']);

  const result = await ctx.run('archive', ['exec'], { argv: ['ls'] });

  expect(result.envelope.error?.hint).toBe(
    'This target is read-only. Stop and report the write you needed.',
  );
});
