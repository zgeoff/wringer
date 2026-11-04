import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createTestFolder } from '../../../../test-utils/create-test-folder.ts';
import { createTestSession } from '../../test-utils/create-test-session.ts';
import { waitFor } from '../../test-utils/wait-for.ts';
import { createWringer } from '../create-wringer.ts';
import { defineDriver } from '../define-driver.ts';
import { dispatch } from '../dispatch.ts';
import { local } from '../local.ts';
import { probeProcess } from '../probe-process.ts';
import { WringerError } from '../wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'doctor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const pidPath = join(directory, 'check.pid');
  const scribblePath = join(directory, 'scribble.txt');

  const clock = defineDriver({
    name: 'clock',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    client: () => ({}),
    checks: [
      {
        name: 'hang',
        timeoutMs: 100,
        run: async (ctx) => {
          await ctx.session.exec(['sh', '-c', `echo $$ > '${pidPath}'; exec sleep 30`], 'read');
        },
      },
    ],
  });

  const wringer = createWringer({ name: 'shop' })
    .use(clock({}))
    .target('box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { clock: () => ({}) },
    })
    .check({
      name: 'note',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 1000,
      run: async (_input, ctx) => {
        await ctx.evidence.writeFile('note', 'cart.txt', 'the cart was empty');

        throw new WringerError('check-failed', { message: 'The cart was empty.' });
      },
    })
    .check({
      name: 'scribble',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 1000,
      run: async (_input, ctx) => {
        await ctx.exec(['sh', '-c', `echo restocked > '${scribblePath}'`]);

        return {};
      },
    })
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    probeScribble: () => Bun.file(scribblePath).exists(),
    readRun: (runID: string) => shop.state.readRun(runID),
    runWithin: (path: readonly string[], timeoutMs: number) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'box', timeoutMs }),
    readPID: async () => {
      const text = await readFile(pidPath, 'utf8');

      return Number(text);
    },
    run: (path: readonly string[]) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'box' }),
  };
}

test('it stops the work of a check that ran past its own deadline', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);
  const pid = await ctx.readPID();
  const stopped = await waitFor(() => (probeProcess(pid) ? null : true));

  expect({ exitCode: result.exitCode, stopped }).toStrictEqual({ exitCode: 1, stopped: true });
});

test('it lists the evidence a failed check kept in the doctor envelope', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);

  expect(result.envelope.evidence).toStrictEqual([
    { kind: 'note', path: expect.stringMatching(/cart\.txt$/u), sha256: expect.any(String) },
  ]);
});

test('it starts no check once the doctor ran past its own deadline', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);

  const runID = attached.envelope.instance ?? '';

  await ctx.runWithin(['doctor'], 50);

  const view = await waitFor(async () => {
    const read = await ctx.readRun(runID);

    return read?.doctor === 'failed' ? read : null;
  });

  expect(view.doctorResults.map((check) => [check.name, check.code])).toStrictEqual([
    ['clock.hang', 'timeout'],
    ['note', 'timeout'],
    ['scribble', 'timeout'],
  ]);
});

test('it refuses a write from a check on a read-write target, which stays unchanged', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);

  await ctx.run(['doctor']);

  const view = await ctx.readRun(attached.envelope.instance ?? '');
  const scribbled = await ctx.probeScribble();

  expect({
    scribble: view?.doctorResults.find((check) => check.name === 'scribble')?.code,
    scribbled,
  }).toStrictEqual({ scribble: 'read-only', scribbled: false });
});
