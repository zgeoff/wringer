import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalText } from '@zgeoff/std';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { killProcessGroup } from '../src/kill-process-group.ts';
import { probeProcess } from '../src/probe-process.ts';
import { createFakeSSH } from './create-fake-ssh.ts';
import { waitFor } from './wait-for.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-fake-ssh');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, fake: await createFakeSSH(directory) };
}

test('it runs the command string through a shell and logs the login', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([
    ctx.fake.binary,
    '-o',
    'BatchMode=yes',
    '-l',
    'app_ro',
    '--',
    'db-host',
    "printf '%s|' 'a b' c",
  ]);

  expect({
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    logins: await readFile(ctx.fake.loginsPath, 'utf8'),
  }).toStrictEqual({ exitCode: 0, stdout: 'a b|c|', logins: 'app_ro@db-host\n' });
});

test('it exits 255 for the unreachable destination', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'unreachable', 'true']);

  expect(result.exitCode).toBe(255);
});

test.each([
  ['for signal in INT TERM; do :; done', 255],
  ['kill -0 $$', 0],
])('it exits for the command %p on the drops-stops destination with %p', async (command, code) => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'drops-stops', command]);

  expect(result.exitCode).toBe(code);
});

test('it runs setsid through a stand-in that records its process ID on the slow-setsid destination', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'slow-setsid', 'setsid sh -c "echo ran"']);

  const recorded = await readFile(ctx.fake.setsidPIDPath, 'utf8');

  expect({ stdout: result.stdout.toString(), recorded }).toStrictEqual({
    stdout: 'ran\n',
    recorded: expect.stringMatching(/^\d+\n$/u),
  });
});

test('it stops every process group a remote setsid started', async () => {
  const ctx = await setupTest();

  const ran = Bun.spawnSync([
    ctx.fake.binary,
    '--',
    'db-host',
    `setsid sh -c 'echo "$$" > "$0"; exec sleep 30' '${join(ctx.directory, 'remote.pid')}' </dev/null >/dev/null 2>&1 &`,
  ]);

  const pid = await waitFor(async () => {
    const text = await readOptionalText(join(ctx.directory, 'remote.pid'));

    return text?.endsWith('\n') === true ? Number(text) : null;
  });

  onTestFinished(() => {
    killProcessGroup(pid);
  });

  await ctx.fake.stopGroups();

  const stopped = await waitFor(() => (probeProcess(pid) ? null : true));

  expect({ exitCode: ran.exitCode, stopped }).toStrictEqual({ exitCode: 0, stopped: true });
});

test('it refuses more than one command word, as a caller that skips quoting would send', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'db-host', 'printf', 'x']);

  expect(result.exitCode).toBe(2);
});
