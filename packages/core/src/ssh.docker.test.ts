import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createTestSSHPostgres } from '../../db/test-utils/create-test-ssh-postgres.ts';
import { ssh } from './ssh.ts';

// One stack frees what each test took, in the reverse of the order it took it: the container, then
// the folder. The host runs a real sshd, so a follow gets a real terminal.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'ssh-docker');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const remote = await createTestSSHPostgres(directory);

  stack.defer(() => {
    remote.remove();
  });

  // `[s]leep` keeps the pattern from matching the remote shell that runs pgrep.
  const countRemote = (pattern: string): number =>
    Bun.spawnSync([
      remote.sshBinary,
      '-o',
      'BatchMode=yes',
      remote.destination,
      `pgrep -f '${pattern}'`,
    ])
      .stdout.toString()
      .split('\n')
      .filter((line) => line !== '').length;

  return {
    host: ssh({ destination: remote.destination, binary: remote.sshBinary }),
    probeSleepRunning: () => countRemote('[s]leep 300') > 0,
  };
}

test('#follow ends the remote command over a real terminal when its signal aborts', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const following = ctx.host.follow({
    argv: ['sleep', '300'],
    access: 'read-write',
    signal: controller.signal,
    onLine: () => {},
  });

  await waitFor(
    () => {
      invariant(ctx.probeSleepRunning(), 'The remote sleep has not started yet.');
    },
    { timeoutMs: 10_000 },
  );

  controller.abort();

  await Promise.allSettled([following]);

  const gone = await waitFor(
    () => {
      invariant(!ctx.probeSleepRunning(), 'The remote sleep still runs.');

      return true;
    },
    { timeoutMs: 5000 },
  );

  expect(gone).toBeTrue();
});
