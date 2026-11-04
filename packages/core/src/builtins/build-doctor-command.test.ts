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

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'doctor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const pidPath = join(directory, 'check.pid');

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
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
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

  const stopped = await waitFor(() => {
    try {
      process.kill(pid, 0);

      return null;
    } catch {
      return true;
    }
  });

  expect({ exitCode: result.exitCode, stopped }).toStrictEqual({ exitCode: 1, stopped: true });
});
