import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createSetsid } from './create-setsid.ts';

function setupTest() {
  const directory = createTempDir('create-setsid').path;

  return {
    directory,
    withoutHostSetsid: () => {
      const which = spyOn(Bun, 'which').mockReturnValue(null);

      onTestFinished(() => {
        which.mockRestore();
      });
    },
  };
}

test("it returns the host's own setsid when the host has one", async () => {
  const ctx = setupTest();
  const which = spyOn(Bun, 'which').mockReturnValue('/opt/tools/setsid');

  onTestFinished(() => {
    which.mockRestore();
  });

  const path = await createSetsid(ctx.directory);

  expect(path).toBe('/opt/tools/setsid');
});

test('it returns a shim in the folder when the host has no setsid', async () => {
  const ctx = setupTest();

  ctx.withoutHostSetsid();

  const path = await createSetsid(ctx.directory);

  expect(path).toBe(join(ctx.directory, 'setsid-shim'));
});

test('it starts the shim command as the leader of a new group', async () => {
  const ctx = setupTest();

  ctx.withoutHostSetsid();

  const setsid = await createSetsid(ctx.directory);

  const outPath = join(ctx.directory, 'group.txt');

  const result = Bun.spawnSync([
    setsid,
    'sh',
    '-c',
    'echo "$$ $(ps -o pgid= -p $$)" > "$0"',
    outPath,
  ]);

  const recorded = await readFile(outPath, 'utf8');

  const [pid, group] = recorded.trim().split(/\s+/u);

  expect({ exitCode: result.exitCode, group }).toStrictEqual({ exitCode: 0, group: pid });
});

test('it waits for the command and exits with its status under -w', async () => {
  const ctx = setupTest();

  ctx.withoutHostSetsid();

  const setsid = await createSetsid(ctx.directory);

  const result = Bun.spawnSync([setsid, '-w', 'sh', '-c', 'exit 7']);

  expect(result.exitCode).toBe(7);
});

test('it forks first when it leads a group, and -w then waits for the child', async () => {
  const ctx = setupTest();

  ctx.withoutHostSetsid();

  const setsid = await createSetsid(ctx.directory);

  // The outer shim makes the inner one a group leader, so the inner one has to fork.
  const waited = Bun.spawnSync([setsid, '-w', setsid, '-w', 'sh', '-c', 'exit 7']);
  const detached = Bun.spawnSync([setsid, setsid, 'sh', '-c', 'sleep 0.2; exit 7']);

  expect({ waited: waited.exitCode, detached: detached.exitCode }).toStrictEqual({
    waited: 7,
    detached: 0,
  });
});
